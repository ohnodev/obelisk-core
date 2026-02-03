"""
Memory Selector Node
Selects relevant conversation context from storage
"""
from typing import Dict, Any, List, Optional
from pathlib import Path
import json
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)

# LangChain is REQUIRED
try:
    from langchain_core.messages import HumanMessage, AIMessage
except ImportError as e:
    raise ImportError(
        "LangChain is required for memory management. Please install it with: pip install langchain langchain-core"
    ) from e


class MemorySelectorNode(BaseNode):
    """
    Selects relevant conversation context from storage
    
    Handles:
    - Loading recent interactions from storage
    - Loading summaries from storage
    - Using MemorySelector agent to intelligently select relevant memories
    - Formatting output as ConversationContextDict
    
    Inputs:
        query: User query string (for context selection)
        storage_instance: StorageInterface instance (from Memory Storage Node)
        user_id: User identifier (optional)
        llm: ObeliskLLM instance (optional, defaults to container's LLM)
        enable_recent_buffer: Whether to include recent conversation buffer (optional, default: True)
        k: Number of recent message pairs to keep in buffer (optional, default: 10)
    
    Outputs:
        context: ConversationContextDict with 'messages' and 'memories'
    """
    
    # Class-level cache for buffer managers per storage instance
    _buffer_managers: Dict[str, Any] = {}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory selector node"""
        super().__init__(node_id, node_data)
    
    def _get_buffer_manager(self, storage_instance, k: int):
        """Get or create buffer manager for storage instance"""
        # Use storage instance id or path as cache key
        storage_id = id(storage_instance)
        if storage_id not in self._buffer_managers:
            from ....memory.buffer_manager import RecentBufferManager
            self._buffer_managers[storage_id] = RecentBufferManager(k=k)
        return self._buffer_managers[storage_id]
    
    def _load_all_summaries_from_storage(self, storage_instance, user_id: str, limit: int = 30) -> List[Dict[str, Any]]:
        """Load all summaries from storage (up to limit, most recent first)"""
        try:
            summaries_list = []
            
            # For LocalJSONStorage, summaries are in memory/activities.json
            if hasattr(storage_instance, 'memory_path'):
                activities_file = Path(storage_instance.memory_path) / "activities.json"
            elif hasattr(storage_instance, 'base_path'):
                # Fallback for old structure (backward compatibility)
                activities_file = Path(storage_instance.base_path) / "memory" / "activities.json"
                if not activities_file.exists():
                    # Try old location
                    activities_file = Path(storage_instance.base_path) / "activities.json"
            else:
                return []
            
            if activities_file.exists():
                with open(activities_file, 'r') as f:
                    activities = json.load(f)
                
                # Find all conversation_summary activities for this user
                user_summaries = [
                    activity for activity in activities
                    if activity.get('type') == 'conversation_summary'
                    and activity.get('message', '').endswith(f'user {user_id}')
                ]
                
                # Sort by created_at (most recent first) and limit
                user_summaries.sort(key=lambda x: x.get('created_at', ''), reverse=True)
                user_summaries = user_summaries[:limit]
                
                # Extract summary_data from each
                for activity in user_summaries:
                    metadata = activity.get('metadata', {})
                    summary_data = metadata.get('summary_data')
                    if summary_data:
                        # Add activity ID for reference
                        summary_data['_activity_id'] = activity.get('id')
                        summary_data['_created_at'] = activity.get('created_at')
                        summaries_list.append(summary_data)
            
            return summaries_list
            
        except Exception as e:
            logger.error(f"Error loading summaries from storage: {e}")
            return []
    
    def _select_relevant_memories(
        self,
        selector_agent,
        user_query: str,
        summaries: List[Dict[str, Any]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Use Memory Selector agent to select relevant memories from a list of summaries
        
        Args:
            selector_agent: MemorySelectorAgent instance
            user_query: Current user query (required)
            summaries: List of summary dictionaries
            top_k: Number of relevant memories to select (default: 5)
            
        Returns:
            List of selected relevant summary dictionaries
        """
        if not summaries:
            return []
        
        return selector_agent.select(user_query, summaries, top_k)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory selector node"""
        query = self.get_input_value('query', context, '')
        storage_instance = self.get_input_value('storage_instance', context, None)
        user_id = self.get_input_value('user_id', context, None)
        llm = self.get_input_value('llm', context, None)
        enable_recent_buffer = self.get_input_value('enable_recent_buffer', context, True)
        k = self.get_input_value('k', context, 10)
        
        # Resolve template variables
        if isinstance(query, str) and query.startswith('{{') and query.endswith('}}'):
            var_name = query[2:-2].strip()
            query = context.variables.get(var_name, '')
        
        if isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
            var_name = user_id[2:-2].strip()
            user_id = context.variables.get(var_name, None)
        
        # Convert enable_recent_buffer to boolean if it's a string
        if isinstance(enable_recent_buffer, str):
            enable_recent_buffer = enable_recent_buffer.lower() in ('true', '1', 'yes', 'on')
        enable_recent_buffer = bool(enable_recent_buffer)
        
        # Default user_id if not provided
        if user_id is None or user_id == '':
            user_id = f"user_{self.node_id}"
        
        # Default to container's LLM if not provided
        if llm is None:
            llm = context.container.llm
        
        # Validate inputs
        if not storage_instance:
            raise ValueError("storage_instance is required for MemorySelectorNode")
        
        if not query:
            raise ValueError("query is required for MemorySelectorNode")
        
        # Import agent
        from ....memory.agents.memory_selector import MemorySelector as MemorySelectorAgent
        selector_agent = MemorySelectorAgent(llm)
        
        # Get buffer manager (shared per storage instance)
        buffer_manager = self._get_buffer_manager(storage_instance, int(k))
        
        # Get conversation context
        conversation_messages = []
        memories_parts = []
        
        # Get recent messages from buffer window (recent conversation) if enabled
        # Convert to Qwen3 message format: [{"role": "user", "content": "..."}, ...]
        if enable_recent_buffer:
            buffer = buffer_manager.get_buffer(str(user_id), storage_instance)
            messages = buffer.get_messages()
            
            for msg in messages:
                if hasattr(msg, 'content'):
                    # Convert LangChain messages to Qwen3 format
                    if isinstance(msg, HumanMessage):
                        conversation_messages.append({
                            "role": "user",
                            "content": msg.content
                        })
                    elif isinstance(msg, AIMessage):
                        conversation_messages.append({
                            "role": "assistant",
                            "content": msg.content
                        })
        
        # Load all summaries and use intelligent selection (always runs)
        all_summaries = self._load_all_summaries_from_storage(storage_instance, str(user_id), limit=30)
        
        if all_summaries:
            # Use LLM to select relevant memories if we have multiple summaries
            if len(all_summaries) > 1:
                selected_summaries = self._select_relevant_memories(selector_agent, str(query), all_summaries, top_k=5)
            else:
                # Only one summary, use it as-is (zero summaries case handled by outer if)
                selected_summaries = all_summaries
            
            # Format selected memories
            for summary_data in selected_summaries:
                # Format important facts as bullet points
                important_facts = summary_data.get('importantFacts', [])
                if important_facts:
                    if not memories_parts:
                        memories_parts.append("[Memories]")
                    if isinstance(important_facts, list):
                        for fact in important_facts:
                            memories_parts.append(f"- {fact}")
                    else:
                        memories_parts.append(f"- {important_facts}")
                
                # Add user context if available (merge to avoid duplicates)
                user_context = summary_data.get('userContext', {})
                if user_context and isinstance(user_context, dict):
                    if memories_parts and "[User Context]" not in "\n".join(memories_parts):
                        memories_parts.append("")  # Add separator
                        memories_parts.append("[User Context]")
                    elif "[User Context]" not in "\n".join(memories_parts):
                        memories_parts.append("[User Context]")
                    for key, value in user_context.items():
                        # Only add if not already present
                        context_line = f"- {key}: {value}"
                        if context_line not in memories_parts:
                            memories_parts.append(context_line)
        
        memories_str = "\n".join(memories_parts) if memories_parts else ""
        
        return {
            'context': {
                "messages": conversation_messages,
                "memories": memories_str
            }
        }

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
        query: Original query (pass-through for cleaner flow)
        context: ConversationContextDict with 'messages' and 'memories'
    """
    
    # Class-level cache for buffer managers per storage instance
    _buffer_managers: Dict[str, Any] = {}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory selector node"""
        super().__init__(node_id, node_data)
    
    def _get_buffer_manager(self, storage_instance, k: int):
        """Get or create buffer manager for storage instance"""
        # Use tuple of (storage_instance_id, k) as cache key to handle different k values
        storage_id = id(storage_instance)
        cache_key = (storage_id, int(k))
        if cache_key not in self._buffer_managers:
            from .memory.buffer_manager import RecentBufferManager
            self._buffer_managers[cache_key] = RecentBufferManager(k=int(k))
        return self._buffer_managers[cache_key]
    
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
                # Use robust user_id lookup: prefer metadata.summary_data.user_id, then metadata.user_id, fallback to message pattern
                user_summaries = []
                for activity in activities:
                    if activity.get('type') != 'conversation_summary':
                        continue
                    
                    # Prefer metadata.summary_data.user_id (where MemoryCreatorNode stores it)
                    metadata = activity.get('metadata', {})
                    summary_data = metadata.get('summary_data', {})
                    activity_user_id = summary_data.get('user_id') or metadata.get('user_id')
                    
                    # Match user_id if found in metadata, otherwise fallback to message pattern
                    if activity_user_id and activity_user_id == user_id:
                        user_summaries.append(activity)
                    elif not activity_user_id:
                        # Fallback: check message pattern only if metadata.user_id is absent
                        if activity.get('message', '').endswith(f'user {user_id}'):
                            user_summaries.append(activity)
                
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
        llm,
        user_query: str,
        summaries: List[Dict[str, Any]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Use LLM to select relevant memories from a list of summaries (agent logic embedded).
        
        Args:
            llm: LLM instance
            user_query: Current user query (required)
            summaries: List of summary dictionaries
            top_k: Number of relevant memories to select (default: 5)
            
        Returns:
            List of selected relevant summary dictionaries
        """
        if not summaries:
            return []
        
        # If we have fewer summaries than top_k, return all
        if len(summaries) <= top_k:
            return summaries
        
        try:
            # Format summaries for analysis
            summaries_text = ""
            for i, summary in enumerate(summaries):
                summary_str = f"Memory {i}:\n"
                summary_str += f"  Summary: {summary.get('summary', 'N/A')}\n"
                
                # Handle keyTopics - convert dicts to strings if needed
                topics = summary.get('keyTopics', [])
                topics_strs = []
                for topic in topics:
                    if isinstance(topic, dict):
                        topics_strs.append(str(list(topic.values())[0]) if topic.values() else str(topic))
                    else:
                        topics_strs.append(str(topic))
                summary_str += f"  Topics: {', '.join(topics_strs)}\n"
                
                # Handle importantFacts - convert dicts to strings if needed
                facts = summary.get('importantFacts', [])
                facts_strs = []
                for fact in facts:
                    if isinstance(fact, dict):
                        facts_strs.append(str(list(fact.values())[0]) if fact.values() else str(fact))
                    else:
                        facts_strs.append(str(fact))
                summary_str += f"  Facts: {', '.join(facts_strs)}\n"
                
                user_ctx = summary.get('userContext', {})
                if user_ctx:
                    summary_str += f"  Context: {', '.join([f'{k}={v}' for k, v in user_ctx.items()])}\n"
                summaries_text += summary_str + "\n"
            
            # System prompt with detailed instructions (persistent context - saves tokens)
            system_prompt = f"""You are a memory selector. Your role is to analyze memories and select the {top_k} most relevant ones for a user query.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with {{ and end with }}.

Analyze which memories are most relevant to the user query and return a JSON object with:
- selected_indices: Array of 0-based indices of the {top_k} most relevant memories (e.g., [0, 2, 5])
- reason: Brief explanation of why these memories were selected

Example of correct JSON format:
{{
  "selected_indices": [0, 2, 5],
  "reason": "Memory 0 discusses the main topic, Memory 2 contains relevant context, Memory 5 has related facts"
}}"""
            
            # Query with just the user query and available memories (minimal - saves tokens)
            query = f"User Query: {user_query}\n\nAvailable Memories:\n{summaries_text}\n\nReturn the indices (0-based) of the {top_k} most relevant memories. Return ONLY the JSON object, nothing else."
            
            # Use LLM to select using config parameters
            result = llm.generate(
                query=query,
                system_prompt=system_prompt,
                quantum_influence=0.1,  # Very low influence for consistent selection
                max_length=800,  # Enough for JSON response
                conversation_history=None,
                enable_thinking=False  # Disable thinking mode for faster, simpler selection
            )
            
            selection_text = result.get('response', '').strip()
            
            # Extract JSON using utility
            from ....utils.json_parser import extract_json_from_llm_response
            selection_data = extract_json_from_llm_response(selection_text, context="memory selection")
            
            # Extract and validate indices
            selected_indices = selection_data.get('selected_indices', [])
            
            # Validate indices and select memories
            selected_memories = []
            for idx in selected_indices:
                if isinstance(idx, int) and 0 <= idx < len(summaries):
                    selected_memories.append(summaries[idx])
            
            # If we got valid selections, return them
            if selected_memories:
                logger.debug(f"Selected {len(selected_memories)} relevant memories from {len(summaries)} total")
                return selected_memories
            else:
                # Critical error: LLM returned invalid indices
                raise ValueError(
                    f"Memory selection returned invalid indices: {selected_indices} "
                    f"(expected 0-{len(summaries)-1} for {len(summaries)} memories)"
                )
                
        except ValueError:
            # Re-raise ValueError (JSON parsing or invalid indices)
            raise
        except Exception as e:
            # Critical error for any other exception
            logger.error(f"Critical error in memory selection: {e}")
            raise RuntimeError(f"Memory selection failed critically: {e}") from e
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory selector node"""
        query = self.get_input_value('query', context, '')
        storage_instance = self.get_input_value('storage_instance', context, None)
        user_id = self.get_input_value('user_id', context, None)
        # Accept both 'model' (from ModelLoaderNode) and 'llm' (legacy/direct)
        llm = self.get_input_value('model', context, None) or self.get_input_value('llm', context, None)
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
        
        # Validate inputs
        if not storage_instance:
            raise ValueError("storage_instance is required for MemorySelectorNode")
        
        if not query:
            raise ValueError("query is required for MemorySelectorNode")
        
        # Default to container's LLM if not provided
        if llm is None:
            if context.container and context.container.llm:
                llm = context.container.llm
            else:
                raise ValueError("llm is required for MemorySelectorNode. Connect a ModelLoaderNode or provide llm input.")
        
        # Validate and convert k parameter
        try:
            if isinstance(k, (int, float)):
                k_int = int(k)
            elif isinstance(k, str):
                k_int = int(float(k))  # Handle "10.0" -> 10
            else:
                raise TypeError(f"k must be numeric, got {type(k).__name__}")
            
            if k_int < 1:
                raise ValueError(f"k must be >= 1, got {k_int}")
        except (ValueError, TypeError) as e:
            raise ValueError(
                f"Invalid k value for MemorySelectorNode (node_id={self.node_id}, storage_instance={id(storage_instance)}): "
                f"k={repr(k)} ({type(k).__name__}). k must be a positive integer. Error: {e}"
            ) from e
        
        # Agent logic is embedded in _select_relevant_memories method
        
        # Get buffer manager (shared per storage instance and k value)
        buffer_manager = self._get_buffer_manager(storage_instance, k_int)
        
        # Get conversation context
        conversation_messages = []
        memories_parts = []
        
        # Get recent messages from buffer window (recent conversation) if enabled
        # Convert to Qwen3 message format: [{"role": "user", "content": "..."}, ...]
        if enable_recent_buffer:
            buffer = buffer_manager.get_buffer(str(user_id), storage_instance)
            messages = buffer.get_messages()
            
            logger.debug(f"[MemorySelector] Buffer enabled: loaded {len(messages)} messages from buffer for user_id={user_id}")
            
            for msg in messages:
                if hasattr(msg, 'content'):
                    # Convert LangChain messages to Qwen3 format
                    if isinstance(msg, HumanMessage):
                        conversation_messages.append({
                            "role": "user",
                            "content": msg.content
                        })
                        # Debug mode: log metadata instead of raw content to avoid PII leaks
                        # (Note: Debug mode is intentionally verbose for development/debugging)
                        content_len = len(msg.content) if msg.content else 0
                        preview = "REDACTED" if content_len > 0 else "empty"
                        logger.debug(f"[MemorySelector] Added user message: length={content_len}, preview={preview}")
                    elif isinstance(msg, AIMessage):
                        conversation_messages.append({
                            "role": "assistant",
                            "content": msg.content
                        })
                        # Debug mode: log metadata instead of raw content to avoid PII leaks
                        # (Note: Debug mode is intentionally verbose for development/debugging)
                        content_len = len(msg.content) if msg.content else 0
                        preview = "REDACTED" if content_len > 0 else "empty"
                        logger.debug(f"[MemorySelector] Added assistant message: length={content_len}, preview={preview}")
        else:
            logger.debug(f"[MemorySelector] Buffer disabled for user_id={user_id}")
        
        # Load all summaries and use intelligent selection (always runs)
        all_summaries = self._load_all_summaries_from_storage(storage_instance, str(user_id), limit=30)
        
        logger.debug(f"[MemorySelector] Loaded {len(all_summaries)} summaries for user_id={user_id}")
        
        if all_summaries:
            # Use LLM to select relevant memories if we have multiple summaries
            if len(all_summaries) > 1:
                selected_summaries = self._select_relevant_memories(llm, str(query), all_summaries, top_k=5)
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
        
        context_output = {
            "messages": conversation_messages,
            "memories": memories_str
        }
        
        logger.debug(f"[MemorySelector] Final context for user_id={user_id}: {len(conversation_messages)} messages, {len(memories_str)} chars of memories")
        if conversation_messages:
            # Debug mode: log metadata instead of raw content to avoid PII leaks
            # (Note: Debug mode is intentionally verbose for development/debugging)
            first_msg = conversation_messages[0]
            first_content = first_msg.get('content', '')
            content_len = len(first_content) if first_content else 0
            preview = "REDACTED" if content_len > 0 else "empty"
            logger.debug(f"[MemorySelector] First message: role={first_msg.get('role', 'unknown')}, length={content_len}, preview={preview}")
        
        return {
            'query': str(query),  # Pass through original query for cleaner flow
            'context': context_output
        }

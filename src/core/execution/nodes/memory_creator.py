"""
Memory Creator Node
Saves query/response interactions to storage
"""
from typing import Dict, Any, Optional, Tuple
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


class MemoryCreatorNode(BaseNode):
    """
    Saves query/response interactions to storage
    
    Handles:
    - Saving interactions to storage
    - Tracking interaction count per user
    - Triggering summarization when threshold reached
    - Using MemoryCreator agent to create summaries
    - Saving summaries to storage as activity logs
    
    Inputs:
        query: User query string
        response: AI response string
        storage_instance: StorageInterface instance (from Memory Storage Node)
        user_id: User identifier (optional)
        llm: ObeliskLLM instance (optional, defaults to container's LLM)
        summarize_threshold: Interactions before summarizing (optional, default: 3)
        k: Number of recent message pairs to keep in buffer (optional, default: 10)
        cycle_id: Evolution cycle ID (optional)
        energy: Energy value (optional, default: 0.0)
        quantum_seed: Quantum seed value (optional, default: 0.7)
        reward_score: Reward score (optional, default: 0.0)
    
    Outputs:
        saved: Boolean indicating whether interaction was saved
        summary: Dictionary with summary data if summarization occurred (optional)
    """
    
    # Class-level cache for buffer managers and interaction counts per storage instance
    _buffer_managers: Dict[str, Any] = {}
    _interaction_counts: Dict[str, Dict[str, int]] = {}  # storage_id -> {user_id: count}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory creator node"""
        super().__init__(node_id, node_data)
    
    def _get_buffer_manager(self, storage_instance, k: int):
        """Get or create buffer manager for storage instance"""
        # Use storage instance id as cache key
        storage_id = id(storage_instance)
        if storage_id not in self._buffer_managers:
            from ....memory.buffer_manager import RecentBufferManager
            self._buffer_managers[storage_id] = RecentBufferManager(k=k)
            self._interaction_counts[storage_id] = {}
        return self._buffer_managers[storage_id]
    
    def _get_interaction_count(self, storage_instance, user_id: str) -> int:
        """Get interaction count for a user (from cache or storage)"""
        storage_id = id(storage_instance)
        if storage_id not in self._interaction_counts:
            self._interaction_counts[storage_id] = {}
        
        if user_id not in self._interaction_counts[storage_id]:
            # Initialize from storage
            interactions = storage_instance.get_user_interactions(user_id, limit=None)
            self._interaction_counts[storage_id][user_id] = len(interactions)
        return self._interaction_counts[storage_id][user_id]
    
    def _increment_interaction_count(self, storage_instance, user_id: str):
        """Increment interaction count for a user"""
        storage_id = id(storage_instance)
        if storage_id not in self._interaction_counts:
            self._interaction_counts[storage_id] = {}
        if user_id not in self._interaction_counts[storage_id]:
            self._interaction_counts[storage_id][user_id] = 0
        self._interaction_counts[storage_id][user_id] += 1
    
    def _summarize_conversations(
        self,
        creator_agent,
        interactions: list,
        user_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Summarize conversations using the Memory Creator agent.
        """
        if not interactions:
            return None
        
        return creator_agent.summarize(interactions, user_id)
    
    def _save_summary_to_storage(self, storage_instance, user_id: str, summary_data: Dict[str, Any], interactions: list):
        """Save summary to storage"""
        try:
            metadata = {
                'summary_text': summary_data.get('summary', ''),
                'summary_data': summary_data,
                'interactions_count': len(interactions),
            }
            
            storage_instance.create_activity_log(
                activity_type='conversation_summary',
                message=f'Conversation summary for user {user_id}',
                energy=0.0,
                metadata=metadata
            )
        except Exception as e:
            logger.error(f"Error saving summary: {e}")
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory creator node"""
        query = self.get_input_value('query', context, '')
        response = self.get_input_value('response', context, '')
        storage_instance = self.get_input_value('storage_instance', context, None)
        user_id = self.get_input_value('user_id', context, None)
        llm = self.get_input_value('llm', context, None)
        summarize_threshold = self.get_input_value('summarize_threshold', context, 3)
        k = self.get_input_value('k', context, 10)
        cycle_id = self.get_input_value('cycle_id', context, None)
        energy = self.get_input_value('energy', context, 0.0)
        quantum_seed = self.get_input_value('quantum_seed', context, 0.7)
        reward_score = self.get_input_value('reward_score', context, 0.0)
        
        # Resolve template variables
        if isinstance(query, str) and query.startswith('{{') and query.endswith('}}'):
            var_name = query[2:-2].strip()
            query = context.variables.get(var_name, '')
        
        if isinstance(response, str) and response.startswith('{{') and response.endswith('}}'):
            var_name = response[2:-2].strip()
            response = context.variables.get(var_name, '')
        
        if isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
            var_name = user_id[2:-2].strip()
            user_id = context.variables.get(var_name, None)
        
        # Default user_id if not provided
        if user_id is None or user_id == '':
            user_id = f"user_{self.node_id}"
        
        # Default to container's LLM if not provided
        if llm is None:
            llm = context.container.llm
        
        # Validate inputs
        if not storage_instance:
            raise ValueError("storage_instance is required for MemoryCreatorNode")
        
        if not query or not response:
            raise ValueError("query and response are required for MemoryCreatorNode")
        
        # Import agent
        from ....memory.agents.memory_creator import MemoryCreator as MemoryCreatorAgent
        creator_agent = MemoryCreatorAgent(llm)
        
        # Get buffer manager (shared per storage instance)
        buffer_manager = self._get_buffer_manager(storage_instance, int(k))
        
        # Get buffer and check for duplicates
        buffer = buffer_manager.get_buffer(str(user_id), storage_instance)
        existing_messages = buffer.get_messages()
        
        if existing_messages:
            last_user_msg = None
            last_ai_msg = None
            for msg in reversed(existing_messages):
                if isinstance(msg, HumanMessage) and last_user_msg is None:
                    last_user_msg = msg.content
                elif isinstance(msg, AIMessage) and last_ai_msg is None:
                    last_ai_msg = msg.content
                if last_user_msg and last_ai_msg:
                    break
            
            # Skip if this exact interaction is already the last one
            if last_user_msg == str(query) and last_ai_msg == str(response):
                return {'saved': False}
        
        # Save to storage first (single source of truth)
        # If cycle_id not provided, try to get current cycle
        if cycle_id is None:
            try:
                cycle_id = storage_instance.get_current_evolution_cycle()
            except:
                cycle_id = None
        
        storage_instance.save_interaction(
            user_id=str(user_id),
            query=str(query),
            response=str(response),
            cycle_id=cycle_id,
            energy=float(energy),
            quantum_seed=float(quantum_seed),
            reward_score=float(reward_score)
        )
        
        # Add to recent conversation buffer
        buffer.add_user_message(str(query))
        buffer.add_ai_message(str(response))
        
        # Update interaction count cache (increment after saving)
        self._increment_interaction_count(storage_instance, str(user_id))
        interaction_count = self._get_interaction_count(storage_instance, str(user_id))
        
        # Check if we need to summarize (every N interactions)
        # Trigger summarization when we hit the threshold (every N interactions)
        summary_data = None
        if interaction_count > 0 and interaction_count % int(summarize_threshold) == 0:
            # Get only the recent interactions to summarize (last N pairs)
            # Only read from disk when we actually need to summarize
            recent_interactions = storage_instance.get_user_interactions(str(user_id), limit=int(summarize_threshold))
            
            # Summarize only these recent interactions (they'll be converted to memories)
            if recent_interactions:
                summary_data = self._summarize_conversations(creator_agent, recent_interactions, str(user_id))
                if summary_data:
                    self._save_summary_to_storage(storage_instance, str(user_id), summary_data, recent_interactions)
                    # Note: We don't clear the buffer - it maintains recent context
        
        result = {
            'saved': True
        }
        
        if summary_data:
            result['summary'] = summary_data
        
        return result

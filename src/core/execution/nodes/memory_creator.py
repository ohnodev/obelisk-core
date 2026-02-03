"""
Memory Creator Node
Creates and saves memory data (interactions, summaries) to storage
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)

# LangChain is REQUIRED for buffer management
try:
    from langchain_core.messages import HumanMessage, AIMessage
except ImportError as e:
    raise ImportError(
        "LangChain is required for memory management. Please install it with: pip install langchain langchain-core"
    ) from e


class MemoryCreatorNode(BaseNode):
    """
    Creates and saves memory data (interactions, summaries) to storage
    
    Handles:
    - Creating interaction data structures
    - Saving interactions to storage
    - Tracking interaction count (in-memory, per user_id)
    - Triggering summarization when threshold reached
    - Using MemoryCreator agent to create summaries
    - Saving summaries to storage
    - Managing recent conversation buffers
    
    Inputs:
        storage_instance: StorageInterface instance (from MemoryStorageNode) - REQUIRED
        query: User query string (required)
        response: AI response string (required)
        user_id: User identifier (optional, defaults to user_{node_id})
        llm: ObeliskLLM instance (optional, uses container's LLM if not provided)
        summarize_threshold: Number of interactions before summarizing (optional, default: 3)
        previous_interactions: List of previous interactions for summarization (optional, required for summarization to work)
        cycle_id: Evolution cycle ID (optional)
        energy: Energy value (optional, default: 0.0)
        quantum_seed: Quantum seed value (optional, default: 0.7)
        k: Number of recent message pairs to keep in buffer (optional, default: 10)
    
    Outputs:
        None - saves directly to storage
    """
    
    # Class-level cache for interaction counts per user_id
    _interaction_counts: Dict[str, Dict[str, int]] = {}  # storage_id -> user_id -> count
    
    # Class-level cache for buffer managers per storage instance
    _buffer_managers: Dict[str, Any] = {}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory creator node"""
        super().__init__(node_id, node_data)
    
    def _get_buffer_manager(self, storage_instance, k: int):
        """Get or create buffer manager for storage instance"""
        storage_id = id(storage_instance)
        if storage_id not in self._buffer_managers:
            from .memory.buffer_manager import RecentBufferManager
            self._buffer_managers[storage_id] = RecentBufferManager(k=k)
        return self._buffer_managers[storage_id]
    
    def _get_interaction_count(self, storage_instance, user_id: str) -> int:
        """Get interaction count for a user (from cache)"""
        storage_id = id(storage_instance)
        if storage_id not in self._interaction_counts:
            self._interaction_counts[storage_id] = {}
        if user_id not in self._interaction_counts[storage_id]:
            self._interaction_counts[storage_id][user_id] = 0
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
        llm,
        interactions: list,
        user_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Summarize conversations using LLM directly (agent logic embedded).
        """
        if not interactions:
            return None
        
        try:
            # Format conversations
            conversation_text = ""
            for interaction in interactions:
                query = interaction.get('query', '')
                response = interaction.get('response', '')
                if query:
                    conversation_text += f"User: {query}\n"
                if response:
                    conversation_text += f"Overseer: {response}\n"
            
            # Memory Creator prompt (from config)
            summary_prompt = f"""You are extracting key memories from a conversation. You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with {{ and end with }}.

Conversation to analyze:
{conversation_text}

Extract and structure the following information as JSON with these EXACT keys:
- summary: A brief 1-2 sentence overview of the conversation
- keyTopics: Array of main topics discussed (e.g., ["AI", "quantum computing", "memory systems"])
- userContext: Object containing any user preferences, settings, or context mentioned (e.g., {{"preferred_language": "English", "timezone": "UTC"}})
- importantFacts: Array of factual statements extracted from the conversation (e.g., ["Current year is 2026", "User prefers concise responses"])

Example of correct JSON format:
{{
  "summary": "Discussion about AI memory systems and their implementation",
  "keyTopics": ["artificial intelligence", "memory architecture", "neural networks"],
  "userContext": {{"preferred_format": "technical", "current_year": 2026}},
  "importantFacts": ["Current year is 2026", "Memory systems use JSON for storage", "Neural networks require structured data"]
}}

Now extract the memories from the conversation above. Return ONLY the JSON object, nothing else:"""
            
            # Generate summary using config parameters
            result = llm.generate(
                query=summary_prompt,
                quantum_influence=0.2,  # Lower influence for more consistent summaries
                conversation_context=None,
                max_length=800,  # Allow enough tokens for complete JSON generation
                enable_thinking=False  # Disable thinking mode for faster, more reliable JSON output
            )
            
            summary_text = result.get('response', '').strip()
            
            # Extract JSON using utility
            from ....utils.json_parser import extract_json_from_llm_response
            summary_data = extract_json_from_llm_response(summary_text, context="summary")
            return summary_data
            
        except Exception as e:
            logger.error(f"Error summarizing with LLM: {e}")
            return None
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory creator node - creates and saves data to storage"""
        storage_instance = self.get_input_value('storage_instance', context, None)
        query = self.get_input_value('query', context, '')
        response = self.get_input_value('response', context, '')
        user_id = self.get_input_value('user_id', context, None)
        # Accept both 'model' (from ModelLoaderNode) and 'llm' (legacy/direct)
        llm = self.get_input_value('model', context, None) or self.get_input_value('llm', context, None)
        summarize_threshold_raw = self.get_input_value('summarize_threshold', context, 3)
        previous_interactions = self.get_input_value('previous_interactions', context, None)
        
        # Validate and normalize summarize_threshold: ensure it's >= 1 to prevent ZeroDivisionError
        try:
            summarize_threshold = int(summarize_threshold_raw)
            if summarize_threshold < 1:
                logger.warning(f"[MemoryCreator] summarize_threshold ({summarize_threshold}) is less than 1, defaulting to 3")
                summarize_threshold = 3
        except (ValueError, TypeError):
            logger.warning(f"[MemoryCreator] Invalid summarize_threshold value ({summarize_threshold_raw}), defaulting to 3")
            summarize_threshold = 3
        cycle_id = self.get_input_value('cycle_id', context, None)
        energy = self.get_input_value('energy', context, 0.0)
        quantum_seed = self.get_input_value('quantum_seed', context, 0.7)
        k = self.get_input_value('k', context, 10)
        
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
            logger.debug(f"[MemoryCreator] Resolved user_id template variable: {var_name} -> {user_id}")
        
        # Validate required inputs
        if storage_instance is None:
            raise ValueError("storage_instance is required for MemoryCreatorNode. Connect a MemoryStorageNode first.")
        
        if not query or not response:
            raise ValueError("query and response are required for MemoryCreatorNode")
        
        # Default user_id if not provided
        if user_id is None or user_id == '':
            user_id = f"user_{self.node_id}"
            logger.warning(f"[MemoryCreator] user_id was None/empty, defaulting to {user_id} for node {self.node_id}. Available context variables: {list(context.variables.keys())}")
        
        # Default to container's LLM if not provided
        if llm is None:
            if context.container and context.container.llm:
                llm = context.container.llm
            else:
                raise ValueError("llm is required for MemoryCreatorNode. Connect a ModelLoaderNode or provide llm input.")
        
        # Get current cycle if not provided
        if cycle_id is None:
            try:
                cycle_id = storage_instance.get_current_evolution_cycle()
            except:
                cycle_id = None
        
        # Save interaction to storage
        logger.debug(f"[MemoryCreator] Saving interaction for user_id={user_id}: query='{str(query)[:50]}...', response='{str(response)[:50]}...'")
        storage_instance.save_interaction(
            user_id=str(user_id),
            query=str(query),
            response=str(response),
            cycle_id=cycle_id,
            energy=float(energy),
            quantum_seed=float(quantum_seed)
        )
        logger.debug(f"[MemoryCreator] Interaction saved successfully for user_id={user_id}")
        
        # Add to recent conversation buffer
        buffer_manager = self._get_buffer_manager(storage_instance, int(k))
        buffer = buffer_manager.get_buffer(str(user_id), storage_instance)
        buffer.add_user_message(str(query))
        buffer.add_ai_message(str(response))
        
        # Update interaction count
        self._increment_interaction_count(storage_instance, str(user_id))
        interaction_count = self._get_interaction_count(storage_instance, str(user_id))
        
        # Check if we should summarize (every N interactions)
        # summarize_threshold is already validated and cast to int above
        should_summarize = interaction_count > 0 and interaction_count % summarize_threshold == 0
        
        # Create and save summary if threshold reached
        if should_summarize and previous_interactions:
            # Summarize the previous interactions (agent logic embedded in node)
            summary_data = self._summarize_conversations(llm, previous_interactions, str(user_id))
            
            if summary_data:
                # Add metadata to summary
                summary_data['interactions_count'] = len(previous_interactions)
                summary_data['user_id'] = str(user_id)
                
                # Save summary to storage
                metadata = {
                    'summary_text': summary_data.get('summary', ''),
                    'summary_data': summary_data,
                    'interactions_count': summary_data.get('interactions_count', 0),
                }
                
                storage_instance.create_activity_log(
                    activity_type='conversation_summary',
                    message=f'Conversation summary for user {user_id}',
                    energy=0.0,
                    metadata=metadata
                )
        
        # No outputs - saves directly to storage
        return {}

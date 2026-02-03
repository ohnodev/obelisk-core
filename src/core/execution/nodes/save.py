"""
Save Node
Saves data to storage (interactions, summaries, etc.)
Handles buffer management since it needs storage access
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


class SaveNode(BaseNode):
    """
    Saves data to storage and manages buffers
    
    This is the primitive node for saving to storage.
    Accepts data from MemoryCreatorNode or direct inputs.
    
    Inputs:
        storage_instance: StorageInterface instance (from MemoryStorageNode) - REQUIRED
        data_type: Type of data to save - "interaction", "summary", "custom" (default: "interaction")
        interaction_data: Interaction data dict from MemoryCreatorNode (preferred for interactions)
        summary_data: Summary data dict from MemoryCreatorNode (for summaries)
        user_id: User identifier (required if interaction_data not provided)
        query: User query (required if interaction_data not provided)
        response: AI response (required if interaction_data not provided)
        data: Custom data dict (for custom saves)
        cycle_id: Evolution cycle ID (optional, auto-detected if not provided)
        energy: Energy value (optional, default: 0.0)
        quantum_seed: Quantum seed value (optional, default: 0.7)
        k: Number of recent message pairs to keep in buffer (optional, default: 10)
    
    Outputs:
        saved: Boolean indicating whether save was successful
        saved_data: The saved data dict
    """
    
    # Class-level cache for buffer managers per storage instance
    _buffer_managers: Dict[str, Any] = {}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize save node"""
        super().__init__(node_id, node_data)
    
    def _get_buffer_manager(self, storage_instance, k: int):
        """Get or create buffer manager for storage instance"""
        storage_id = id(storage_instance)
        if storage_id not in self._buffer_managers:
            from ....memory.buffer_manager import RecentBufferManager
            self._buffer_managers[storage_id] = RecentBufferManager(k=k)
        return self._buffer_managers[storage_id]
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute save node"""
        storage_instance = self.get_input_value('storage_instance', context, None)
        data_type = self.get_input_value('data_type', context, 'interaction')
        interaction_data = self.get_input_value('interaction_data', context, None)
        summary_data = self.get_input_value('summary_data', context, None)
        user_id = self.get_input_value('user_id', context, None)
        query = self.get_input_value('query', context, None)
        response = self.get_input_value('response', context, None)
        data = self.get_input_value('data', context, None)
        cycle_id = self.get_input_value('cycle_id', context, None)
        energy = self.get_input_value('energy', context, 0.0)
        quantum_seed = self.get_input_value('quantum_seed', context, 0.7)
        k = self.get_input_value('k', context, 10)
        
        # Resolve template variables
        if isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
            var_name = user_id[2:-2].strip()
            user_id = context.variables.get(var_name, None)
        
        if storage_instance is None:
            raise ValueError("storage_instance is required for SaveNode")
        
        try:
            if data_type == 'interaction':
                # Prefer interaction_data from MemoryCreatorNode, fallback to individual inputs
                if interaction_data:
                    user_id = interaction_data.get('user_id', user_id)
                    query = interaction_data.get('query', query)
                    response = interaction_data.get('response', response)
                    cycle_id = interaction_data.get('cycle_id', cycle_id)
                    energy = interaction_data.get('energy', energy)
                    quantum_seed = interaction_data.get('quantum_seed', quantum_seed)
                
                if not user_id or not query or not response:
                    raise ValueError("user_id, query, and response are required for interaction saves")
                
                # Get current cycle if not provided
                if cycle_id is None:
                    try:
                        cycle_id = storage_instance.get_current_evolution_cycle()
                    except:
                        cycle_id = None
                
                # Save interaction to storage
                storage_instance.save_interaction(
                    user_id=str(user_id),
                    query=str(query),
                    response=str(response),
                    cycle_id=cycle_id,
                    energy=float(energy),
                    quantum_seed=float(quantum_seed)
                )
                
                # Add to recent conversation buffer
                buffer_manager = self._get_buffer_manager(storage_instance, int(k))
                buffer = buffer_manager.get_buffer(str(user_id), storage_instance)
                buffer.add_user_message(str(query))
                buffer.add_ai_message(str(response))
                
                saved_data = {
                    'type': 'interaction',
                    'user_id': str(user_id),
                    'query': str(query),
                    'response': str(response)
                }
                
            elif data_type == 'summary':
                # Prefer summary_data from MemoryCreatorNode, fallback to data input
                summary_to_save = summary_data or data
                if not summary_to_save:
                    raise ValueError("summary_data or data is required for summary saves")
                
                # Extract user_id from summary_data if available
                summary_user_id = summary_to_save.get('user_id') if isinstance(summary_to_save, dict) else None
                user_id_for_log = user_id or summary_user_id or "unknown"
                
                metadata = {
                    'summary_text': summary_to_save.get('summary', '') if isinstance(summary_to_save, dict) else '',
                    'summary_data': summary_to_save,
                    'interactions_count': summary_to_save.get('interactions_count', 0) if isinstance(summary_to_save, dict) else 0,
                }
                
                storage_instance.create_activity_log(
                    activity_type='conversation_summary',
                    message=f'Conversation summary for user {user_id_for_log}',
                    energy=0.0,
                    metadata=metadata
                )
                
                saved_data = {
                    'type': 'summary',
                    'data': summary_to_save
                }
                
            elif data_type == 'custom':
                if not data:
                    raise ValueError("data is required for custom saves")
                
                # For custom saves, just store the data
                # This is a generic save - could be extended
                saved_data = data
                
            else:
                raise ValueError(f"Unknown data_type: {data_type}")
            
            return {
                'saved': True,
                'saved_data': saved_data
            }
            
        except Exception as e:
            logger.error(f"Error saving data: {e}")
            return {
                'saved': False,
                'saved_data': None,
                'error': str(e)
            }

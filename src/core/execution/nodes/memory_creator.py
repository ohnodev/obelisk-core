"""
Memory Creator Node
Creates memory data (interactions, summaries) - does NOT save to storage
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)


class MemoryCreatorNode(BaseNode):
    """
    Creates memory data (interactions, summaries) - pure computation, no storage
    
    This node only creates the data structures. Use SaveNode to save to storage.
    
    Handles:
    - Creating interaction data structures
    - Tracking interaction count (in-memory, per user_id)
    - Triggering summarization when threshold reached
    - Using MemoryCreator agent to create summaries
    
    Inputs:
        query: User query string
        response: AI response string
        user_id: User identifier (optional, defaults to user_{node_id})
        llm: ObeliskLLM instance (optional, defaults to container's LLM)
        summarize_threshold: Interactions before summarizing (optional, default: 3)
        previous_interactions: List of previous interactions for summarization (optional)
        cycle_id: Evolution cycle ID (optional)
        energy: Energy value (optional, default: 0.0)
        quantum_seed: Quantum seed value (optional, default: 0.7)
    
    Outputs:
        interaction_data: Dict with interaction data ready to save
        summary_data: Dictionary with summary data if summarization occurred (optional)
        should_summarize: Boolean indicating if summarization should occur
    """
    
    # Class-level cache for interaction counts per user_id
    _interaction_counts: Dict[str, int] = {}  # user_id -> count
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory creator node"""
        super().__init__(node_id, node_data)
    
    def _get_interaction_count(self, user_id: str) -> int:
        """Get interaction count for a user (from cache)"""
        if user_id not in self._interaction_counts:
            self._interaction_counts[user_id] = 0
        return self._interaction_counts[user_id]
    
    def _increment_interaction_count(self, user_id: str):
        """Increment interaction count for a user"""
        if user_id not in self._interaction_counts:
            self._interaction_counts[user_id] = 0
        self._interaction_counts[user_id] += 1
    
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
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory creator node - creates data, does NOT save"""
        query = self.get_input_value('query', context, '')
        response = self.get_input_value('response', context, '')
        user_id = self.get_input_value('user_id', context, None)
        llm = self.get_input_value('llm', context, None)
        summarize_threshold = self.get_input_value('summarize_threshold', context, 3)
        previous_interactions = self.get_input_value('previous_interactions', context, None)
        cycle_id = self.get_input_value('cycle_id', context, None)
        energy = self.get_input_value('energy', context, 0.0)
        quantum_seed = self.get_input_value('quantum_seed', context, 0.7)
        k = self.get_input_value('k', context, 10)  # For reference, not used in creation but may be needed
        
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
            if context.container and context.container.llm:
                llm = context.container.llm
            else:
                raise ValueError("llm is required for MemoryCreatorNode. Connect a ModelLoaderNode or provide llm input.")
        
        # Validate inputs
        if not query or not response:
            raise ValueError("query and response are required for MemoryCreatorNode")
        
        # Create interaction data structure (ready to save)
        interaction_data = {
            'user_id': str(user_id),
            'query': str(query),
            'response': str(response),
            'cycle_id': cycle_id,
            'energy': float(energy),
            'quantum_seed': float(quantum_seed)
        }
        
        # Update interaction count
        self._increment_interaction_count(str(user_id))
        interaction_count = self._get_interaction_count(str(user_id))
        
        # Check if we should summarize (every N interactions)
        should_summarize = interaction_count > 0 and interaction_count % int(summarize_threshold) == 0
        
        # Create summary if threshold reached
        summary_data = None
        if should_summarize and previous_interactions:
            # Import agent
            from ....memory.agents.memory_creator import MemoryCreator as MemoryCreatorAgent
            creator_agent = MemoryCreatorAgent(llm)
            
            # Summarize the previous interactions
            summary_data = self._summarize_conversations(creator_agent, previous_interactions, str(user_id))
            
            if summary_data:
                # Add metadata to summary
                summary_data['interactions_count'] = len(previous_interactions)
                summary_data['user_id'] = str(user_id)
        
        result = {
            'interaction_data': interaction_data,
            'should_summarize': should_summarize
        }
        
        if summary_data:
            result['summary_data'] = summary_data
        
        return result

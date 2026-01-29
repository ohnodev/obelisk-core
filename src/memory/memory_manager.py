"""
Memory Manager for The Obelisk
Uses LangChain for conversation memory management with Qwen LLM for summarization
"""
from typing import List, Dict, Any, Optional
from pathlib import Path
import os
from ..storage.base import StorageInterface
from ..utils.logger import get_logger
from ..utils.json_parser import extract_json_from_llm_response
from .recent_buffer import RecentConversationBuffer

logger = get_logger(__name__)

# LangChain is REQUIRED - no fallback
try:
    from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
except ImportError as e:
    raise ImportError(
        "LangChain is required for memory management. Please install it with: pip install langchain langchain-core"
    ) from e


class ObeliskMemoryManager:
    """
    Manages conversation memory and recent conversation context
    
    Architecture:
    - RecentConversationBuffer: Sliding window of last k message pairs (for prompt injection)
    - Memory Summaries: Long-term storage of summarized conversations (for intelligent selection)
    - Uses Qwen LLM for summarization and memory selection
    
    Flow:
    1. On init: Load only last k*2 messages into buffer (lightweight)
    2. On each interaction: Add to buffer, check if summarization needed
    3. Every N interactions: Summarize recent interactions, save to memory
    4. On each query: Select relevant memories using LLM, include in context
    """
    
    def __init__(
        self,
        storage: StorageInterface,
        k: int = 10,
        summarize_threshold: int = 3,
        llm=None,  # ObeliskLLM instance for summarization (required in solo mode)
        mode: str = "solo"
    ):
        """
        Initialize memory manager
        
        Args:
            storage: StorageInterface instance
            k: Number of recent message pairs to keep in buffer (default: 10)
            summarize_threshold: Number of message pairs before summarizing (default: 3, summarizes every 3 interactions)
            llm: ObeliskLLM instance for summarization (required in solo mode)
            mode: "solo" or "prod" (default: "solo")
        """
        if llm is None and mode == "solo":
            raise ValueError("LLM instance is required for memory summarization in solo mode")
        
        self.storage = storage
        self.k = k
        self.summarize_threshold = summarize_threshold
        self.llm = llm
        self.mode = mode
        self.buffers: Dict[str, RecentConversationBuffer] = {}  # Store recent conversation buffers per user
    
    def get_buffer(self, user_id: str) -> RecentConversationBuffer:
        """
        Get or create recent conversation buffer for a user
        
        Loads only the last k*2 messages (k message pairs) - no heavy processing on init.
        This is just for prompt injection, not memory storage.
        
        Args:
            user_id: User identifier
            
        Returns:
            RecentConversationBuffer instance with last k message pairs
        """
        if user_id not in self.buffers:
            # Load only recent messages (last k*2 messages = k message pairs)
            interactions = self.storage.get_user_interactions(user_id, limit=self.k * 2)
            
            # Create buffer
            buffer = RecentConversationBuffer(k=self.k)
            
            # Convert interactions to LangChain messages (most recent first)
            for interaction in reversed(interactions):  # Reverse to get chronological order
                query = interaction.get('query', '')
                response = interaction.get('response', '')
                if query:
                    buffer.add_user_message(query)
                if response:
                    buffer.add_ai_message(response)
            
            self.buffers[user_id] = buffer
        
        return self.buffers[user_id]
    
    def _summarize_conversations(self, interactions: List[Dict[str, Any]], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Summarize conversations using Qwen LLM (solo mode) or Mistral (prod mode, optional)
        In solo mode, always uses Qwen LLM
        """
        if not interactions:
            return None
        
        # Always use Qwen LLM for summarization (solo mode)
        # In prod mode, we could optionally use Mistral, but for now we use Qwen
        if self.llm:
            return self._summarize_with_llm(interactions, user_id)
        
        # Fallback: simple summary if no LLM available
        return {
            'summary': f"Previous conversation with {len(interactions)} interactions.",
            'keyTopics': [],
            'userContext': {},
            'importantFacts': []
        }
    
    def _summarize_with_llm(self, interactions: List[Dict[str, Any]], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Summarize using the Qwen LLM"""
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
            
            # Create summarization prompt (simpler, more direct)
            summary_prompt = f"""Extract key memories from this conversation. Return ONLY valid JSON, no other text.

Conversation:
{conversation_text}

Return JSON with these exact keys:
{{
  "summary": "brief overview",
  "keyTopics": ["topic1", "topic2"],
  "userContext": {{"favorite_color": "green", "name": "Alvis"}},
  "importantFacts": ["User's favorite color is green", "User's name is Alvis"]
}}

JSON only:"""
            
            # Generate summary - no redirection needed, same as thinking spinner
            result = self.llm.generate(
                query=summary_prompt,
                quantum_influence=0.2,  # Lower influence for more consistent summaries
                conversation_context=None,
                max_length=500  # Allow more tokens for JSON generation
            )
            
            summary_text = result.get('response', '').strip()
            
            # Extract JSON using utility (raises ValueError if parsing fails - critical error)
            summary_data = extract_json_from_llm_response(summary_text, context="summary")
            return summary_data
            
        except Exception as e:
            logger.error(f"Error summarizing with LLM: {e}")
            return None
    
    def _save_summary_to_storage(self, user_id: str, summary_data: Dict[str, Any], interactions: List[Dict[str, Any]]):
        """Save summary to storage"""
        try:
            metadata = {
                'summary_text': summary_data.get('summary', ''),
                'summary_data': summary_data,
                'interactions_count': len(interactions),
            }
            
            self.storage.create_activity_log(
                activity_type='conversation_summary',
                message=f'Conversation summary for user {user_id}',
                energy=0.0,
                metadata=metadata
            )
        except Exception as e:
            logger.error(f"Error saving summary: {e}")
    
    def _load_all_summaries_from_storage(self, user_id: str, limit: int = 30) -> List[Dict[str, Any]]:
        """Load all summaries from storage (up to limit, most recent first)"""
        try:
            summaries_list = []
            
            # For LocalJSONStorage, summaries are in memory/activities.json
            if hasattr(self.storage, 'memory_path'):
                activities_file = Path(self.storage.memory_path) / "activities.json"
            elif hasattr(self.storage, 'base_path'):
                # Fallback for old structure (backward compatibility)
                activities_file = Path(self.storage.base_path) / "memory" / "activities.json"
                if not activities_file.exists():
                    # Try old location
                    activities_file = Path(self.storage.base_path) / "activities.json"
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
    
    def add_interaction(
        self,
        user_id: str,
        query: str,
        response: str,
        cycle_id: Optional[str] = None,
        energy: float = 0.0,
        quantum_seed: float = 0.7,
        reward_score: float = 0.0
    ):
        """
        Add interaction to memory and storage (single source of truth)
        
        This method handles both persistence and memory management internally.
        Callers should NOT call storage.save_interaction() separately.
        
        Args:
            user_id: User identifier
            query: User's query
            response: Agent's response
            cycle_id: Evolution cycle ID (optional, for evolution tracking)
            energy: Energy value (optional, defaults to 0.0)
            quantum_seed: Quantum seed value (optional, defaults to 0.7)
            reward_score: Reward score (optional, defaults to 0.0)
        """
        buffer = self.get_buffer(user_id)
        
        # Check if this interaction is already in memory to avoid duplicates
        existing_messages = memory.get_messages()
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
            if last_user_msg == query and last_ai_msg == response:
                return  # Already in memory, skip
        
        # Save to storage first (single source of truth)
        # If cycle_id not provided, try to get current cycle
        if cycle_id is None:
            try:
                cycle_id = self.storage.get_current_evolution_cycle()
            except:
                cycle_id = None
        
        self.storage.save_interaction(
            user_id=user_id,
            query=query,
            response=response,
            cycle_id=cycle_id,
            energy=energy,
            quantum_seed=quantum_seed,
            reward_score=reward_score
        )
        
        # Add to recent conversation buffer
        buffer.add_user_message(query)
        buffer.add_ai_message(response)
        
        # Check if we need to summarize (every N message pairs)
        # Count message pairs from storage (not buffer, since buffer is just a window)
        interactions = self.storage.get_user_interactions(user_id, limit=self.summarize_threshold * 2)
        message_pairs = len(interactions) // 2
        
        # Trigger summarization when we hit the threshold (every N interactions)
        # Only summarize when we have exactly N pairs (not on every interaction after N)
        if message_pairs > 0 and message_pairs % self.summarize_threshold == 0:
            # Get only the recent interactions to summarize (last N pairs)
            recent_interactions = self.storage.get_user_interactions(user_id, limit=self.summarize_threshold)
            
            # Summarize only these recent interactions (they'll be converted to memories)
            if recent_interactions:
                summary_data = self._summarize_conversations(recent_interactions, user_id)
                if summary_data:
                    self._save_summary_to_storage(user_id, summary_data, recent_interactions)
                    # Note: We don't clear the buffer - it maintains recent context
    
    def _select_relevant_memories(self, user_query: str, summaries: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Use LLM to select relevant memories from a list of summaries
        
        Args:
            user_query: Current user query (required)
            summaries: List of summary dictionaries
            top_k: Number of relevant memories to select (default: 5)
            
        Returns:
            List of selected relevant summary dictionaries
        """
        if not summaries:
            return []
        
        # LLM is guaranteed to exist (enforced in __init__ for solo mode)
        if len(summaries) <= top_k:
            # If we have fewer summaries than top_k, return all
            return summaries
        
        try:
            # Format summaries for analysis
            summaries_text = ""
            for i, summary in enumerate(summaries):
                summary_str = f"Memory {i}:\n"
                summary_str += f"  Summary: {summary.get('summary', 'N/A')}\n"
                summary_str += f"  Topics: {', '.join(summary.get('keyTopics', []))}\n"
                summary_str += f"  Facts: {', '.join(summary.get('importantFacts', []))}\n"
                user_ctx = summary.get('userContext', {})
                if user_ctx:
                    summary_str += f"  Context: {', '.join([f'{k}={v}' for k, v in user_ctx.items()])}\n"
                summaries_text += summary_str + "\n"
            
            # Create selection prompt
            selection_prompt = f"""Analyze these memories and select the {top_k} most relevant ones for this user query.

User Query: {user_query}

Memories:
{summaries_text}

Return ONLY valid JSON with this exact format:
{{
  "selected_indices": [0, 2, 5],
  "reason": "brief explanation of why these were selected"
}}

Return the indices (0-based) of the {top_k} most relevant memories. JSON only:"""
            
            # Use LLM to select (low temperature, no thinking mode for speed and simplicity)
            result = self.llm.generate(
                query=selection_prompt,
                quantum_influence=0.1,  # Very low influence for consistent selection
                conversation_context=None,
                max_length=800,  # Enough for JSON response
                enable_thinking=False  # Disable thinking mode for faster, simpler selection
            )
            
            selection_text = result.get('response', '').strip()
            
            # Extract JSON using utility (raises ValueError if parsing fails - critical error)
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
                # Critical error: LLM returned invalid indices - this should never happen
                raise ValueError(
                    f"Memory selection returned invalid indices: {selected_indices} "
                    f"(valid range: 0-{len(summaries)-1}). This is a critical error."
                )
            
        except Exception as e:
            # Critical error: Memory selection failed - this should never happen
            logger.error(f"Critical error selecting relevant memories: {e}")
            raise RuntimeError(f"Memory selection failed: {e}") from e
    
    def get_conversation_context(self, user_id: str, user_query: str) -> Dict[str, Any]:
        """
        Get conversation context in Qwen3-compatible format with intelligent memory selection
        
        Args:
            user_id: User identifier
            user_query: Current user query (required for memory selection)
        
        Returns:
            Dict with:
            - 'messages': List of message dicts for conversation history (Qwen3 format)
            - 'memories': String with summarized memories/bullet points for system message
        """
        conversation_messages = []
        memories_parts = []
        
        # Get recent messages from buffer window (recent conversation)
        # Convert to Qwen3 message format: [{"role": "user", "content": "..."}, ...]
        if user_id in self.buffers:
            buffer = self.buffers[user_id]
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
        all_summaries = self._load_all_summaries_from_storage(user_id, limit=30)
        
        if all_summaries:
            # Use LLM to select relevant memories if we have multiple summaries
            if len(all_summaries) > 1:
                selected_summaries = self._select_relevant_memories(user_query, all_summaries, top_k=5)
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
            "messages": conversation_messages,
            "memories": memories_str
        }
    
    def clear_buffer(self, user_id: str):
        """Clear recent conversation buffer for a user"""
        if user_id in self.buffers:
            self.buffers[user_id].clear()
            del self.buffers[user_id]
    
    def clear_all_buffers(self):
        """Clear all buffers (useful for testing)"""
        for user_id in list(self.buffers.keys()):
            self.clear_buffer(user_id)
"""
Memory Manager for The Obelisk
Uses LangChain for conversation memory management with Qwen LLM for summarization
"""
from typing import List, Dict, Any, Optional
from pathlib import Path
import os
import json
import re
from ..storage.base import StorageInterface
from ..utils.logger import get_logger

logger = get_logger(__name__)

# LangChain is REQUIRED - no fallback
try:
    from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
    from langchain_core.chat_history import InMemoryChatMessageHistory
except ImportError as e:
    raise ImportError(
        "LangChain is required for memory management. Please install it with: pip install langchain langchain-core"
    ) from e


class BufferWindowChatHistory:
    """
    Chat history with a sliding window of recent messages
    Implements buffer window memory using LangChain's InMemoryChatMessageHistory
    """
    def __init__(self, k: int = 10):
        """
        Initialize buffer window chat history
        
        Args:
            k: Number of recent message pairs to keep
        """
        self.k = k
        self.chat_history = InMemoryChatMessageHistory()
        self.all_messages: List[BaseMessage] = []  # Keep all messages for summarization
    
    def add_user_message(self, content: str):
        """Add a user message"""
        msg = HumanMessage(content=content)
        self.chat_history.add_message(msg)
        self.all_messages.append(msg)
        self._trim_to_window()
    
    def add_ai_message(self, content: str):
        """Add an AI message"""
        msg = AIMessage(content=content)
        self.chat_history.add_message(msg)
        self.all_messages.append(msg)
        self._trim_to_window()
    
    def _trim_to_window(self):
        """Trim chat history to keep only recent k message pairs"""
        # Keep last k*2 messages (k pairs of user+assistant)
        if len(self.chat_history.messages) > self.k * 2:
            # Keep only the most recent k*2 messages
            recent_messages = self.chat_history.messages[-(self.k * 2):]
            self.chat_history.messages = recent_messages
    
    def get_messages(self) -> List[BaseMessage]:
        """Get current messages in the buffer window"""
        return self.chat_history.messages
    
    def get_all_messages(self) -> List[BaseMessage]:
        """Get all messages (including those outside the window)"""
        return self.all_messages
    
    def clear(self):
        """Clear all messages"""
        self.chat_history.clear()
        self.all_messages = []


class ObeliskMemoryManager:
    """
    Manages conversation memory using LangChain
    - Uses buffer window memory for recent messages
    - Uses Qwen LLM for summarization (solo mode) or Mistral (prod mode, optional)
    - Stores conversation history via storage abstraction
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
        self.memories: Dict[str, BufferWindowChatHistory] = {}  # Store chat histories per user
        self.summaries: Dict[str, Dict[str, Any]] = {}  # Store summaries per user
    
    def get_memory(self, user_id: str) -> BufferWindowChatHistory:
        """
        Get or create chat history for a user
        
        Args:
            user_id: User identifier
            
        Returns:
            BufferWindowChatHistory instance
        """
        if user_id not in self.memories:
            # Load conversation history from storage
            interactions = self.storage.get_user_interactions(user_id, limit=100)
            
            # Create chat history
            chat_history = BufferWindowChatHistory(k=self.k)
            
            # Convert interactions to LangChain messages
            for interaction in interactions:
                query = interaction.get('query', '')
                response = interaction.get('response', '')
                if query:
                    chat_history.add_user_message(query)
                if response:
                    chat_history.add_ai_message(response)
            
            # If we have more messages than threshold, create summary
            if len(chat_history.get_all_messages()) > self.summarize_threshold * 2:
                # Try to load existing summary
                existing_summary = self._load_summary_from_storage(user_id)
                if existing_summary:
                    self.summaries[user_id] = existing_summary
                else:
                    # Create new summary from older interactions
                    older_interactions = interactions[:-self.k] if len(interactions) > self.k else []
                    if older_interactions:
                        summary_data = self._summarize_conversations(older_interactions, user_id)
                        if summary_data:
                            self.summaries[user_id] = summary_data
                            self._save_summary_to_storage(user_id, summary_data, older_interactions)
            
            self.memories[user_id] = chat_history
        
        return self.memories[user_id]
    
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
            
            # Remove thinking content if present (ObeliskLLM should extract it, but be defensive)
            # Qwen3 format: <think>...</think>
            summary_text = re.sub(r'<think>.*?</think>', '', summary_text, flags=re.DOTALL | re.IGNORECASE)
            summary_text = summary_text.strip()
            
            # Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
            # This handles cases where LLM wraps JSON in markdown code blocks
            summary_text = re.sub(r'^```(?:json)?\s*\n?', '', summary_text, flags=re.MULTILINE | re.IGNORECASE)
            summary_text = re.sub(r'\n?```\s*$', '', summary_text, flags=re.MULTILINE | re.IGNORECASE)
            summary_text = summary_text.strip()
            
            # Extract JSON - try multiple strategies
            
            # Strategy 1: Find complete JSON object by matching braces
            json_start = summary_text.find('{')
            if json_start >= 0:
                # Find matching closing brace
                brace_count = 0
                json_end = json_start
                for i in range(json_start, len(summary_text)):
                    if summary_text[i] == '{':
                        brace_count += 1
                    elif summary_text[i] == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            json_end = i + 1
                            break
                
                if json_end > json_start:
                    json_str = summary_text[json_start:json_end]
                    try:
                        summary_data = json.loads(json_str)
                        return summary_data
                    except json.JSONDecodeError:
                        pass
            
            # Strategy 2: Try parsing the whole response
            try:
                summary_data = json.loads(summary_text)
                return summary_data
            except json.JSONDecodeError:
                pass
            
            # Strategy 3: Try to fix incomplete JSON (add closing braces/brackets)
            try:
                open_braces = summary_text.count('{')
                close_braces = summary_text.count('}')
                open_brackets = summary_text.count('[')
                close_brackets = summary_text.count(']')
                
                missing_braces = open_braces - close_braces
                missing_brackets = open_brackets - close_brackets
                
                if missing_braces > 0 or missing_brackets > 0:
                    fixed_json = summary_text
                    if missing_brackets > 0:
                        fixed_json += ']' * missing_brackets
                    if missing_braces > 0:
                        fixed_json += '}' * missing_braces
                    summary_data = json.loads(fixed_json)
                    return summary_data
            except json.JSONDecodeError:
                pass
            
            # Fallback: Create minimal summary from what we can extract
            # Print warning - Rich's console.status() should handle this without breaking the spinner
            logger.warning(f"Could not parse JSON from summary. Response: {summary_text[:200]}")
            return {
                'summary': 'Previous conversation',
                'keyTopics': [],
                'userContext': {},
                'importantFacts': []
            }
            
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
    
    def _load_summary_from_storage(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Load the most recent summary from storage (backward compatibility)"""
        summaries = self._load_all_summaries_from_storage(user_id, limit=1)
        return summaries[0] if summaries else None
    
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
        memory = self.get_memory(user_id)
        
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
        
        # Add to memory buffer
        memory.add_user_message(query)
        memory.add_ai_message(response)
        
        # Check if we need to summarize (every N message pairs)
        all_messages = memory.get_all_messages()
        message_pairs = len(all_messages) // 2
        
        # Trigger summarization when we hit the threshold (every N interactions)
        # Only summarize when we have exactly N pairs (not on every interaction after N)
        if message_pairs > 0 and message_pairs % self.summarize_threshold == 0:
            # Get only the recent interactions to summarize (last N pairs, not all)
            interactions = self.storage.get_user_interactions(user_id, limit=self.summarize_threshold)
            
            # Summarize only these recent interactions (they'll be converted to memories)
            if interactions:
                summary_data = self._summarize_conversations(interactions, user_id)
                if summary_data:
                    self.summaries[user_id] = summary_data
                    self._save_summary_to_storage(user_id, summary_data, interactions)
                    # Clear the buffer after summarizing (memories are now in summary)
                    memory.clear()
    
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
        
        if not self.llm:
            # If no LLM, return most recent
            logger.warning("No LLM available for memory selection, using most recent summaries")
            return summaries[:top_k]
        
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
            
            # Strip markdown code blocks (thinking mode is disabled, so no thinking content to remove)
            selection_text = re.sub(r'^```(?:json)?\s*\n?', '', selection_text, flags=re.MULTILINE | re.IGNORECASE)
            selection_text = re.sub(r'\n?```\s*$', '', selection_text, flags=re.MULTILINE | re.IGNORECASE)
            selection_text = selection_text.strip()
            
            # Extract JSON - try multiple strategies (similar to summarization)
            selection_data = None
            
            # Strategy 1: Find complete JSON object by matching braces
            json_start = selection_text.find('{')
            if json_start >= 0:
                # Find matching closing brace
                brace_count = 0
                json_end = json_start
                for i in range(json_start, len(selection_text)):
                    if selection_text[i] == '{':
                        brace_count += 1
                    elif selection_text[i] == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            json_end = i + 1
                            break
                
                if json_end > json_start:
                    json_str = selection_text[json_start:json_end]
                    try:
                        selection_data = json.loads(json_str)
                    except json.JSONDecodeError:
                        pass
            
            # Strategy 2: Try parsing the whole response
            if not selection_data:
                try:
                    selection_data = json.loads(selection_text)
                except json.JSONDecodeError:
                    pass
            
            # Strategy 3: Try to fix incomplete JSON
            if not selection_data:
                try:
                    open_braces = selection_text.count('{')
                    close_braces = selection_text.count('}')
                    missing_braces = open_braces - close_braces
                    
                    if missing_braces > 0:
                        fixed_json = selection_text + '}' * missing_braces
                        selection_data = json.loads(fixed_json)
                except json.JSONDecodeError:
                    pass
            
            # Extract and validate indices
            if selection_data:
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
                    logger.warning(f"Memory selection returned invalid indices: {selected_indices} (valid range: 0-{len(summaries)-1})")
            else:
                logger.warning(f"Memory selection failed to parse JSON. LLM response: {selection_text[:200]}")
            
            # Fallback: return most recent if selection failed
            logger.warning("Memory selection failed, using most recent summaries")
            return summaries[:top_k]
            
        except Exception as e:
            logger.error(f"Error selecting relevant memories: {e}")
            # Fallback: return most recent
            return summaries[:top_k]
    
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
        if user_id in self.memories:
            chat_history = self.memories[user_id]
            messages = chat_history.get_messages()  # Use get_messages() method
            
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
            # Always use LLM to select relevant memories based on query
            if len(all_summaries) > 1:
                selected_summaries = self._select_relevant_memories(user_query, all_summaries, top_k=5)
            else:
                # Only one summary, use it
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
    
    def clear_memory(self, user_id: str):
        """Clear memory for a user"""
        if user_id in self.memories:
            self.memories[user_id].clear()
            del self.memories[user_id]
        if user_id in self.summaries:
            del self.summaries[user_id]
    
    def clear_all_memory(self):
        """Clear all memory (useful for testing)"""
        for user_id in list(self.memories.keys()):
            self.clear_memory(user_id)
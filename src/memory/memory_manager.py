"""
Memory Manager for The Obelisk
Uses LangChain for conversation memory management with Qwen LLM for summarization
"""
from typing import List, Dict, Any, Optional
import os
import json
from ..storage.base import StorageInterface

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
        summarize_threshold: int = 10,
        llm=None,  # ObeliskLLM instance for summarization (required in solo mode)
        mode: str = "solo"
    ):
        """
        Initialize memory manager
        
        Args:
            storage: StorageInterface instance
            k: Number of recent message pairs to keep in buffer (default: 10)
            summarize_threshold: Number of message pairs before summarizing older ones (default: 10)
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
            
            # Suppress debug output during summarization (internal operation)
            import sys
            from io import StringIO
            from contextlib import redirect_stdout, redirect_stderr
            
            # Temporarily suppress output during summarization
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                result = self.llm.generate(
                    query=summary_prompt,
                    quantum_influence=0.2,  # Lower influence for more consistent summaries
                    conversation_context=None,
                    max_length=500  # Allow more tokens for JSON generation
                )
            
            summary_text = result.get('response', '').strip()
            
            # Extract JSON - try multiple strategies
            import re
            
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
            print(f"[MEMORY] Warning: Could not parse JSON from summary. Response: {summary_text[:200]}")
            return {
                'summary': 'Previous conversation',
                'keyTopics': [],
                'userContext': {},
                'importantFacts': []
            }
            
        except Exception as e:
            print(f"[MEMORY] Error summarizing with LLM: {e}")
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
            print(f"[MEMORY] Error saving summary: {e}")
    
    def _load_summary_from_storage(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Load summary from storage"""
        # For now, return None and let it be recreated
        # In a full implementation, we'd query storage for existing summaries
        return None
    
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
        
        # Check if we need to summarize (every 10 message pairs)
        all_messages = memory.get_all_messages()
        message_pairs = len(all_messages) // 2
        
        # Trigger summarization when we hit the threshold (on 11th message pair)
        if message_pairs >= self.summarize_threshold:
            # Get all interactions from storage to summarize
            interactions = self.storage.get_user_interactions(user_id, limit=100)
            
            # Summarize all interactions (they'll be converted to memories)
            if interactions:
                summary_data = self._summarize_conversations(interactions, user_id)
                if summary_data:
                    self.summaries[user_id] = summary_data
                    self._save_summary_to_storage(user_id, summary_data, interactions)
                    # Clear the buffer after summarizing (memories are now in summary)
                    memory.clear()
    
    def get_conversation_context(self, user_id: str) -> Dict[str, Any]:
        """
        Get conversation context in Qwen3-compatible format
        
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
        
        # Add memories/summary (summarized older conversations)
        # These go in the system message as bullet points
        if user_id in self.summaries and self.summaries[user_id]:
            summary_data = self.summaries[user_id]
            
            # Format important facts as bullet points
            important_facts = summary_data.get('importantFacts', [])
            if important_facts:
                memories_parts.append("[Memories]")
                if isinstance(important_facts, list):
                    for fact in important_facts:
                        memories_parts.append(f"- {fact}")
                else:
                    memories_parts.append(f"- {important_facts}")
            
            # Add user context if available
            user_context = summary_data.get('userContext', {})
            if user_context and isinstance(user_context, dict):
                if memories_parts:
                    memories_parts.append("")  # Add separator
                memories_parts.append("[User Context]")
                for key, value in user_context.items():
                    memories_parts.append(f"- {key}: {value}")
        
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
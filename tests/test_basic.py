"""
Basic tests for Obelisk Core
Tests that the agent can respond and maintain memory
"""
import os
import sys
import tempfile
import shutil
from pathlib import Path

# Make pytest optional for direct execution
try:
    import pytest
    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False
    # Create a simple pytest-like fixture decorator for direct execution
    class MockPytest:
        @staticmethod
        def fixture(func):
            return func
    pytest = MockPytest()

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import Config
from src.storage import LocalJSONStorage
from src.llm.obelisk_llm import ObeliskLLM
from src.memory.memory_manager import ObeliskMemoryManager


@pytest.fixture
def temp_storage():
    """Create a temporary storage for testing (completely isolated)"""
    temp_dir = tempfile.mkdtemp(prefix='obelisk_test_')
    storage = LocalJSONStorage(storage_path=temp_dir)
    # Clear any existing data (fresh slate)
    try:
        # Clear all interactions if storage has any
        users = storage.get_all_user_ids()
        for user_id in users:
            interactions = storage.get_user_interactions(user_id, limit=1000)
            # Storage doesn't have delete methods, but temp dir will be removed
            pass
    except:
        pass
    yield storage
    # Cleanup: remove entire temp directory
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def llm(temp_storage):
    """Create LLM instance with temporary storage"""
    return ObeliskLLM(storage=temp_storage)


@pytest.fixture
def memory_manager(temp_storage, llm):
    """Create memory manager with temporary storage and LLM"""
    manager = ObeliskMemoryManager(
        storage=temp_storage,
        llm=llm,
        mode='solo'
    )
    # Clear all memory before test (fresh slate)
    manager.clear_all_memory()
    yield manager
    # Clear all memory after test (cleanup)
    manager.clear_all_memory()


class TestBasicInteraction:
    """Test basic interaction with the agent"""
    
    def test_hello_world(self, llm):
        """Test that the agent can respond to a simple greeting"""
        result = llm.generate(
            query="Hello, who are you?",
            quantum_influence=0.7
        )
        
        assert result is not None
        assert 'response' in result
        assert len(result['response']) > 0
        assert result.get('source') == 'obelisk_llm'
        print(f"\n✅ Hello World Test Passed")
        print(f"   Response: {result['response'][:100]}...")
    
    def test_model_loaded(self, llm):
        """Test that the model is loaded"""
        assert llm.model is not None
        assert llm.tokenizer is not None
        print(f"\n✅ Model Loaded Test Passed")
        print(f"   Device: {llm.device}")


class TestMemory:
    """Test memory functionality"""
    
    def test_memory_storage(self, temp_storage, memory_manager):
        """Test that we can store and retrieve information from memory - VERIFIES MODEL OUTPUT"""
        user_id = "test_user"
        
        # Tell the agent your favorite color
        favorite_color = "green"
        query1 = f"My favorite color is {favorite_color}."
        
        # Generate a response (acknowledgment)
        result1 = memory_manager.llm.generate(
            query=query1,
            quantum_influence=0.7,
            conversation_context=memory_manager.get_conversation_context(user_id)
        )
        response1 = result1.get('response', '')
        
        # Add to memory (handles storage internally - Option C)
        memory_manager.add_interaction(
            user_id=user_id,
            query=query1,
            response=response1,
            cycle_id=None,
            energy=0.0,
            quantum_seed=0.7,
            reward_score=0.0
        )
        
        # Now ask the agent to recall the favorite color
        query2 = "What is my favorite color?"
        
        # Get conversation context (should include the previous interaction)
        context = memory_manager.get_conversation_context(user_id)
        
        # Context is now a dict with 'messages' and 'memories'
        context_str = f"Messages: {context.get('messages', [])}\nMemories: {context.get('memories', '')}"
        
        # Debug: Show context
        print(f"\n[TEST DEBUG] Context before query: {context_str[:300]}...")
        
        # Generate response
        result2 = memory_manager.llm.generate(
            query=query2,
            quantum_influence=0.7,
            conversation_context=context
        )
        response2 = result2.get('response', '')
        response2_lower = response2.lower()
        
        # Debug: Show full response
        print(f"[TEST DEBUG] Full response: {response2}")
        print(f"[TEST DEBUG] Thinking content: {result2.get('thinking_content', 'N/A')[:200]}...")
        
        # Verify context contains the information (memory system works)
        # Check both messages and memories
        messages_text = ' '.join([msg.get('content', '') for msg in context.get('messages', [])])
        memories_text = context.get('memories', '')
        context_check = f"{messages_text} {memories_text}".lower()
        assert favorite_color.lower() in context_check, \
            f"Memory context does not contain favorite color. Context: {context}"
        
        # VERIFY MODEL OUTPUT: The response should mention the favorite color
        # This is the key test - the model should actually use the context
        assert favorite_color.lower() in response2_lower, \
            f"Model did not recall favorite color '{favorite_color}' in response. " \
            f"Response: '{response2}'. Context was: {context_str[:200]}..."
        
        print(f"\n✅ Memory Test Passed - Model correctly recalled favorite color")
        print(f"   Told agent: {query1}")
        print(f"   Asked: {query2}")
        print(f"   Response: {response2}")
    
    def test_multiple_interactions(self, temp_storage, memory_manager):
        """Test that memory persists across multiple interactions"""
        user_id = "test_user_2"
        
        # First interaction
        query1 = "My name is Alice."
        result1 = memory_manager.llm.generate(
            query=query1,
            quantum_influence=0.7
        )
        response1 = result1.get('response', '')
        # Add to memory (handles storage internally - Option C)
        memory_manager.add_interaction(user_id, query1, response1)
        
        # Second interaction
        query2 = "I like programming."
        result2 = memory_manager.llm.generate(
            query=query2,
            quantum_influence=0.7,
            conversation_context=memory_manager.get_conversation_context(user_id)
        )
        response2 = result2.get('response', '')
        # Add to memory (handles storage internally - Option C)
        memory_manager.add_interaction(user_id, query2, response2)
        
        # Third interaction - ask about name
        query3 = "What is my name?"
        context = memory_manager.get_conversation_context(user_id)
        
        # Context is now a dict with 'messages' and 'memories'
        messages_text = ' '.join([msg.get('content', '') for msg in context.get('messages', [])])
        memories_text = context.get('memories', '')
        context_check = f"{messages_text} {memories_text}".lower()
        
        # Verify context contains the name (memory is working)
        assert 'alice' in context_check, \
            f"Memory context does not contain name. Context: {context}"
        
        # Debug: Show context
        context_str = f"Messages: {context.get('messages', [])}\nMemories: {context.get('memories', '')}"
        print(f"\n[TEST DEBUG] Context before query: {context_str[:300]}...")
        
        result3 = memory_manager.llm.generate(
            query=query3,
            quantum_influence=0.7,
            conversation_context=context
        )
        response3 = result3.get('response', '')
        response3_lower = response3.lower()
        
        # Debug: Show full response
        print(f"[TEST DEBUG] Full response: {response3}")
        print(f"[TEST DEBUG] Thinking content: {result3.get('thinking_content', 'N/A')[:200]}...")
        
        # VERIFY MODEL OUTPUT: The response should mention the name
        assert 'alice' in response3_lower, \
            f"Model did not recall name 'Alice' in response. " \
            f"Response: '{response3}'. Context was: {context_str[:200]}..."
        
        print(f"\n✅ Multiple Interactions Test Passed - Model correctly recalled name")
        print(f"   Response to 'What is my name?': {response3}")


class TestStorage:
    """Test storage functionality"""
    
    def test_save_and_retrieve_interaction(self, temp_storage):
        """Test saving and retrieving interactions"""
        user_id = "test_user_3"
        
        # Save interaction
        interaction_id = temp_storage.save_interaction(
            user_id=user_id,
            query="Test query",
            response="Test response",
            cycle_id=None
        )
        
        assert interaction_id is not None
        
        # Retrieve interactions
        interactions = temp_storage.get_user_interactions(user_id)
        assert len(interactions) > 0
        assert interactions[-1]['query'] == "Test query"
        assert interactions[-1]['response'] == "Test response"
        
        print(f"\n✅ Storage Test Passed")
        print(f"   Saved and retrieved {len(interactions)} interaction(s)")


if __name__ == '__main__':
    """Run tests directly"""
    print("=" * 60)
    print("Running Obelisk Core Tests")
    print("=" * 60)
    
    # Create temporary storage
    temp_dir = tempfile.mkdtemp()
    try:
        storage = LocalJSONStorage(storage_path=temp_dir)
        llm = ObeliskLLM(storage=storage)
        memory_manager = ObeliskMemoryManager(
            storage=storage,
            llm=llm,
            mode='solo'
        )
        
        # Run basic tests
        test_basic = TestBasicInteraction()
        test_basic.test_hello_world(llm)
        test_basic.test_model_loaded(llm)
        
        # Run memory tests
        test_memory = TestMemory()
        test_memory.test_memory_storage(storage, memory_manager)
        test_memory.test_multiple_interactions(storage, memory_manager)
        
        # Run storage tests
        test_storage = TestStorage()
        test_storage.test_save_and_retrieve_interaction(storage)
        
        print("\n" + "=" * 60)
        print("✅ All Tests Passed!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Test Failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        shutil.rmtree(temp_dir)

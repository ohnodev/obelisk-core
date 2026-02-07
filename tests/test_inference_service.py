"""
Tests for the Obelisk Inference Service

Tests:
1. Model loading
2. Direct generation (no server)
3. Queue processing
4. HTTP API (server integration)

Usage:
    cd obelisk-core
    python -m pytest tests/test_inference_service.py -v
    
    # Or run directly for a quick smoke test:
    python tests/test_inference_service.py

    # To run via pytest (skipped by default — heavy integration tests):
    RUN_INTEGRATION_TESTS=1 python -m pytest tests/test_inference_service.py -v
"""
import asyncio
import sys
import os
import time

import pytest

# Skip the entire module unless the caller explicitly opts in.
pytestmark = pytest.mark.skipif(
    not os.getenv("RUN_INTEGRATION_TESTS"),
    reason="skip heavy integration tests unless RUN_INTEGRATION_TESTS is set",
)

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def test_model_loading():
    """Test that the model loads successfully"""
    print("\n" + "=" * 60)
    print("TEST 1: Model Loading")
    print("=" * 60)
    
    from src.inference.model import InferenceModel
    from src.inference.config import InferenceConfig
    
    print(f"  Model: {InferenceConfig.MODEL_NAME}")
    
    model = InferenceModel()
    assert not model.is_loaded, "Model should not be loaded yet"
    
    start = time.time()
    success = model.load()
    elapsed = time.time() - start
    
    print(f"  Loaded: {success}")
    print(f"  Time: {elapsed:.2f}s")
    print(f"  Device: {model.device}")
    print(f"  Memory: ~{model.estimate_memory()}MB")
    
    assert success, "Model should load successfully"
    assert model.is_loaded, "Model should be loaded"
    assert model.tokenizer is not None, "Tokenizer should be loaded"
    assert model.model is not None, "Model should be loaded"
    
    print("  PASSED")
    return model


def test_direct_generation(model):
    """Test direct generation without queue or server"""
    print("\n" + "=" * 60)
    print("TEST 2: Direct Generation")
    print("=" * 60)
    
    query = "What is 2 + 2?"
    system_prompt = "You are a helpful assistant. Be concise."
    
    print(f"  Query: {query}")
    print(f"  System: {system_prompt}")
    print("  Thinking: enabled")
    
    start = time.time()
    result = model.generate(
        query=query,
        system_prompt=system_prompt,
        enable_thinking=True,
        max_tokens=256,
        temperature=0.6,
    )
    elapsed = time.time() - start
    
    print(f"  Time: {elapsed:.2f}s")
    print(f"  Input tokens: {result['input_tokens']}")
    print(f"  Output tokens: {result['output_tokens']}")
    print(f"  Error: {result.get('error')}")
    print(f"  Thinking: {result['thinking_content'][:100]}..." if result['thinking_content'] else "  Thinking: (none)")
    print(f"  Response: {result['response'][:200]}..." if len(result['response']) > 200 else f"  Response: {result['response']}")
    
    assert result['error'] is None, f"Should not have error: {result['error']}"
    assert result['response'], "Should have a response"
    assert result['input_tokens'] > 0, "Should have input tokens"
    assert result['output_tokens'] > 0, "Should have output tokens"
    assert result['source'] == "inference_service", "Source should be inference_service"
    
    print("  PASSED")
    return result


def test_generation_no_thinking(model):
    """Test generation with thinking mode disabled"""
    print("\n" + "=" * 60)
    print("TEST 3: Generation (no thinking)")
    print("=" * 60)
    
    query = "Say hello in one sentence."
    system_prompt = "You are a friendly assistant."
    
    print(f"  Query: {query}")
    print("  Thinking: disabled")
    
    start = time.time()
    result = model.generate(
        query=query,
        system_prompt=system_prompt,
        enable_thinking=False,
        max_tokens=128,
    )
    elapsed = time.time() - start
    
    print(f"  Time: {elapsed:.2f}s")
    print(f"  Thinking content: '{result['thinking_content']}'")
    print(f"  Response: {result['response']}")
    
    assert result['error'] is None, f"Should not have error: {result['error']}"
    assert result['response'], "Should have a response"
    assert result['thinking_content'] == "", "Should have no thinking content when disabled"
    
    print("  PASSED")


def test_generation_with_history(model):
    """Test generation with conversation history"""
    print("\n" + "=" * 60)
    print("TEST 4: Generation with conversation history")
    print("=" * 60)
    
    history = [
        {"role": "user", "content": "My name is Alice."},
        {"role": "assistant", "content": "Hello Alice! Nice to meet you."},
    ]
    query = "What is my name?"
    system_prompt = "You are a helpful assistant. Remember what the user tells you."
    
    print(f"  History: {len(history)} messages")
    print(f"  Query: {query}")
    
    start = time.time()
    result = model.generate(
        query=query,
        system_prompt=system_prompt,
        conversation_history=history,
        enable_thinking=True,
        max_tokens=256,
    )
    elapsed = time.time() - start
    
    print(f"  Time: {elapsed:.2f}s")
    print(f"  Response: {result['response']}")
    
    assert result['error'] is None, f"Should not have error: {result['error']}"
    assert result['response'], "Should have a response"
    # The model should recall the name from history
    response_lower = result['response'].lower()
    assert 'alice' in response_lower, f"Response should mention 'Alice', got: {result['response']}"
    
    print("  PASSED")


def test_queue_processing(model):
    """Test the async queue"""
    print("\n" + "=" * 60)
    print("TEST 5: Queue Processing")
    print("=" * 60)
    
    from src.inference.queue import InferenceQueue
    from src.inference.types import InferenceRequest
    
    async def run_queue_test():
        queue = InferenceQueue(model)
        await queue.start()
        
        try:
            # Submit a single request
            request = InferenceRequest(
                query="What color is the sky?",
                system_prompt="Answer in one word.",
                enable_thinking=False,
                max_tokens=64,
            )
            
            print("  Submitting request...")
            print(f"  Queue pending: {queue.pending_count}")
            
            start = time.time()
            result = await queue.submit(request, timeout=60)
            elapsed = time.time() - start
            
            print(f"  Time: {elapsed:.2f}s")
            print(f"  Response: {result['response']}")
            print(f"  Total processed: {queue.total_processed}")
            
            assert result['response'], "Should have a response"
            assert queue.total_processed == 1, "Should have processed 1 request"
            
            # Submit two requests concurrently
            print("\n  Submitting 2 concurrent requests...")
            req1 = InferenceRequest(
                query="What is 1+1?",
                system_prompt="Answer with just the number.",
                enable_thinking=False,
                max_tokens=32,
            )
            req2 = InferenceRequest(
                query="What is 3+3?",
                system_prompt="Answer with just the number.",
                enable_thinking=False,
                max_tokens=32,
            )
            
            start = time.time()
            results = await asyncio.gather(
                queue.submit(req1, timeout=60),
                queue.submit(req2, timeout=60),
            )
            elapsed = time.time() - start
            
            print(f"  Time (both): {elapsed:.2f}s")
            print(f"  Response 1: {results[0]['response']}")
            print(f"  Response 2: {results[1]['response']}")
            print(f"  Total processed: {queue.total_processed}")
            
            assert results[0]['response'], "First request should have response"
            assert results[1]['response'], "Second request should have response"
            assert queue.total_processed == 3, "Should have processed 3 total requests"
            
        finally:
            await queue.stop()
    
    asyncio.run(run_queue_test())
    print("  PASSED")


def test_parameter_validation(model):
    """Test that invalid parameters are clamped properly"""
    print("\n" + "=" * 60)
    print("TEST 6: Parameter Validation")
    print("=" * 60)
    
    # Temperature too high
    result = model.generate(
        query="Hello",
        system_prompt="Be brief.",
        temperature=999.0,
        max_tokens=32,
        enable_thinking=False,
    )
    
    assert result['error'] is None, f"Should not error: {result['error']}"
    assert result['generation_params']['temperature'] <= 2.0, "Temperature should be clamped"
    print(f"  Temperature 999.0 -> clamped to {result['generation_params']['temperature']}")
    
    # top_p too low
    result = model.generate(
        query="Hello",
        system_prompt="Be brief.",
        top_p=-1.0,
        max_tokens=32,
        enable_thinking=False,
    )
    
    assert result['error'] is None, f"Should not error: {result['error']}"
    assert result['generation_params']['top_p'] >= 0.01, "top_p should be clamped"
    print(f"  top_p -1.0 -> clamped to {result['generation_params']['top_p']}")
    
    print("  PASSED")


def run_all_tests():
    """Run all tests sequentially"""
    print("=" * 60)
    print("OBELISK INFERENCE SERVICE - TEST SUITE")
    print("=" * 60)
    
    start = time.time()
    
    # Test 1: Model loading
    model = test_model_loading()
    
    # Test 2: Direct generation
    test_direct_generation(model)
    
    # Test 3: No thinking
    test_generation_no_thinking(model)
    
    # Test 4: With history
    test_generation_with_history(model)
    
    # Test 5: Queue
    test_queue_processing(model)
    
    # Test 6: Parameter validation
    test_parameter_validation(model)
    
    elapsed = time.time() - start
    print("\n" + "=" * 60)
    print(f"ALL TESTS PASSED ({elapsed:.1f}s)")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()

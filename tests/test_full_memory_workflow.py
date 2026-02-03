#!/usr/bin/env python3
"""
Test the full memory workflow with all nodes properly wired up
Tests the complete flow: Text → MemoryStorage → MemorySelector → Inference → MemoryCreator
"""
import pytest
import requests
import json
from json import JSONDecodeError
import sys
import os
from pathlib import Path

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
WORKFLOWS_DIR = REPO_ROOT / "ui" / "workflows"

API_BASE_URL = os.getenv("OBELISK_API_URL", "http://localhost:7779")


def load_default_workflow() -> dict:
    """Load the default workflow from default.json"""
    filepath = WORKFLOWS_DIR / "default.json"
    with open(filepath, "r") as f:
        return json.load(f)


def is_server_available() -> bool:
    """Check if the API server is available"""
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=2)
        return response.status_code == 200
    except requests.exceptions.RequestException:
        # Only catch network/HTTP-related errors, let other exceptions propagate
        return False


@pytest.mark.integration
@pytest.mark.skipif(
    not is_server_available() and API_BASE_URL == "http://localhost:7779",
    reason="Integration test requires running API server. Set OBELISK_API_URL or start the server."
)
def test_full_memory_workflow():
    """Test the full memory workflow execution"""
    print("=" * 60)
    print("Testing Full Memory Workflow")
    print("=" * 60)
    
    # Load the default workflow
    try:
        workflow = load_default_workflow()
        print(f"✅ Loaded workflow: {workflow.get('name', 'Unknown')}")
        print(f"📦 Nodes: {len(workflow.get('nodes', []))}")
        print(f"🔗 Connections: {len(workflow.get('connections', []))}")
    except FileNotFoundError:
        pytest.fail(f"Could not find default.json in {WORKFLOWS_DIR}")
    except Exception as e:
        pytest.fail(f"Error loading default.json: {e}")
    
    # Prepare request with test data
    url = f"{API_BASE_URL}/api/v1/workflow/execute"
    payload = {
        "workflow": workflow,
        "options": {
            "client_id": "test_user_full_memory",
            "user_query": "My name is Alice and I love programming.",
            "user_id": "test_user_full_memory",
        },
    }
    
    print(f"\n📤 Sending request to {url}...")
    print(f"   User Query: {payload['options']['user_query']}")
    print(f"   User ID: {payload['options']['user_id']}")
    print()
    
    try:
        response = requests.post(url, json=payload, timeout=120)
        response.raise_for_status()
        
        result = response.json()
        print("✅ Request successful!")
        print(f"📊 Status: {result.get('status')}")
        print()
        
        # Check execution status
        if result.get("status") == "error":
            error_msg = result.get('error', 'Unknown error')
            print(f"❌ Execution failed: {error_msg}")
            if result.get('message'):
                print(f"   Message: {result.get('message')}")
            if result.get('traceback'):
                print(f"   Traceback: {result.get('traceback')}")
            pytest.fail(f"Execution failed: {error_msg}")
        
        # Check results
        results = result.get("results", {})
        assert results, "No results returned"
        
        execution_order = result.get("execution_order", [])
        if execution_order:
            print(f"📋 Execution Order: {' → '.join(execution_order)}")
        print()
        
        # Verify each node executed successfully
        print("📋 Node Execution Results:")
        node_checks = {
            "memory_storage": False,
            "memory_selector": False,
            "model_loader": False,
            "inference": False,
            "memory_creator": False,
            "text_output": False,
        }
        
        for node_id in execution_order:
            if node_id in results:
                node_result = results[node_id]
                node_type = None
                
                # Find node type from workflow
                for node in workflow.get("nodes", []):
                    if str(node["id"]) == str(node_id):
                        node_type = node.get("type")
                        break
                
                outputs = node_result.get("outputs", {})
                status = node_result.get("status", "unknown")
                
                print(f"  Node {node_id} ({node_type}): {status}")
                
                # Check specific node outputs
                if node_type == "memory_storage":
                    if "storage_instance" in outputs:
                        node_checks["memory_storage"] = True
                        print("    ✅ Storage instance created")
                
                elif node_type == "memory_selector":
                    if "context" in outputs and "query" in outputs:
                        node_checks["memory_selector"] = True
                        context = outputs.get("context", {})
                        print(f"    ✅ Context selected (messages: {len(context.get('messages', []))}, memories: {len(str(context.get('memories', '')))})")
                        print(f"    ✅ Query passed through: {str(outputs.get('query', ''))[:50]}...")
                
                elif node_type == "model_loader":
                    if "model" in outputs:
                        node_checks["model_loader"] = True
                        print("    ✅ Model loaded")
                
                elif node_type == "inference":
                    if "response" in outputs and "query" in outputs:
                        node_checks["inference"] = True
                        response = outputs.get("response", "")
                        print(f"    ✅ Response generated ({len(str(response))} chars)")
                        print(f"    ✅ Query output: {str(outputs.get('query', ''))[:50]}...")
                
                elif node_type == "memory_creator":
                    # MemoryCreatorNode has no outputs (saves directly)
                    # If node is in results, it executed successfully
                    # Check that it's in the execution order and results
                    if node_id in results:
                        node_checks["memory_creator"] = True
                        print("    ✅ Memory saved (no outputs - saves directly)")
                
                elif node_type == "text":
                    # Check if this is the output text node
                    if "text" in outputs:
                        text_value = outputs.get("text", "")
                        if len(str(text_value)) > 0:
                            node_checks["text_output"] = True
                            print(f"    ✅ Text output: {str(text_value)[:100]}...")
        
        print()
        print("=" * 60)
        print("Verification Summary:")
        print("=" * 60)
        
        all_passed = True
        for check_name, passed in node_checks.items():
            status = "✅" if passed else "❌"
            print(f"  {status} {check_name.replace('_', ' ').title()}")
            if not passed:
                all_passed = False
        
        assert all_passed, "Some nodes did not execute correctly"
        
        if all_passed:
            print()
            print("✅ All memory workflow nodes executed successfully!")
            
            # Verify memory was actually saved by running a second query
            print()
            print("=" * 60)
            print("Testing Memory Persistence (Second Query)")
            print("=" * 60)
            
            payload2 = {
                "workflow": workflow,
                "options": {
                    "client_id": "test_user_full_memory",
                    "user_query": "What is my name?",
                    "user_id": "test_user_full_memory",
                },
            }
            
            print(f"📤 Sending second query: {payload2['options']['user_query']}")
            response2 = requests.post(url, json=payload2, timeout=120)
            response2.raise_for_status()
            
            result2 = response2.json()
            if result2.get("status") == "error":
                pytest.fail(f"Second query failed: {result2.get('error', 'Unknown error')}")
            
            results2 = result2.get("results", {})
            # Find inference node response
            inference_found = False
            for node_id, node_result in results2.items():
                node_type = None
                for node in workflow.get("nodes", []):
                    if str(node["id"]) == str(node_id):
                        node_type = node.get("type")
                        break
                
                if node_type == "inference":
                    inference_found = True
                    response_text = node_result.get("outputs", {}).get("response", "")
                    response_lower = str(response_text).lower()
                    print(f"   Response to 'What is my name?': {response_text[:200]}...")
                    assert "alice" in response_lower, f"Memory persistence test failed: Response should contain 'Alice' based on memory. Response: {response_text[:200]}..."
                    print("✅ Memory persistence verified!")
                    break  # Found and verified, no need to continue
            
            assert inference_found, "Could not find inference response in second query"
        
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection error: Could not connect to {API_BASE_URL}")
        print("   Make sure the backend server is running on port 7779")
        pytest.fail(f"Connection error: Could not connect to {API_BASE_URL}")
    except requests.exceptions.Timeout:
        print("❌ Request timed out")
        pytest.fail("Request timed out")
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP error: {e}")
        if hasattr(e.response, 'text'):
            print(f"   Response: {e.response.text[:500]}")
        if hasattr(e.response, 'json'):
            try:
                error_json = e.response.json()
                print(f"   Error details: {json.dumps(error_json, indent=2)}")
            except (ValueError, JSONDecodeError) as exc:
                print(f"   Failed to parse error response as JSON: {exc}")
        pytest.fail(f"HTTP error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        pytest.fail(f"Unexpected error: {e}")


if __name__ == "__main__":
    # Allow running as a script for convenience
    pytest.main([__file__, "-v"])

#!/usr/bin/env python3
"""
Test inference node chaining and memory adapter integration
Tests both basic chaining (no memory) and memory chaining
"""
import requests
import json
import sys
import os

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Go up one level to repo root, then into ui/workflows
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
WORKFLOWS_DIR = os.path.join(REPO_ROOT, "ui", "workflows")

API_BASE_URL = "http://localhost:7779"


def create_basic_chain_workflow() -> dict:
    """
    Create a basic direct chaining workflow: Text → Inference → Inference → Text
    No memory adapter - direct inference-to-inference chaining (no intermediate text node)
    """
    return {
        "id": "basic-chain-test",
        "name": "Direct Inference Chaining Test",
        "nodes": [
            {
                "id": "1",
                "type": "text",
                "position": {"x": 100, "y": 200},
                "metadata": {"text": "What is 2+2?"}
            },
            {
                "id": "2",
                "type": "model_loader",
                "position": {"x": 300, "y": 100},
                "inputs": {}
            },
            {
                "id": "3",
                "type": "inference",
                "position": {"x": 500, "y": 200},
                "inputs": {
                    "quantum_influence": 0.7,
                    "max_length": 1024
                }
            },
            {
                "id": "4",
                "type": "inference",
                "position": {"x": 800, "y": 200},
                "inputs": {
                    "quantum_influence": 0.7,
                    "max_length": 1024
                }
            },
            {
                "id": "5",
                "type": "text",
                "position": {"x": 1100, "y": 200},
                "inputs": {"text": ""}
            }
        ],
        "connections": [
            {
                "from": "1",
                "from_output": "text",
                "to": "3",
                "to_input": "query"
            },
            {
                "from": "2",
                "from_output": "model",
                "to": "3",
                "to_input": "model"
            },
            {
                "from": "3",
                "from_output": "response",
                "to": "4",
                "to_input": "query"
            },
            {
                "from": "2",
                "from_output": "model",
                "to": "4",
                "to_input": "model"
            },
            {
                "from": "4",
                "from_output": "response",
                "to": "5",
                "to_input": "text"
            }
        ]
    }


def create_memory_chain_workflow() -> dict:
    """
    Create a memory chaining workflow: 
    Text → Memory Storage → Memory Selector → Inference → Memory Creator → Text
    Uses the new decomposed memory nodes
    """
    return {
        "id": "memory-chain-test",
        "name": "Memory Inference Chaining Test",
        "nodes": [
            {
                "id": "1",
                "type": "text",
                "position": {"x": 100, "y": 300},
                "metadata": {"text": "My name is Alice"}
            },
            {
                "id": "2",
                "type": "model_loader",
                "position": {"x": 300, "y": 100},
                "inputs": {}
            },
            {
                "id": "3",
                "type": "memory_storage",
                "position": {"x": 300, "y": 300},
                "inputs": {
                    "storage_type": "local_json"
                }
            },
            {
                "id": "4",
                "type": "memory_selector",
                "position": {"x": 500, "y": 300},
                "inputs": {
                    "user_id": "test_user_memory",
                    "enable_recent_buffer": True,
                    "k": 10
                }
            },
            {
                "id": "5",
                "type": "inference",
                "position": {"x": 700, "y": 300},
                "inputs": {
                    "quantum_influence": 0.7,
                    "max_length": 1024
                }
            },
            {
                "id": "6",
                "type": "memory_creator",
                "position": {"x": 900, "y": 300},
                "inputs": {
                    "user_id": "test_user_memory",
                    "summarize_threshold": 3,
                    "k": 10
                }
            },
            {
                "id": "7",
                "type": "text",
                "position": {"x": 1100, "y": 300},
                "inputs": {"text": ""}
            }
        ],
        "connections": [
            {
                "from": "1",
                "from_output": "text",
                "to": "4",
                "to_input": "query"
            },
            {
                "from": "1",
                "from_output": "text",
                "to": "5",
                "to_input": "query"
            },
            {
                "from": "2",
                "from_output": "model",
                "to": "5",
                "to_input": "model"
            },
            {
                "from": "3",
                "from_output": "storage_instance",
                "to": "4",
                "to_input": "storage_instance"
            },
            {
                "from": "4",
                "from_output": "context",
                "to": "5",
                "to_input": "context"
            },
            {
                "from": "5",
                "from_output": "response",
                "to": "6",
                "to_input": "response"
            },
            {
                "from": "1",
                "from_output": "text",
                "to": "6",
                "to_input": "query"
            },
            {
                "from": "3",
                "from_output": "storage_instance",
                "to": "6",
                "to_input": "storage_instance"
            },
            {
                "from": "5",
                "from_output": "response",
                "to": "7",
                "to_input": "text"
            }
        ]
    }


def test_workflow_execution(workflow: dict, workflow_name: str) -> bool:
    """Test executing a workflow"""
    print(f"\n🧪 Testing workflow: {workflow_name}")
    print(f"📋 Workflow: {workflow.get('name', 'Unknown')}")
    print(f"📦 Nodes: {len(workflow.get('nodes', []))}")
    print(f"🔗 Connections: {len(workflow.get('connections', []))}")
    print()

    # Prepare request
    url = f"{API_BASE_URL}/api/v1/workflow/execute"
    payload = {
        "workflow": workflow,
        "options": {
            "client_id": "test_user",
        },
    }

    print(f"📤 Sending request to {url}...")
    try:
        response = requests.post(url, json=payload, timeout=60)
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
            return False

        # Check results
        results = result.get("results", {})
        if not results:
            print("⚠️  No results returned")
            return False

        print("📋 Execution Results:")
        execution_order = result.get("execution_order", [])
        if execution_order:
            print(f"   Execution order: {' → '.join(execution_order)}")
        print()
        
        for node_id in execution_order:
            if node_id in results:
                node_result = results[node_id]
                outputs = node_result.get("outputs", {})
                print(f"  Node {node_id}:")
                for output_name, output_value in outputs.items():
                    # Truncate long outputs for display
                    value_str = str(output_value)
                    if len(value_str) > 150:
                        value_str = value_str[:150] + "..."
                    print(f"    - {output_name}: {value_str}")

        # Verify chaining worked
        print()
        print("🔍 Verifying chaining...")
        
        # Check that inference nodes got different inputs
        inference_nodes = [n for n in workflow['nodes'] if n['type'] == 'inference']
        if len(inference_nodes) >= 2:
            first_inf_id = inference_nodes[0]['id']
            second_inf_id = inference_nodes[1]['id']
            
            if first_inf_id in results and second_inf_id in results:
                first_response = results[first_inf_id].get('outputs', {}).get('response', '')
                second_query = results.get(second_inf_id, {}).get('outputs', {}).get('query', '')
                
                # In a chain, the second inference should receive the first's response
                # (through a text node)
                print(f"   First inference response length: {len(str(first_response))}")
                print(f"   Second inference should receive first response as input")
                
                if first_response and len(str(first_response)) > 0:
                    print("   ✅ First inference produced output")
                else:
                    print("   ⚠️  First inference produced empty output")
                
                if second_query or results[second_inf_id].get('outputs', {}).get('response'):
                    print("   ✅ Second inference received input and produced output")
                else:
                    print("   ⚠️  Second inference may not have received input correctly")

        # Find final output node
        output_node_id = None
        node_ids = {node["id"] for node in workflow.get("nodes", [])}
        connected_from = {conn.get("from") or conn.get("source_node") for conn in workflow.get("connections", [])}
        
        potential_outputs = node_ids - connected_from
        if potential_outputs:
            output_node_id = max(potential_outputs, key=lambda x: int(x) if str(x).isdigit() else 0)
        else:
            if workflow.get("nodes"):
                output_node_id = workflow["nodes"][-1]["id"]

        if output_node_id:
            node_result = results.get(str(output_node_id))
            if node_result:
                outputs = node_result.get("outputs", {})
                text_output = outputs.get("text") or outputs.get("output")
                
                if text_output:
                    print()
                    print(f"✅ Final output node ({output_node_id}) has result!")
                    print(f"📝 Output: {str(text_output)[:200]}...")
                    return True
                else:
                    print()
                    print(f"⚠️  Final output node ({output_node_id}) has no text output")
                    return False
            else:
                print()
                print(f"⚠️  Final output node ({output_node_id}) not found in results")
                return False
        else:
            print()
            print("⚠️  Could not identify output node")
            return False

    except requests.exceptions.ConnectionError:
        print(f"❌ Connection error: Could not connect to {API_BASE_URL}")
        print("   Make sure the backend server is running on port 7779")
        return False
    except requests.exceptions.Timeout:
        print("❌ Request timed out")
        return False
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP error: {e}")
        if hasattr(e.response, 'text'):
            print(f"   Response: {e.response.text}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("=" * 60)
    print("Obelisk Core - Inference Chaining Tests")
    print("=" * 60)

    # Test 1: Basic direct chaining (no memory, no intermediate text node)
    print("\n" + "=" * 60)
    print("TEST 1: Direct Inference Chaining (No Memory, No Intermediate Text)")
    print("=" * 60)
    basic_workflow = create_basic_chain_workflow()
    test1_passed = test_workflow_execution(basic_workflow, "Direct Chain (Inference → Inference)")

    # Test 2: Memory chaining
    print("\n" + "=" * 60)
    print("TEST 2: Memory Inference Chaining")
    print("=" * 60)
    memory_workflow = create_memory_chain_workflow()
    test2_passed = test_workflow_execution(memory_workflow, "Memory Chain (Memory → Inference → Text → Inference)")

    print()
    print("=" * 60)
    if test1_passed and test2_passed:
        print("✅ All Tests PASSED")
        sys.exit(0)
    else:
        print("❌ Some Tests FAILED")
        if not test1_passed:
            print("   - Basic chaining test failed")
        if not test2_passed:
            print("   - Memory chaining test failed")
        sys.exit(1)


if __name__ == "__main__":
    main()

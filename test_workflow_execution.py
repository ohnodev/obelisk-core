#!/usr/bin/env python3
"""
Test script to execute workflows and verify output
Tests both simple 4-node workflow and 6-node memory workflow
"""
import requests
import json
import sys
import os

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKFLOWS_DIR = os.path.join(SCRIPT_DIR, "ui", "workflows")

API_BASE_URL = "http://localhost:7779"


def load_workflow(filename: str) -> dict:
    """Load workflow from JSON file"""
    filepath = os.path.join(WORKFLOWS_DIR, filename)
    with open(filepath, "r") as f:
        return json.load(f)


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
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        print(f"✅ Request successful!")
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
        for node_id, node_result in results.items():
            outputs = node_result.get("outputs", {})
            print(f"  Node {node_id}: {len(outputs)} output(s)")
            for output_name, output_value in outputs.items():
                # Truncate long outputs for display
                value_str = str(output_value)
                if len(value_str) > 100:
                    value_str = value_str[:100] + "..."
                print(f"    - {output_name}: {value_str}")

        # Find output text node (last node or node with no outgoing connections)
        output_node_id = None
        node_ids = {node["id"] for node in workflow.get("nodes", [])}
        connected_from = {conn.get("from") or conn.get("source_node") for conn in workflow.get("connections", [])}
        
        # Find nodes that are not sources of connections (likely output nodes)
        potential_outputs = node_ids - connected_from
        if potential_outputs:
            # Use the last node ID as output (usually the final text node)
            output_node_id = max(potential_outputs, key=lambda x: int(x) if x.isdigit() else 0)
        else:
            # Fallback: use the last node in the list
            if workflow.get("nodes"):
                output_node_id = workflow["nodes"][-1]["id"]

        if output_node_id:
            node_result = results.get(str(output_node_id))
            if node_result:
                outputs = node_result.get("outputs", {})
                text_output = outputs.get("text") or outputs.get("output")
                
                if text_output:
                    print()
                    print(f"✅ Output text node ({output_node_id}) updated successfully!")
                    print(f"📝 Output: {str(text_output)[:200]}...")
                    return True
                else:
                    print()
                    print(f"⚠️  Output text node ({output_node_id}) has no text output")
                    return False
            else:
                print()
                print(f"⚠️  Output text node ({output_node_id}) not found in results")
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
        if hasattr(e.response, 'json'):
            try:
                error_json = e.response.json()
                print(f"   Error details: {json.dumps(error_json, indent=2)}")
            except json.JSONDecodeError as decode_err:
                print(f"   ⚠️  Failed to parse error response as JSON: {decode_err}")
                print(f"   Raw response text: {e.response.text[:500] if hasattr(e.response, 'text') else 'N/A'}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("=" * 60)
    print("Obelisk Core - Workflow Execution Tests")
    print("=" * 60)

    # Test 1: Simple 4-node workflow
    try:
        simple_workflow = load_workflow("chat.json")
        test1_passed = test_workflow_execution(simple_workflow, "Simple Chat (4 nodes)")
    except FileNotFoundError:
        print(f"\n❌ Could not find chat.json in {WORKFLOWS_DIR}")
        test1_passed = False
    except Exception as e:
        print(f"\n❌ Error loading chat.json: {e}")
        test1_passed = False

    # Test 2: Memory workflow (6 nodes)
    try:
        memory_workflow = load_workflow("chat-memory.json")
        test2_passed = test_workflow_execution(memory_workflow, "Chat with Memory (6 nodes)")
    except FileNotFoundError:
        print(f"\n❌ Could not find chat-memory.json in {WORKFLOWS_DIR}")
        test2_passed = False
    except Exception as e:
        print(f"\n❌ Error loading chat-memory.json: {e}")
        test2_passed = False

    print()
    print("=" * 60)
    if test1_passed and test2_passed:
        print("✅ All Tests PASSED")
        sys.exit(0)
    else:
        print("❌ Some Tests FAILED")
        if not test1_passed:
            print("   - Simple Chat workflow failed")
        if not test2_passed:
            print("   - Chat with Memory workflow failed")
        sys.exit(1)


if __name__ == "__main__":
    main()

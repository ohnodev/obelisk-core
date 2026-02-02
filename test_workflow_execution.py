#!/usr/bin/env python3
"""
Simple test script to execute the default workflow and verify output
"""
import requests
import json
import sys

# Default workflow from frontend (matches DEFAULT_WORKFLOW in page.tsx)
DEFAULT_WORKFLOW = {
    "id": "obelisk-chat-workflow",
    "name": "Basic Chat Workflow",
    "nodes": [
        {
            "id": "1",
            "type": "text",
            "position": {"x": 100, "y": 300},
            "metadata": {
                "text": "Hello world!",
            },
        },
        {
            "id": "2",
            "type": "model_loader",
            "position": {"x": 300, "y": 120},
            "inputs": {
                "model_path": "models/default_model",
                "auto_load": True,
            },
        },
        {
            "id": "3",
            "type": "sampler",
            "position": {"x": 700, "y": 300},
            "inputs": {
                "quantum_influence": 0.7,
                "max_length": 1024,
            },
        },
        {
            "id": "4",
            "type": "text",
            "position": {"x": 1000, "y": 300},
            "inputs": {
                "text": "",
            },
        },
    ],
    "connections": [
        {
            "from": "1",
            "from_output": "text",
            "to": "3",
            "to_input": "query",
        },
        {
            "from": "2",
            "from_output": "model",
            "to": "3",
            "to_input": "model",
        },
        {
            "from": "3",
            "from_output": "response",
            "to": "4",
            "to_input": "text",
        },
    ],
}

API_BASE_URL = "http://localhost:7779"


def test_workflow_execution():
    """Test executing the default workflow"""
    print("🧪 Testing workflow execution...")
    print(f"📋 Workflow: {DEFAULT_WORKFLOW['name']}")
    print(f"📦 Nodes: {len(DEFAULT_WORKFLOW['nodes'])}")
    print(f"🔗 Connections: {len(DEFAULT_WORKFLOW['connections'])}")
    print()

    # Prepare request
    url = f"{API_BASE_URL}/api/v1/workflow/execute"
    payload = {
        "workflow": DEFAULT_WORKFLOW,
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
            print(f"   Full response: {json.dumps(result, indent=2)}")
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

        # Verify output text node (node 4) was updated
        node_4_result = results.get("4")
        if node_4_result:
            outputs = node_4_result.get("outputs", {})
            text_output = outputs.get("text") or outputs.get("output")
            
            if text_output:
                print()
                print(f"✅ Output text node (4) updated successfully!")
                print(f"📝 Output: {text_output[:200]}...")
                return True
            else:
                print()
                print("⚠️  Output text node (4) has no text output")
                return False
        else:
            print()
            print("⚠️  Output text node (4) not found in results")
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
            except:
                pass
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("Obelisk Core - Workflow Execution Test")
    print("=" * 60)
    print()

    success = test_workflow_execution()

    print()
    print("=" * 60)
    if success:
        print("✅ Test PASSED")
        sys.exit(0)
    else:
        print("❌ Test FAILED")
        sys.exit(1)

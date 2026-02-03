#!/usr/bin/env python3
"""
Test memory retrieval - specifically tests that recent conversations are retrieved
and used in subsequent queries.

Test scenario:
1. First query: "My favorite color is green"
2. Second query: "What's my favorite color?"
3. Expected: Response should mention "green" based on recent conversation buffer
"""
import requests
import json
import sys
import os

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
WORKFLOWS_DIR = os.path.join(REPO_ROOT, "ui", "workflows")

API_BASE_URL = os.getenv("OBELISK_API_URL", "http://localhost:7779")


def load_default_workflow() -> dict:
    """Load the default workflow from default.json"""
    filepath = os.path.join(WORKFLOWS_DIR, "default.json")
    with open(filepath, "r") as f:
        return json.load(f)


def test_memory_retrieval() -> bool:
    """Test that recent conversations are retrieved and used"""
    print("=" * 60)
    print("Testing Memory Retrieval (Recent Conversations)")
    print("=" * 60)
    
    # Load the default workflow
    try:
        workflow = load_default_workflow()
        print(f"✅ Loaded workflow: {workflow.get('name', 'Unknown')}")
    except FileNotFoundError:
        print(f"❌ Could not find default.json in {WORKFLOWS_DIR}")
        return False
    except Exception as e:
        print(f"❌ Error loading default.json: {e}")
        return False
    
    user_id = "test_memory_retrieval_user"
    
    # Query 1: Tell the agent your favorite color
    print()
    print("=" * 60)
    print("QUERY 1: Storing Information")
    print("=" * 60)
    query1 = "My favorite color is green."
    print(f"📤 Sending: {query1}")
    
    payload1 = {
        "workflow": workflow,
        "options": {
            "client_id": user_id,
            "user_query": query1,
            "user_id": user_id,
        },
    }
    
    try:
        response1 = requests.post(f"{API_BASE_URL}/api/v1/workflow/execute", json=payload1, timeout=120)
        response1.raise_for_status()
        result1 = response1.json()
        
        if result1.get("status") == "error":
            print(f"❌ Query 1 failed: {result1.get('error', 'Unknown error')}")
            return False
        
        results1 = result1.get("results", {})
        # Find inference response
        response1_text = ""
        for node_id, node_result in results1.items():
            for node in workflow.get("nodes", []):
                if str(node["id"]) == node_id and node.get("type") == "inference":
                    response1_text = node_result.get("outputs", {}).get("response", "")
                    break
        
        print(f"✅ Query 1 completed")
        print(f"📝 Response: {response1_text[:150]}...")
        
        # Verify memory was saved by checking memory creator executed
        memory_creator_executed = False
        for node_id, node_result in results1.items():
            for node in workflow.get("nodes", []):
                if str(node["id"]) == node_id and node.get("type") == "memory_creator":
                    memory_creator_executed = True
                    break
        
        if not memory_creator_executed:
            print("⚠️  Memory Creator did not execute - memory may not have been saved")
            return False
        
        print("✅ Memory Creator executed - interaction should be saved")
        
    except Exception as e:
        print(f"❌ Query 1 error: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Query 2: Ask about favorite color
    print()
    print("=" * 60)
    print("QUERY 2: Retrieving Information")
    print("=" * 60)
    query2 = "What's my favorite color?"
    print(f"📤 Sending: {query2}")
    
    payload2 = {
        "workflow": workflow,
        "options": {
            "client_id": user_id,
            "user_query": query2,
            "user_id": user_id,
        },
    }
    
    try:
        response2 = requests.post(f"{API_BASE_URL}/api/v1/workflow/execute", json=payload2, timeout=120)
        response2.raise_for_status()
        result2 = response2.json()
        
        if result2.get("status") == "error":
            print(f"❌ Query 2 failed: {result2.get('error', 'Unknown error')}")
            return False
        
        results2 = result2.get("results", {})
        
        # Debug: Check memory selector output
        print()
        print("🔍 Debug: Memory Selector Output")
        print("-" * 60)
        for node_id, node_result in results2.items():
            for node in workflow.get("nodes", []):
                if str(node["id"]) == node_id and node.get("type") == "memory_selector":
                    context = node_result.get("outputs", {}).get("context", {})
                    messages = context.get("messages", [])
                    memories = context.get("memories", "")
                    
                    print(f"  Memory Selector (node {node_id}):")
                    print(f"    Messages in context: {len(messages)}")
                    for i, msg in enumerate(messages[:5]):  # Show first 5 messages
                        role = msg.get("role", "unknown")
                        content = str(msg.get("content", ""))[:100]
                        print(f"      [{i+1}] {role}: {content}...")
                    
                    print(f"    Memories length: {len(str(memories))}")
                    if memories:
                        print(f"    Memories: {str(memories)[:200]}...")
                    break
        
        # Find inference response
        response2_text = ""
        for node_id, node_result in results2.items():
            for node in workflow.get("nodes", []):
                if str(node["id"]) == node_id and node.get("type") == "inference":
                    response2_text = node_result.get("outputs", {}).get("response", "")
                    break
        
        print()
        print(f"📝 Response: {response2_text}")
        print()
        
        # Check if response contains "green"
        response2_lower = response2_text.lower()
        if "green" in response2_lower:
            print("✅ SUCCESS: Response contains 'green' - memory retrieval working!")
            return True
        else:
            print("❌ FAILURE: Response does not contain 'green'")
            print(f"   Expected: Response should mention 'green' based on previous conversation")
            print(f"   Actual: {response2_text[:200]}...")
            
            # Additional debug: Check if messages were in context
            messages_in_context = False
            for node_id, node_result in results2.items():
                for node in workflow.get("nodes", []):
                    if str(node["id"]) == node_id and node.get("type") == "memory_selector":
                        context = node_result.get("outputs", {}).get("context", {})
                        messages = context.get("messages", [])
                        messages_text = " ".join([str(msg.get("content", "")) for msg in messages]).lower()
                        if "green" in messages_text or "favorite color" in messages_text:
                            messages_in_context = True
                            print(f"   ⚠️  Note: 'green' or 'favorite color' WAS in context messages")
                        else:
                            print(f"   ⚠️  Note: 'green' or 'favorite color' was NOT in context messages")
                        break
            
            return False
        
    except Exception as e:
        print(f"❌ Query 2 error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_memory_retrieval()
    sys.exit(0 if success else 1)

"""
Test memory retrieval - specifically tests that recent conversations are retrieved
and used in subsequent queries.

Test scenario:
1. First query: "My favorite color is green"
2. Second query: "What's my favorite color?"
3. Expected: Response should mention "green" based on recent conversation buffer
"""
import pytest
import requests
import json
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
    except:
        return False


@pytest.mark.integration
@pytest.mark.skipif(
    not is_server_available() and API_BASE_URL == "http://localhost:7779",
    reason="Integration test requires running API server. Set OBELISK_API_URL or start the server."
)
def test_memory_retrieval():
    """Test that recent conversations are retrieved and used"""
    # Load the default workflow
    workflow = load_default_workflow()
    assert workflow is not None, "Failed to load default workflow"
    
    user_id = "test_memory_retrieval_user"
    
    # Query 1: Tell the agent your favorite color
    query1 = "My favorite color is green."
    payload1 = {
        "workflow": workflow,
        "options": {
            "client_id": user_id,
            "user_query": query1,
            "user_id": user_id,
        },
    }
    
    response1 = requests.post(f"{API_BASE_URL}/api/v1/workflow/execute", json=payload1, timeout=120)
    assert response1.status_code == 200, f"Query 1 failed with status {response1.status_code}"
    
    result1 = response1.json()
    assert result1.get("status") != "error", f"Query 1 failed: {result1.get('error', 'Unknown error')}"
    
    results1 = result1.get("results", {})
    # Find inference response
    response1_text = ""
    for node_id, node_result in results1.items():
        for node in workflow.get("nodes", []):
            if str(node["id"]) == node_id and node.get("type") == "inference":
                response1_text = node_result.get("outputs", {}).get("response", "")
                break
    
    assert response1_text, "Query 1 did not produce a response"
    
    # Verify memory was saved by checking memory creator executed
    memory_creator_executed = False
    for node_id, node_result in results1.items():
        for node in workflow.get("nodes", []):
            if str(node["id"]) == node_id and node.get("type") == "memory_creator":
                memory_creator_executed = True
                break
    
    assert memory_creator_executed, "Memory Creator did not execute - memory may not have been saved"
    
    # Query 2: Ask about favorite color
    query2 = "What's my favorite color?"
    payload2 = {
        "workflow": workflow,
        "options": {
            "client_id": user_id,
            "user_query": query2,
            "user_id": user_id,
        },
    }
    
    response2 = requests.post(f"{API_BASE_URL}/api/v1/workflow/execute", json=payload2, timeout=120)
    assert response2.status_code == 200, f"Query 2 failed with status {response2.status_code}"
    
    result2 = response2.json()
    assert result2.get("status") != "error", f"Query 2 failed: {result2.get('error', 'Unknown error')}"
    
    results2 = result2.get("results", {})
    
    # Find inference response
    response2_text = ""
    for node_id, node_result in results2.items():
        for node in workflow.get("nodes", []):
            if str(node["id"]) == node_id and node.get("type") == "inference":
                response2_text = node_result.get("outputs", {}).get("response", "")
                break
    
    assert response2_text, "Query 2 did not produce a response"
    
    # Check if response contains "green"
    response2_lower = response2_text.lower()
    assert "green" in response2_lower, (
        f"Response does not contain 'green'. "
        f"Expected: Response should mention 'green' based on previous conversation. "
        f"Actual: {response2_text[:200]}..."
    )

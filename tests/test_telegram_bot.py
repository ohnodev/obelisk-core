"""
Test Telegram Bot Node
Tests sending messages via Telegram Bot API
"""
import os
import pytest
import requests
from unittest.mock import patch, MagicMock

# Check if Telegram env vars are set
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_DEV_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

@pytest.mark.skipif(
    not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID,
    reason="TELEGRAM_DEV_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables required"
)
@pytest.mark.integration
def test_telegram_bot_node_sends_message():
    """Test that TelegramBotNode can send a message to Telegram"""
    from src.core.execution.engine import ExecutionEngine
    from src.core.container import ServiceContainer
    
    # Create a simple workflow with telegram bot node
    workflow = {
        "id": "test-telegram-workflow",
        "name": "Test Telegram Bot",
        "nodes": [
            {
                "id": "1",
                "type": "text",
                "position": {"x": 0, "y": 0},
                "metadata": {
                    "text": "Hello from Obelisk Core test!"
                }
            },
            {
                "id": "2",
                "type": "telegram_bot",
                "position": {"x": 0, "y": 0},
                "metadata": {
                    "bot_id": "{{process.env.TELEGRAM_DEV_BOT_TOKEN}}",
                    "group_id": "{{process.env.TELEGRAM_CHAT_ID}}"
                }
            }
        ],
        "connections": [
            {
                "from": "1",
                "from_output": "text",
                "to": "2",
                "to_input": "message"
            }
        ]
    }
    
    # Create execution engine
    container = ServiceContainer()
    engine = ExecutionEngine(container)
    
    # Execute workflow
    result = engine.execute(workflow, context_variables={})
    
    # Verify execution succeeded
    assert result["success"], f"Workflow execution failed: {result.get('error')}"
    
    # Find telegram bot node result
    telegram_result = None
    for node_result in result.get("node_results", []):
        if node_result.get("node_id") == "2":
            telegram_result = node_result
            break
    
    assert telegram_result is not None, "Telegram bot node result not found"
    assert telegram_result.get("success"), f"Telegram bot node failed: {telegram_result.get('error')}"
    
    # Check outputs
    outputs = telegram_result.get("outputs", {})
    assert outputs.get("success") is True, "Telegram message send should succeed"
    assert "response" in outputs, "Telegram response should be in outputs"
    
    # Verify response structure
    response = outputs.get("response", {})
    assert response.get("ok") is True, f"Telegram API should return ok=True, got: {response}"


@pytest.mark.skipif(
    not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID,
    reason="TELEGRAM_DEV_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables required"
)
@pytest.mark.integration
def test_telegram_bot_node_with_default_workflow():
    """Test that default workflow can send message to Telegram"""
    from src.core.execution.engine import ExecutionEngine
    from src.core.container import ServiceContainer
    import json
    from pathlib import Path
    
    # Load default workflow
    workflow_path = Path(__file__).parent.parent / "ui" / "workflows" / "default.json"
    if not workflow_path.exists():
        pytest.skip(f"Default workflow not found at {workflow_path}")
    
    with open(workflow_path, 'r') as f:
        workflow = json.load(f)
    
    # Create execution engine
    container = ServiceContainer()
    engine = ExecutionEngine(container)
    
    # Execute workflow with a test query
    result = engine.execute(
        workflow,
        context_variables={
            "user_query": "Test message for Telegram integration test"
        }
    )
    
    # Verify execution succeeded
    assert result["success"], f"Workflow execution failed: {result.get('error')}"
    
    # Find telegram bot node result (node 10)
    telegram_result = None
    for node_result in result.get("node_results", []):
        if node_result.get("node_id") == "10":
            telegram_result = node_result
            break
    
    assert telegram_result is not None, "Telegram bot node (id=10) result not found in default workflow"
    assert telegram_result.get("success"), f"Telegram bot node failed: {telegram_result.get('error')}"
    
    # Check outputs
    outputs = telegram_result.get("outputs", {})
    assert outputs.get("success") is True, "Telegram message send should succeed"
    
    print(f"\n✅ Telegram message sent successfully!")
    print(f"   Response: {outputs.get('response', {}).get('result', {}).get('message_id', 'N/A')}")

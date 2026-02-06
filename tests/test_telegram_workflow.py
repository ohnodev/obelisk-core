"""
Test Telegram Bot Workflow

This test validates the Telegram integration works end-to-end.
Requires TELEGRAM_DEV_AGENT_BOT_TOKEN in .env

Usage:
    python -m pytest tests/test_telegram_workflow.py -v -s
    
Or run directly:
    python tests/test_telegram_workflow.py
"""

import os
import sys
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load environment variables
load_dotenv(Path(__file__).parent.parent / '.env')

BOT_TOKEN = os.getenv('TELEGRAM_DEV_AGENT_BOT_TOKEN')
TEST_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')  # Chat to send test messages to


def get_bot_info():
    """Get bot information to verify token is valid"""
    if not BOT_TOKEN:
        return None
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getMe"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error getting bot info: {e}")
        return None


def get_updates(offset=None, timeout=5):
    """Poll for new messages"""
    if not BOT_TOKEN:
        return None
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    params = {
        "timeout": timeout,
        "allowed_updates": ["message"]
    }
    if offset:
        params["offset"] = offset
    
    try:
        response = requests.get(url, params=params, timeout=timeout + 5)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error getting updates: {e}")
        return None


def send_message(chat_id, text):
    """Send a message to a chat"""
    if not BOT_TOKEN:
        return None
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error sending message: {e}")
        return None


def test_bot_token_valid():
    """Test 1: Verify bot token is valid"""
    print("\n=== Test 1: Bot Token Validation ===")
    
    if not BOT_TOKEN:
        print("❌ TELEGRAM_DEV_AGENT_BOT_TOKEN not set in .env")
        return False
    
    result = get_bot_info()
    if result and result.get('ok'):
        bot = result['result']
        print(f"✅ Bot token valid!")
        print(f"   Bot username: @{bot.get('username')}")
        print(f"   Bot name: {bot.get('first_name')}")
        print(f"   Bot ID: {bot.get('id')}")
        return True
    else:
        print(f"❌ Invalid bot token")
        return False


def test_can_poll_updates():
    """Test 2: Verify we can poll for updates"""
    print("\n=== Test 2: Poll Updates ===")
    
    if not BOT_TOKEN:
        print("❌ Bot token not set")
        return False
    
    result = get_updates(timeout=2)
    if result and result.get('ok'):
        updates = result.get('result', [])
        print(f"✅ Successfully polled for updates")
        print(f"   Found {len(updates)} pending updates")
        
        if updates:
            # Show all updates for debugging
            for i, update in enumerate(updates):
                print(f"\n   Update #{i+1} (update_id: {update.get('update_id')}):")
                if 'message' in update:
                    msg = update['message']
                    chat = msg.get('chat', {})
                    from_user = msg.get('from', {})
                    print(f"      Chat type: {chat.get('type')} (id: {chat.get('id')})")
                    print(f"      From: @{from_user.get('username', '[no username]')} (id: {from_user.get('id')})")
                    print(f"      Text: '{msg.get('text', '[no text]')[:50]}'")
                else:
                    print(f"      Update type: {list(update.keys())}")
        else:
            print("\n   ℹ️  No pending messages.")
            print("   To test: Send a DM to your bot or mention it in a group.")
            print("   Note: For groups, make sure Privacy Mode is DISABLED via @BotFather")
        return True
    else:
        print(f"❌ Failed to poll updates: {result}")
        return False


def test_can_send_message():
    """Test 3: Verify we can send a message"""
    print("\n=== Test 3: Send Message ===")
    
    if not BOT_TOKEN:
        print("❌ Bot token not set")
        return False
    
    if not TEST_CHAT_ID:
        print("⚠️  TELEGRAM_CHAT_ID not set - skipping send test")
        return True
    
    test_message = f"🤖 Test message from Obelisk Agent workflow test\nTimestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}"
    
    result = send_message(TEST_CHAT_ID, test_message)
    if result and result.get('ok'):
        print(f"✅ Successfully sent test message to chat {TEST_CHAT_ID}")
        return True
    else:
        print(f"❌ Failed to send message: {result}")
        return False


def test_workflow_node_import():
    """Test 4: Verify workflow nodes can be imported"""
    print("\n=== Test 4: Node Import ===")
    
    try:
        from src.core.execution.nodes import (
            TelegramListenerNode,
            TelegramBotNode,
            TelegramMemoryCreatorNode,
            TelegramMemorySelectorNode,
            BinaryIntentNode,
        )
        print("✅ All Telegram workflow nodes imported successfully")
        print(f"   - TelegramListenerNode")
        print(f"   - TelegramBotNode")
        print(f"   - TelegramMemoryCreatorNode")
        print(f"   - TelegramMemorySelectorNode")
        print(f"   - BinaryIntentNode")
        return True
    except ImportError as e:
        print(f"❌ Failed to import nodes: {e}")
        return False


def test_listener_node_execution():
    """Test 5: Test TelegramListenerNode can poll"""
    print("\n=== Test 5: TelegramListenerNode Execution ===")
    
    if not BOT_TOKEN:
        print("❌ Bot token not set")
        return False
    
    try:
        from src.core.execution.nodes import TelegramListenerNode
        from src.core.execution.node_base import ExecutionContext
        
        # Create node
        node_data = {
            'id': 'test_listener',
            'type': 'telegram_listener',
            'metadata': {
                'bot_token': BOT_TOKEN,
                'poll_interval': 2
            }
        }
        
        node = TelegramListenerNode('test_listener', node_data)
        
        # Create context
        context = ExecutionContext(
            variables={},
            node_outputs={}
        )
        
        # Execute (poll once)
        print("   Polling for messages (5 second timeout)...")
        result = node.execute(context)
        
        print(f"✅ TelegramListenerNode executed successfully")
        print(f"   Trigger: {result.get('trigger', False)}")
        if result.get('message'):
            print(f"   Message: {result.get('message')[:50]}...")
            print(f"   User ID: {result.get('user_id')}")
            print(f"   Chat ID: {result.get('chat_id')}")
        else:
            print(f"   No new messages")
        return True
        
    except Exception as e:
        print(f"❌ TelegramListenerNode execution failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_send_node_execution():
    """Test 6: Test TelegramBotNode can send"""
    print("\n=== Test 6: TelegramBotNode Execution ===")
    
    if not BOT_TOKEN or not TEST_CHAT_ID:
        print("⚠️  Bot token or chat ID not set - skipping")
        return True
    
    try:
        from src.core.execution.nodes import TelegramBotNode
        from src.core.execution.node_base import ExecutionContext
        
        # Create node
        node_data = {
            'id': 'test_sender',
            'type': 'telegram_bot',
            'metadata': {
                'bot_id': BOT_TOKEN,
                'chat_id': TEST_CHAT_ID
            }
        }
        
        node = TelegramBotNode('test_sender', node_data)
        
        # Create context with message input
        context = ExecutionContext(
            variables={},
            node_outputs={}
        )
        
        # Set input directly
        node.inputs['message'] = f"🧪 Node execution test - {time.strftime('%H:%M:%S')}"
        
        # Execute
        result = node.execute(context)
        
        if result.get('success'):
            print(f"✅ TelegramBotNode executed successfully")
            return True
        else:
            print(f"❌ TelegramBotNode failed: {result}")
            return False
        
    except Exception as e:
        print(f"❌ TelegramBotNode execution failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def run_interactive_test():
    """Interactive test - polls and responds to mentions"""
    print("\n=== Interactive Test Mode ===")
    print("Bot will poll for messages and respond to mentions.")
    print("Send a message mentioning the bot to test.")
    print("Press Ctrl+C to stop.\n")
    
    if not BOT_TOKEN:
        print("❌ Bot token not set")
        return
    
    bot_info = get_bot_info()
    if not bot_info or not bot_info.get('ok'):
        print("❌ Could not get bot info")
        return
    
    bot_username = bot_info['result'].get('username', '')
    print(f"Listening as @{bot_username}...")
    
    # Get current update_id to skip old messages
    result = get_updates(timeout=1)
    offset = None
    if result and result.get('ok') and result.get('result'):
        offset = result['result'][-1]['update_id'] + 1
        print(f"Starting from update_id: {offset}")
    
    try:
        while True:
            result = get_updates(offset=offset, timeout=30)
            
            if not result or not result.get('ok'):
                continue
            
            updates = result.get('result', [])
            
            for update in updates:
                offset = update['update_id'] + 1
                
                if 'message' not in update:
                    continue
                
                msg = update['message']
                text = msg.get('text', '')
                chat_id = msg.get('chat', {}).get('id')
                username = msg.get('from', {}).get('username', 'unknown')
                
                print(f"\n📩 Message from @{username} in chat {chat_id}:")
                print(f"   {text[:100]}")
                
                # Check if bot is mentioned
                is_mentioned = (
                    f"@{bot_username}".lower() in text.lower() or
                    "obelisk" in text.lower() or
                    "agent" in text.lower()
                )
                
                if is_mentioned:
                    print(f"   ✅ Bot mentioned! Sending response...")
                    response = f"👋 Hello @{username}! I received your message. This is a test response from Obelisk Agent #001."
                    send_result = send_message(chat_id, response)
                    if send_result and send_result.get('ok'):
                        print(f"   ✅ Response sent!")
                    else:
                        print(f"   ❌ Failed to send response")
                else:
                    print(f"   ℹ️  Bot not mentioned, ignoring")
                    
    except KeyboardInterrupt:
        print("\n\nStopped by user.")


def main():
    """Run all tests"""
    print("=" * 60)
    print("  Telegram Bot Workflow Test Suite")
    print("=" * 60)
    
    results = []
    
    # Run tests
    results.append(("Bot Token Valid", test_bot_token_valid()))
    results.append(("Poll Updates", test_can_poll_updates()))
    results.append(("Send Message", test_can_send_message()))
    results.append(("Node Import", test_workflow_node_import()))
    results.append(("Listener Node", test_listener_node_execution()))
    results.append(("Send Node", test_send_node_execution()))
    
    # Summary
    print("\n" + "=" * 60)
    print("  Test Results Summary")
    print("=" * 60)
    
    passed = 0
    failed = 0
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}  {name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print("=" * 60)
    print(f"  Total: {passed} passed, {failed} failed")
    print("=" * 60)
    
    # Ask about interactive mode
    if passed > 0 and BOT_TOKEN:
        print("\nWould you like to run interactive test mode? (y/n)")
        try:
            choice = input().strip().lower()
            if choice == 'y':
                run_interactive_test()
        except:
            pass
    
    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

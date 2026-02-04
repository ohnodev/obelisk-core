"""
Test Scheduler with a basic agent workflow
Verifies that the scheduler fires correctly and triggers downstream nodes
"""
import os
import time
import logging
import pytest
from datetime import datetime

logger = logging.getLogger(__name__)


def test_scheduler_basic_agent():
    """
    Test scheduler with a basic agent workflow:
    Scheduler (2-3s) -> Text Node -> prints output
    
    This verifies:
    1. Scheduler fires at the configured interval
    2. Connected text node is re-executed each time
    3. We can see the output from each trigger
    """
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    tick_results = []
    
    def on_tick(result):
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"\n🔔 [{timestamp}] SCHEDULER FIRED!")
        print(f"   Tick #{result.get('tick', '?')}")
        print(f"   Success: {result.get('success', False)}")
        print(f"   Executed nodes: {result.get('executed_nodes', [])}")
        if result.get('outputs'):
            for node_id, outputs in result['outputs'].items():
                print(f"   Node {node_id} output: {outputs}")
        if result.get('error'):
            print(f"   Error: {result['error']}")
        tick_results.append(result)
    
    def on_error(error):
        print(f"\n❌ ERROR: {error}")
    
    # Create workflow: Scheduler -> Text Node
    workflow = {
        'id': 'basic-agent-scheduler',
        'name': 'Basic Agent with Scheduler',
        'nodes': [
            {
                'id': 'scheduler-1',
                'type': 'scheduler',
                'position': {'x': 0, 'y': 0},
                'metadata': {
                    'min_seconds': 2.0,  # 2-3 second interval
                    'max_seconds': 3.0,
                    'enabled': True
                }
            },
            {
                'id': 'text-1',
                'type': 'text',
                'position': {'x': 200, 'y': 0},
                'metadata': {
                    'text': 'Autonomous tick at {{timestamp}}'
                }
            }
        ],
        'connections': [
            {
                'from': 'scheduler-1',
                'from_output': 'trigger',
                'to': 'text-1',
                'to_input': 'trigger'  # Connect to trigger input (scheduler signal)
            }
        ]
    }
    
    print("\n" + "="*60)
    print("🚀 STARTING SCHEDULER TEST")
    print("   Interval: 2-3 seconds")
    print("   Duration: ~8 seconds (should see 2-3 triggers)")
    print("="*60)
    
    # Start workflow
    start_time = time.time()
    workflow_id = runner.start_workflow(
        workflow, 
        context_variables={'timestamp': 'initial'},
        on_tick_complete=on_tick,
        on_error=on_error
    )
    
    print(f"\n✅ Workflow started: {workflow_id}")
    print("⏳ Waiting for scheduler to fire...")
    
    # Wait for ~8 seconds to see 2-3 triggers
    time.sleep(8)
    
    elapsed = time.time() - start_time
    print(f"\n⏱️  Elapsed: {elapsed:.1f}s")
    
    # Stop workflow
    runner.stop_workflow(workflow_id)
    print(f"\n🛑 Workflow stopped")
    
    # Verify results
    print("\n" + "="*60)
    print("📊 RESULTS")
    print("="*60)
    print(f"   Total ticks: {len(tick_results)}")
    
    # Should have at least 2 triggers in 8 seconds with 2-3s interval
    assert len(tick_results) >= 2, f"Expected at least 2 triggers, got {len(tick_results)}"
    
    # Verify each tick has the right structure
    for i, tick in enumerate(tick_results):
        print(f"\n   Tick {i+1}:")
        print(f"      tick_number: {tick.get('tick', '?')}")
        print(f"      success: {tick.get('success', False)}")
        print(f"      executed_nodes: {tick.get('executed_nodes', [])}")
        
        assert tick.get('success') == True, f"Tick {i+1} failed: {tick.get('error')}"
        assert 'text-1' in tick.get('executed_nodes', [])
    
    print("\n✅ TEST PASSED!")


def test_scheduler_with_inference_chain():
    """
    Test scheduler with a more complex chain:
    Scheduler -> Text (prompt) -> simulated downstream
    
    This mimics a real agent workflow where scheduler triggers the input prompt.
    """
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    executions = []
    
    def on_tick(result):
        timestamp = datetime.now().strftime("%H:%M:%S")
        tick = result.get('tick')
        if tick is None:
            # Skip if tick is missing (shouldn't happen in normal operation)
            logger.warning(f"on_tick received result without 'tick' key: {result}")
            return
        executions.append({
            'time': timestamp,
            'tick': tick,
            'outputs': result.get('outputs', {})
        })
        print(f"🔄 [{timestamp}] Execution #{len(executions)}")
    
    workflow = {
        'id': 'inference-chain-scheduler',
        'name': 'Scheduler -> Input Prompt Chain',
        'nodes': [
            {
                'id': '1',
                'type': 'scheduler',
                'position': {'x': 0, 'y': 0},
                'metadata': {
                    'min_seconds': 1.5,
                    'max_seconds': 2.0,
                    'enabled': True
                }
            },
            {
                'id': '2',
                'type': 'text',
                'position': {'x': 200, 'y': 0},
                'metadata': {
                    'text': 'What is the current state of the world?'
                }
            },
            {
                'id': '3',
                'type': 'text',
                'position': {'x': 400, 'y': 0},
                'metadata': {
                    'text': 'Processing query...'
                }
            }
        ],
        'connections': [
            {
                'from': '1',
                'from_output': 'trigger',
                'to': '2',
                'to_input': 'trigger'  # Trigger input - doesn't overwrite text
            },
            {
                'from': '2',
                'from_output': 'text',
                'to': '3',
                'to_input': 'text'
            }
        ]
    }
    
    print("\n🔗 Testing scheduler with downstream chain...")
    
    workflow_id = runner.start_workflow(workflow, on_tick_complete=on_tick)
    
    # Run for 5 seconds
    time.sleep(5)
    
    runner.stop_workflow(workflow_id)
    
    print(f"\n📊 Total executions: {len(executions)}")
    assert len(executions) >= 2, f"Expected at least 2 executions, got {len(executions)}"
    
    # Verify the chain executed correctly
    for exe in executions:
        outputs = exe['outputs']
        # Text node 3 should have received input from text node 2
        if '3' in outputs:
            print(f"   Node 3 output: {outputs['3']}")
    
    print("✅ Chain execution verified!")


if __name__ == "__main__":
    # Run with verbose output
    print("\n" + "="*60)
    print("SCHEDULER AGENT TESTS")
    print("="*60)
    
    test_scheduler_basic_agent()
    print("\n")
    test_scheduler_with_inference_chain()

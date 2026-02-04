"""
Tests for Scheduler Node and Autonomous Workflow Execution
"""
import os
import time
import pytest
import threading
from unittest.mock import MagicMock, patch

# Test the scheduler node directly
def test_scheduler_node_basic():
    """Test that SchedulerNode initializes correctly"""
    from src.core.execution.nodes.scheduler import SchedulerNode
    from src.core.execution.node_base import ExecutionMode
    
    node_data = {
        'id': 'test-scheduler',
        'type': 'scheduler',
        'position': {'x': 0, 'y': 0},
        'metadata': {
            'min_seconds': 2,
            'max_seconds': 5,
            'enabled': True
        }
    }
    
    node = SchedulerNode('test-scheduler', node_data)
    
    assert node.execution_mode == ExecutionMode.CONTINUOUS
    assert node._min_seconds == 2.0
    assert node._max_seconds == 5.0
    assert node._enabled == True
    assert node.is_autonomous() == True


def test_scheduler_node_execute():
    """Test that SchedulerNode.execute() initializes state"""
    from src.core.execution.nodes.scheduler import SchedulerNode
    from src.core.execution.node_base import ExecutionContext
    
    node_data = {
        'id': 'test-scheduler',
        'type': 'scheduler',
        'position': {'x': 0, 'y': 0},
        'metadata': {
            'min_seconds': 1,
            'max_seconds': 2,
            'enabled': True
        }
    }
    
    node = SchedulerNode('test-scheduler', node_data)
    context = ExecutionContext()
    
    result = node.execute(context)
    
    assert 'trigger' in result
    assert result['trigger'] == False  # Should not fire on initial execute
    assert 'tick_count' in result
    assert result['tick_count'] == 0


def test_scheduler_node_on_tick():
    """Test that SchedulerNode.on_tick() fires after interval"""
    from src.core.execution.nodes.scheduler import SchedulerNode
    from src.core.execution.node_base import ExecutionContext
    
    node_data = {
        'id': 'test-scheduler',
        'type': 'scheduler',
        'position': {'x': 0, 'y': 0},
        'metadata': {
            'min_seconds': 0.1,  # Very short interval for testing
            'max_seconds': 0.1,
            'enabled': True
        }
    }
    
    node = SchedulerNode('test-scheduler', node_data)
    context = ExecutionContext()
    
    # Initial execute
    node.execute(context)
    
    # Immediately after execute, on_tick should not fire
    result = node.on_tick(context)
    assert result is None  # Should not fire yet
    
    # Wait for interval to elapse
    time.sleep(0.15)
    
    # Now on_tick should fire
    result = node.on_tick(context)
    assert result is not None
    assert result['trigger'] == True
    assert result['tick_count'] == 1


def test_scheduler_node_disabled():
    """Test that disabled scheduler doesn't fire"""
    from src.core.execution.nodes.scheduler import SchedulerNode
    from src.core.execution.node_base import ExecutionContext
    
    node_data = {
        'id': 'test-scheduler',
        'type': 'scheduler',
        'position': {'x': 0, 'y': 0},
        'metadata': {
            'min_seconds': 0.1,
            'max_seconds': 0.1,
            'enabled': False  # Disabled
        }
    }
    
    node = SchedulerNode('test-scheduler', node_data)
    context = ExecutionContext()
    
    node.execute(context)
    time.sleep(0.15)
    
    # Disabled scheduler should not fire
    result = node.on_tick(context)
    assert result is None


def test_workflow_runner_basic():
    """Test WorkflowRunner initialization"""
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    
    assert runner is not None
    assert runner.list_running() == []


def test_workflow_runner_start_stop():
    """Test starting and stopping a workflow"""
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    
    # Create a workflow with a scheduler
    workflow = {
        'id': 'test-workflow',
        'name': 'Test Scheduler Workflow',
        'nodes': [
            {
                'id': '1',
                'type': 'scheduler',
                'position': {'x': 0, 'y': 0},
                'metadata': {
                    'min_seconds': 0.5,
                    'max_seconds': 1.0,
                    'enabled': True
                }
            },
            {
                'id': '2',
                'type': 'text',
                'position': {'x': 200, 'y': 0},
                'metadata': {
                    'text': 'Hello from scheduler!'
                }
            }
        ],
        'connections': [
            {
                'from': '1',
                'from_output': 'trigger',
                'to': '2',
                'to_input': 'trigger'
            }
        ]
    }
    
    # Start workflow
    workflow_id = runner.start_workflow(workflow)
    assert workflow_id == 'test-workflow'
    
    # Check status
    status = runner.get_status(workflow_id)
    assert status is not None
    assert status['state'] == 'running'
    
    # Let it run for a bit
    time.sleep(0.2)
    
    # Stop workflow
    stopped = runner.stop_workflow(workflow_id)
    assert stopped == True
    
    # Verify it's stopped
    status = runner.get_status(workflow_id)
    assert status is None  # Removed from running workflows


def test_workflow_runner_no_autonomous_nodes():
    """Test that workflow without autonomous nodes executes once"""
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    
    results = []
    
    def on_complete(result):
        results.append(result)
    
    # Create a workflow without scheduler
    workflow = {
        'id': 'simple-workflow',
        'name': 'Simple Workflow',
        'nodes': [
            {
                'id': '1',
                'type': 'text',
                'position': {'x': 0, 'y': 0},
                'metadata': {
                    'text': 'Hello World'
                }
            }
        ],
        'connections': []
    }
    
    # Start workflow - should execute once and complete
    workflow_id = runner.start_workflow(workflow, on_tick_complete=on_complete)
    
    # Should not be in running list (executed once)
    running = runner.list_running()
    assert workflow_id not in running


def test_execution_mode_enum():
    """Test ExecutionMode enum values"""
    from src.core.execution.node_base import ExecutionMode
    
    assert ExecutionMode.ONCE.value == "once"
    assert ExecutionMode.CONTINUOUS.value == "continuous"
    assert ExecutionMode.TRIGGERED.value == "triggered"


def test_base_node_default_mode():
    """Test that BaseNode has default ONCE mode"""
    from src.core.execution.nodes.text import TextNode
    from src.core.execution.node_base import ExecutionMode
    
    node_data = {
        'id': 'test-text',
        'type': 'text',
        'position': {'x': 0, 'y': 0},
        'metadata': {'text': 'test'}
    }
    
    node = TextNode('test-text', node_data)
    
    assert node.execution_mode == ExecutionMode.ONCE
    assert node.is_autonomous() == False
    assert node.is_triggered() == False


@pytest.mark.integration
def test_scheduler_triggers_text_node():
    """Integration test: Scheduler triggers connected text node"""
    from src.core.execution.runner import WorkflowRunner
    
    runner = WorkflowRunner()
    tick_results = []
    
    def on_tick(result):
        tick_results.append(result)
    
    workflow = {
        'id': 'scheduler-test-workflow',
        'name': 'Scheduler Test',
        'nodes': [
            {
                'id': '1',
                'type': 'scheduler',
                'position': {'x': 0, 'y': 0},
                'metadata': {
                    'min_seconds': 0.1,
                    'max_seconds': 0.15,
                    'enabled': True
                }
            },
            {
                'id': '2',
                'type': 'text',
                'position': {'x': 200, 'y': 0},
                'metadata': {
                    'text': 'Triggered!'
                }
            }
        ],
        'connections': [
            {
                'from': '1',
                'from_output': 'trigger',
                'to': '2',
                'to_input': 'text'  # Connect to text input
            }
        ]
    }
    
    workflow_id = runner.start_workflow(workflow, on_tick_complete=on_tick)
    
    # Wait for at least one trigger
    time.sleep(0.5)
    
    # Stop workflow
    runner.stop_workflow(workflow_id)
    
    # Verify at least one tick happened
    print(f"\n📊 Tick results: {len(tick_results)} ticks recorded")
    assert len(tick_results) >= 1, "Scheduler should have triggered at least once"
    
    # Check tick structure
    if tick_results:
        tick = tick_results[0]
        assert 'tick' in tick
        assert 'triggered_nodes' in tick
        assert 'executed_nodes' in tick
        print(f"✅ First tick: tick={tick['tick']}, triggered={tick['triggered_nodes']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

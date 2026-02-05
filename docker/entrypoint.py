#!/usr/bin/env python3
"""
Obelisk Agent Entrypoint
Loads a workflow from environment or file and runs it continuously
"""
import os
import sys
import json
import signal
import time
from typing import Optional, Dict, Any

# Add src to path
sys.path.insert(0, '/app')

from src.core.execution.runner import WorkflowRunner
from src.utils.logger import get_logger

logger = get_logger(__name__)


def load_workflow() -> Dict[str, Any]:
    """
    Load workflow from environment variable or file
    
    Priority:
    1. WORKFLOW_JSON env var (JSON string)
    2. WORKFLOW_FILE env var (path to JSON file)
    3. /app/workflows/workflow.json (default location)
    """
    # Try WORKFLOW_JSON env var first
    workflow_json = os.getenv('WORKFLOW_JSON')
    if workflow_json:
        logger.info("Loading workflow from WORKFLOW_JSON environment variable")
        try:
            return json.loads(workflow_json)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse WORKFLOW_JSON: {e}")
            sys.exit(1)
    
    # Try WORKFLOW_FILE env var
    workflow_file = os.getenv('WORKFLOW_FILE', '/app/workflows/workflow.json')
    if os.path.exists(workflow_file):
        logger.info(f"Loading workflow from file: {workflow_file}")
        try:
            with open(workflow_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Failed to load workflow file: {e}")
            sys.exit(1)
    
    logger.error("No workflow found. Set WORKFLOW_JSON env var or mount workflow.json")
    sys.exit(1)


def build_context_variables() -> Dict[str, Any]:
    """
    Build context variables from environment
    
    Environment variables starting with OBELISK_VAR_ become context variables.
    e.g., OBELISK_VAR_USER_ID=123 -> {"user_id": "123"}
    """
    context = {}
    
    # Standard variables
    context['agent_id'] = os.getenv('AGENT_ID', 'unknown')
    context['agent_name'] = os.getenv('AGENT_NAME', 'unnamed')
    
    # User-defined variables from OBELISK_VAR_* env vars
    for key, value in os.environ.items():
        if key.startswith('OBELISK_VAR_'):
            var_name = key[12:].lower()  # Remove prefix and lowercase
            context[var_name] = value
    
    return context


class AgentRunner:
    """Manages the agent lifecycle"""
    
    def __init__(self):
        self.runner: Optional[WorkflowRunner] = None
        self.workflow_id: Optional[str] = None
        self.running = True
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)
    
    def _handle_shutdown(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, shutting down...")
        self.running = False
        
        if self.runner and self.workflow_id:
            try:
                self.runner.stop_workflow(self.workflow_id)
                logger.info("Workflow stopped successfully")
            except Exception as e:
                logger.error(f"Error stopping workflow: {e}")
    
    def _on_tick_complete(self, result: Dict[str, Any]):
        """Callback for each tick completion"""
        tick = result.get('tick', '?')
        success = result.get('success', False)
        executed = result.get('executed_nodes', [])
        
        if success:
            logger.info(f"Tick #{tick} completed - executed {len(executed)} nodes")
        else:
            error = result.get('error', 'Unknown error')
            logger.error(f"Tick #{tick} failed: {error}")
    
    def _on_error(self, error: str):
        """Callback for errors"""
        logger.error(f"Workflow error: {error}")
    
    def run(self):
        """Main run loop"""
        # Load workflow
        workflow = load_workflow()
        workflow_name = workflow.get('name', workflow.get('id', 'unknown'))
        logger.info(f"Starting agent with workflow: {workflow_name}")
        
        # Build context
        context = build_context_variables()
        logger.info(f"Context variables: {list(context.keys())}")
        
        # Create runner
        self.runner = WorkflowRunner()
        
        # Start workflow
        self.workflow_id = self.runner.start_workflow(
            workflow,
            context_variables=context,
            on_tick_complete=self._on_tick_complete,
            on_error=self._on_error
        )
        
        logger.info(f"Workflow started with ID: {self.workflow_id}")
        logger.info("Agent running. Press Ctrl+C or send SIGTERM to stop.")
        
        # Keep running until shutdown signal
        while self.running:
            time.sleep(1)
            
            # Check if workflow is still running
            status = self.runner.get_status(self.workflow_id)
            if status is None or status.get('state') != 'running':
                logger.warning("Workflow is no longer running")
                break
        
        logger.info("Agent shutdown complete")


def main():
    """Main entry point"""
    print("=" * 60)
    print("  OBELISK AGENT")
    print("=" * 60)
    print(f"  Agent ID: {os.getenv('AGENT_ID', 'unknown')}")
    print(f"  Agent Name: {os.getenv('AGENT_NAME', 'unnamed')}")
    print("=" * 60)
    print()
    
    agent = AgentRunner()
    agent.run()


if __name__ == "__main__":
    main()

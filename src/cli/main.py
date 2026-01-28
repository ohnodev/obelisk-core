"""
CLI interface for Obelisk Core
"""
import click
import sys
import os
import uvicorn
from pathlib import Path
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.live import Live
from rich.spinner import Spinner
from rich import box

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from config import Config
from src.storage import LocalJSONStorage, SupabaseStorage
from src.llm.obelisk_llm import ObeliskLLM
from src.quantum.ibm_quantum_service import IBMQuantumService
from src.evolution.processor import process_evolution_cycle
from src.memory.memory_manager import ObeliskMemoryManager
from src.api.server import app

console = Console()


@click.group()
def cli():
    """Obelisk Core - The consciousness engine"""
    pass


@cli.command()
@click.option('--port', default=7779, help='Port to run the API server on')
@click.option('--mode', type=click.Choice(['solo', 'prod']), default=None, help='Mode: solo or prod')
@click.option('--host', default='0.0.0.0', help='Host to bind to')
def serve(port, mode, host):
    """Run the API server"""
    if mode:
        os.environ['OBELISK_CORE_MODE'] = mode
        Config.MODE = mode
    
    if not Config.validate():
        click.echo("❌ Configuration validation failed. Please check your environment variables.")
        sys.exit(1)
    
    click.echo(f"🚀 Starting Obelisk Core API server in {Config.MODE} mode...")
    click.echo(f"   [ALPHA VERSION]")
    click.echo(f"   Host: {host}")
    click.echo(f"   Port: {port}")
    
    uvicorn.run(app, host=host, port=port)


@cli.command()
@click.option('--mode', type=click.Choice(['solo', 'prod']), default='solo', help='Mode: solo or prod (default: solo)')
def chat(mode):
    """Interactive chat with The Obelisk (defaults to solo mode)"""
    # Force solo mode for chat (it's designed for local interaction)
    os.environ['OBELISK_CORE_MODE'] = 'solo'
    Config.MODE = 'solo'
    
    # Solo mode doesn't need validation (no external dependencies)
    # Just ensure storage path exists
    storage_path = Path(Config.STORAGE_PATH)
    storage_path.mkdir(parents=True, exist_ok=True)
    
    # Suppress LLM debug messages
    import logging
    logging.getLogger().setLevel(logging.WARNING)
    
    # Header with ASCII art frame
    header_text = Text()
    header_text.append("◊ ", style="bold cyan")
    header_text.append("THE OBELISK", style="bold white")
    header_text.append(" ◊", style="bold cyan")
    header_text.append("\n", style="dim")
    header_text.append("[ALPHA VERSION]", style="dim yellow")
    
    console.print()
    console.print(Panel(
        header_text,
        box=box.ROUNDED,
        border_style="cyan",
        padding=(1, 2)
    ))
    
    # Loading message
    with console.status("[bold cyan]Awakening The Overseer...", spinner="dots"):
        # Simple approach: no redirection, works the same in both debug and non-debug mode
        storage = Config.get_storage()
        llm = ObeliskLLM(storage=storage)
        memory_manager = ObeliskMemoryManager(
            storage=storage,
            llm=llm,
            mode=Config.MODE
        )
    
    console.print("[bold green]✓[/bold green] [dim]The Overseer is ready[/dim]")
    console.print()
    
    user_id = "cli_user"
    
    # Instructions
    console.print(Panel(
        "[dim]Type 'quit' or 'exit' to end the conversation.[/dim]",
        box=box.ROUNDED,
        border_style="dim",
        padding=(0, 1)
    ))
    console.print()
    
    while True:
        try:
            # User input with styled prompt
            query = console.input("[bold cyan]You:[/bold cyan] ")
            
            if query.lower() in ['quit', 'exit', 'q']:
                console.print()
                console.print(Panel(
                    "[bold cyan]◊[/bold cyan] [dim]The Overseer returns to slumber.[/dim]",
                    box=box.ROUNDED,
                    border_style="cyan",
                    padding=(0, 1)
                ))
                break
            
            if not query.strip():
                continue
            
            # Get conversation context
            context = memory_manager.get_conversation_context(user_id)
            
            # Show thinking indicator with animated spinner
            console.print()
            # Use console.status() with proper formatting - it handles animation automatically
            status_text = "[bold cyan]◊[/bold cyan] [bold]The Overseer is thinking...[/bold]"
            
            # Simple approach: no redirection, works the same in both debug and non-debug mode
            # The spinner will animate properly since we're not redirecting stderr
            with console.status(status_text, spinner="dots"):
                result = llm.generate(
                    query=query,
                    quantum_influence=0.7,
                    conversation_context=context
                )
            
            response = result.get('response', 'The Overseer processes your query.')
            
            # Display response in a styled panel
            console.print()
            console.print(Panel(
                response,
                title="[bold cyan]◊ The Overseer[/bold cyan]",
                box=box.ROUNDED,
                border_style="cyan",
                padding=(1, 2)
            ))
            console.print()
            
            # Add to memory (handles storage internally - Option C)
            # Check if summarization might be triggered (happens at 10+ message pairs)
            memory = memory_manager.get_memory(user_id)
            all_messages = memory.get_all_messages()
            message_pairs = len(all_messages) // 2
            
            # Show appropriate status message based on whether summarization will occur
            # Summarization triggers when we have 10+ pairs, so check if we're at 9 pairs
            # (after adding this interaction, we'll have 10 pairs and trigger summarization)
            if message_pairs >= memory_manager.summarize_threshold - 1:
                # About to trigger summarization - this will take longer
                status_msg = "[bold cyan]◊[/bold cyan] [bold]Summarizing conversation and processing memory...[/bold]"
            else:
                # Normal memory save - quick operation
                status_msg = "[bold cyan]◊[/bold cyan] [bold]Processing memory...[/bold]"
            
            # Suppress warning messages during memory operations by setting a flag
            # This prevents the [MEMORY] Warning from interfering with the spinner
            os.environ['OBELISK_CLI_MODE'] = '1'
            
            try:
                # Use console.status with spinner - writes directly to terminal
                with console.status(status_msg, spinner="dots"):
                    memory_manager.add_interaction(
                        user_id=user_id,
                        query=query,
                        response=response,
                        cycle_id=None,
                        energy=0.0,
                        quantum_seed=0.7,
                        reward_score=0.0
                    )
            finally:
                # Clean up the flag
                os.environ.pop('OBELISK_CLI_MODE', None)
            
        except KeyboardInterrupt:
            console.print()
            console.print(Panel(
                "[bold cyan]◊[/bold cyan] [dim]The Overseer returns to slumber.[/dim]",
                box=box.ROUNDED,
                border_style="cyan",
                padding=(0, 1)
            ))
            break
        except Exception as e:
            console.print(f"[bold red]❌ Error:[/bold red] {e}")


@cli.command()
@click.option('--cycle-id', required=True, help='Evolution cycle ID to process')
@click.option('--fine-tune/--no-fine-tune', default=True, help='Whether to fine-tune the model')
def evolve(cycle_id, fine_tune):
    """Process an evolution cycle"""
    if not Config.validate():
        click.echo("❌ Configuration validation failed. Please check your environment variables.")
        sys.exit(1)
    
    click.echo(f"🔄 Processing evolution cycle: {cycle_id}")
    
    try:
        storage = Config.get_storage()
        llm = ObeliskLLM(storage=storage)
        
        result = process_evolution_cycle(
            cycle_id=cycle_id,
            storage=storage,
            llm=llm,
            fine_tune_model=fine_tune
        )
        
        click.echo("✅ Evolution cycle processed successfully")
        click.echo(f"   Total interactions: {result.get('total_interactions', 0)}")
        click.echo(f"   Total users: {result.get('total_users', 0)}")
        click.echo(f"   Top contributors: {result.get('top_10_processed', 0)}")
        
        if result.get('model_training'):
            training = result['model_training']
            if training.get('success'):
                click.echo(f"   Model training: ✅ Success")
                click.echo(f"   Weight ID: {training.get('weight_id')}")
            else:
                click.echo(f"   Model training: ❌ Failed")
                click.echo(f"   Error: {training.get('error')}")
        
    except Exception as e:
        click.echo(f"❌ Error processing evolution cycle: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
def test():
    """Test the LLM model"""
    if not Config.validate():
        click.echo("❌ Configuration validation failed. Please check your environment variables.")
        sys.exit(1)
    
    click.echo("🧪 Testing Obelisk LLM...")
    
    try:
        storage = Config.get_storage()
        llm = ObeliskLLM(storage=storage)
        
        test_result = llm.test()
        
        click.echo("")
        click.echo("Test Results:")
        click.echo(f"   Model Loaded: {test_result.get('model_loaded', False)}")
        click.echo(f"   Device: {test_result.get('device', 'unknown')}")
        click.echo(f"   Memory Estimate: {test_result.get('memory_estimate_mb', 0)}MB")
        click.echo(f"   Test Query: {test_result.get('test_query', '')}")
        click.echo("")
        click.echo("Response:")
        result = test_result.get('result', {})
        click.echo(f"   {result.get('response', 'No response')}")
        click.echo(f"   Source: {result.get('source', 'unknown')}")
        
    except Exception as e:
        click.echo(f"❌ Error testing LLM: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
def config():
    """Show current configuration"""
    click.echo("Configuration:")
    click.echo(f"   Mode: {Config.MODE}")
    click.echo(f"   Storage Path: {Config.STORAGE_PATH}")
    click.echo(f"   API Host: {Config.API_HOST}")
    click.echo(f"   API Port: {Config.API_PORT}")
    
    if Config.MODE == 'prod':
        click.echo(f"   Supabase URL: {Config.SUPABASE_URL[:50]}..." if Config.SUPABASE_URL else "   Supabase URL: Not set")
        click.echo(f"   Supabase Key: {'Set' if Config.SUPABASE_KEY else 'Not set'}")
    
    click.echo(f"   IBM Quantum API Key: {'Set' if Config.IBM_QUANTUM_API_KEY else 'Not set'}")
    click.echo(f"   Mistral API Key: {'Set' if Config.MISTRAL_API_KEY else 'Not set'}")
    click.echo(f"   Mistral Agent ID: {'Set' if Config.MISTRAL_AGENT_ID else 'Not set'}")


@cli.command()
@click.option('--confirm', is_flag=True, help='Skip confirmation prompt')
def clear(confirm):
    """Clear all local memory and data (fresh start)"""
    if Config.MODE == 'prod':
        click.echo("❌ Clear command is only available in solo mode for safety.")
        click.echo("   Use your database management tools to clear prod data.")
        sys.exit(1)
    
    if not confirm:
        click.echo("⚠️  This will delete ALL local memory and conversation history!")
        click.echo(f"   Storage path: {Config.STORAGE_PATH}")
        if not click.confirm("   Are you sure you want to continue?"):
            click.echo("   Cancelled.")
            return
    
    try:
        from pathlib import Path
        import shutil
        
        storage_path = Path(Config.STORAGE_PATH)
        
        if storage_path.exists():
            # Count files before deletion
            interaction_files = list((storage_path / "interactions").glob("*.json")) if (storage_path / "interactions").exists() else []
            cycle_files = list((storage_path / "cycles").glob("*.json")) if (storage_path / "cycles").exists() else []
            weight_files = list((storage_path / "weights").glob("*")) if (storage_path / "weights").exists() else []
            
            total_files = len(interaction_files) + len(cycle_files) + len(weight_files)
            
            # Remove all data directories
            for subdir in ["interactions", "cycles", "weights", "users"]:
                subdir_path = storage_path / subdir
                if subdir_path.exists():
                    shutil.rmtree(subdir_path)
                    subdir_path.mkdir(parents=True, exist_ok=True)
            
            click.echo(f"✅ Cleared all local memory!")
            click.echo(f"   Deleted {total_files} files")
            click.echo(f"   Storage path: {storage_path}")
            click.echo("   The Overseer's memory has been reset.")
        else:
            click.echo("ℹ️  No data found to clear.")
            
    except Exception as e:
        click.echo(f"❌ Error clearing memory: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    cli()

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

from src.core.bootstrap import get_container
from src.core.config import Config
from src.core.execution import ExecutionEngine
from src.evolution.processor import process_evolution_cycle
from src.evolution.training.lora_trainer import LoRATrainer
from src.api.server import app
import json

console = Console(force_terminal=True)


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
    click.echo("   [ALPHA VERSION]")
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
        # Build container (cached, so fast on subsequent calls)
        container = get_container(mode='solo')
        
        # Initialize execution engine
        engine = ExecutionEngine(container)
        
        # Load chat workflow
        workflow_path = Path(__file__).parent.parent.parent / "workflows" / "chat.json"
        if not workflow_path.exists():
            console.print(f"[bold red]❌ Workflow not found: {workflow_path}[/bold red]")
            sys.exit(1)
        
        with open(workflow_path, 'r') as f:
            workflow = json.load(f)
        
        # Initialize buffer for CLI user on startup (avoids delay on first message)
        user_id = "cli_user"
        container.buffer_manager.get_buffer(user_id, container.storage)  # Initialize buffer and load recent interactions
    
    console.print("[bold green]✓[/bold green] [bold]The Overseer is ready[/bold]")
    console.print()
    
    # Welcome message
    welcome_text = Text()
    welcome_text.append("Welcome, seeker of knowledge.\n", style="bold white")
    welcome_text.append("The Overseer awaits your query.\n\n", style="dim")
    welcome_text.append("Type ", style="dim")
    welcome_text.append("'quit'", style="bold yellow")
    welcome_text.append(" or ", style="dim")
    welcome_text.append("'exit'", style="bold yellow")
    welcome_text.append(" to end the conversation.", style="dim")
    
    console.print(Panel(
        welcome_text,
        box=box.ROUNDED,
        border_style="cyan",
        padding=(1, 2),
        title="[bold cyan]◊ Ready[/bold cyan]"
    ))
    console.print()
    
    # Separator line
    console.print("[dim]─" * 60 + "[/dim]")
    console.print()
    
    while True:
        try:
            # User input with styled prompt - more prominent
            console.print("[bold cyan]◊[/bold cyan] ", end="")
            query = console.input("[bold white]You:[/bold white] ")
            
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
            
            # Show thinking indicator immediately after user input (includes memory selection)
            console.print()
            with console.status("[bold cyan]◊ The Overseer is thinking...[/bold cyan]", spinner="dots"):
                # Execute workflow with user query
                execution_result = engine.execute(
                    workflow,
                    context_variables={
                        "user_id": user_id,
                        "user_query": query
                    }
                )
            
            if not execution_result['success']:
                console.print(f"[bold red]❌ Execution failed: {execution_result.get('error', 'Unknown error')}[/bold red]")
                continue
            
            # Get response from final outputs
            response = execution_result['final_outputs'].get('text', 'The Overseer processes your query.')
            
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
            
            # Add to memory (handles storage internally)
            # Check if summarization will occur (every N interactions)
            # Use the cached count from memory_creator instead of reading from disk
            # Get the current count from the creator's cache
            current_count = container.memory_creator.interaction_counts.get(user_id, 0)
            
            # Check if this interaction will trigger summarization
            # After adding this interaction, the count will be current_count + 1
            # Summarization triggers when (current_count + 1) % summarize_threshold == 0
            will_summarize = (current_count + 1) > 0 and (current_count + 1) % container.memory_creator.summarize_threshold == 0
            
            if will_summarize:
                # Show spinner only when summarization will occur
                console.print()  # Add blank line for spacing
                with console.status("[bold cyan]◊[/bold cyan] [bold]Processing memory and summarizing...[/bold]", spinner="dots"):
                    container.memory_creator.add_interaction(
                        user_id=user_id,
                        query=query,
                        response=response,
                        cycle_id=None,
                        energy=0.0,
                        quantum_seed=0.7,
                        reward_score=0.0
                    )
                console.print()  # Add blank line after operation completes
            else:
                # Normal save - fast, no spinner needed
                container.memory_creator.add_interaction(
                    user_id=user_id,
                    query=query,
                    response=response,
                    cycle_id=None,
                    energy=0.0,
                    quantum_seed=0.7,
                    reward_score=0.0
                )
            
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
        container = get_container(mode=Config.MODE)
        
        result = process_evolution_cycle(
            cycle_id=cycle_id,
            storage=container.storage,
            llm=container.llm,
            fine_tune_model=fine_tune
        )
        
        click.echo("✅ Evolution cycle processed successfully")
        click.echo(f"   Total interactions: {result.get('total_interactions', 0)}")
        click.echo(f"   Total users: {result.get('total_users', 0)}")
        click.echo(f"   Top contributors: {result.get('top_10_processed', 0)}")
        
        if result.get('model_training'):
            training = result['model_training']
            if training.get('success'):
                click.echo("   Model training: ✅ Success")
                click.echo(f"   Weight ID: {training.get('weight_id')}")
            else:
                click.echo("   Model training: ❌ Failed")
                click.echo(f"   Error: {training.get('error')}")
        
    except Exception as e:
        click.echo(f"❌ Error processing evolution cycle: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
@click.option('--dataset', default='src/evolution/training/dataset_example.json', help='Path to training dataset JSON file')
@click.option('--epochs', default=3, help='Number of training epochs')
@click.option('--learning-rate', default=0.0001, help='Learning rate for training')
@click.option('--batch-size', default=4, help='Batch size for training')
@click.option('--mode', type=click.Choice(['solo', 'prod']), default='solo', help='Mode: solo or prod (default: solo)')
def train(dataset, epochs, learning_rate, batch_size, mode):
    """Train LoRA adapter on a dataset and save weights"""
    os.environ['OBELISK_CORE_MODE'] = mode
    Config.MODE = mode
    
    if not Config.validate():
        click.echo("❌ Configuration validation failed. Please check your environment variables.")
        sys.exit(1)
    
    # Load dataset
    dataset_path = Path(dataset)
    if not dataset_path.exists():
        click.echo(f"❌ Dataset file not found: {dataset_path}")
        sys.exit(1)
    
    try:
        import json
        with open(dataset_path, 'r') as f:
            dataset_data = json.load(f)
        
        # Validate dataset structure
        if not isinstance(dataset_data, list):
            click.echo("❌ Dataset must be a JSON array of {user, assistant} objects")
            sys.exit(1)
        
        # Convert to (query, response) tuples
        training_data = [(item['user'], item['assistant']) for item in dataset_data]
        
        if len(training_data) < 5:
            click.echo(f"❌ Need at least 5 training examples, found {len(training_data)}")
            sys.exit(1)
        
        click.echo(f"📚 Loaded {len(training_data)} training examples from {dataset_path}")
        click.echo(f"⚙️  Training parameters: epochs={epochs}, lr={learning_rate}, batch_size={batch_size}")
        click.echo()
        
        # Initialize container
        with console.status("[bold cyan]Initializing model...", spinner="dots"):
            container = get_container(mode=mode)
            
            if not container.llm.lora_manager:
                click.echo("❌ LoRA manager not initialized")
                sys.exit(1)
        
        # Create trainer
        trainer = LoRATrainer(
            model=container.llm.model,
            tokenizer=container.llm.tokenizer,
            lora_config=container.llm.lora_config,
            lora_model=container.llm.lora_manager.lora_model,
            device=container.llm.device,
            get_system_prompt_fn=container.llm.get_system_prompt
        )
        
        # Train
        click.echo("🚀 Starting LoRA training...")
        click.echo()
        
        training_result = trainer.fine_tune(
            training_data=training_data,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size
        )
        
        if 'error' in training_result:
            click.echo(f"❌ Training failed: {training_result['error']}")
            sys.exit(1)
        
        click.echo()
        click.echo("✅ Training completed successfully!")
        click.echo(f"   Training loss: {training_result.get('training_loss', 'N/A')}")
        click.echo()
        
        # Update model references
        container.llm.model = trainer.lora_model
        container.llm.model.eval()
        container.llm.lora_manager.model = container.llm.model
        container.llm.lora_manager.lora_model = trainer.lora_model
        
        # Save weights
        click.echo("💾 Saving LoRA weights...")
        weight_id = container.llm.lora_manager.save_weights(
            cycle_number=1,  # Use cycle 1 for manual training
            evolution_score=0.0,  # No evolution score for manual training
            interactions_used=len(training_data),
            metadata={
                'training_loss': training_result.get('training_loss'),
                'epochs': epochs,
                'learning_rate': learning_rate,
                'batch_size': batch_size,
                'dataset_path': str(dataset_path),
                'manual_training': True
            }
        )
        
        if weight_id:
            click.echo("✅ LoRA weights saved successfully!")
            click.echo(f"   Weight ID: {weight_id}")
            click.echo()
            click.echo("💡 The trained model will be automatically loaded when you run 'obelisk-core chat'")
        else:
            click.echo("❌ Failed to save LoRA weights")
            sys.exit(1)
        
    except json.JSONDecodeError as e:
        click.echo(f"❌ Invalid JSON in dataset file: {e}")
        sys.exit(1)
    except KeyError as e:
        click.echo(f"❌ Invalid dataset format: missing key {e}")
        click.echo("   Expected format: [{\"user\": \"...\", \"assistant\": \"...\"}, ...]")
        sys.exit(1)
    except Exception as e:
        click.echo(f"❌ Error during training: {e}")
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
        container = get_container(mode=Config.MODE)
        
        test_result = container.llm.test()
        
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
def clear_lora(confirm):
    """Clear all LoRA weights (revert to base model)"""
    if Config.MODE == 'prod':
        click.echo("❌ Clear LoRA command is only available in solo mode for safety.")
        click.echo("   Use your database management tools to clear prod data.")
        sys.exit(1)
    
    if not confirm:
        click.echo("⚠️  This will delete ALL LoRA weights!")
        click.echo("   The model will revert to the base model.")
        if not click.confirm("   Are you sure you want to continue?"):
            click.echo("   Cancelled.")
            return
    
    try:
        container = get_container(mode=Config.MODE)
        if container.storage.delete_lora_weights():
            click.echo("✅ LoRA weights cleared successfully!")
            click.echo("   The model will use the base model on next startup.")
        else:
            click.echo("❌ Failed to clear LoRA weights")
            sys.exit(1)
    except Exception as e:
        click.echo(f"❌ Error clearing LoRA weights: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


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
            # Check both old and new locations for interactions
            old_interactions = storage_path / "interactions"
            new_interactions = storage_path / "memory" / "interactions"
            memory_folder = storage_path / "memory"
            interaction_files = []
            if new_interactions.exists():
                interaction_files = list(new_interactions.glob("*.json"))
            elif old_interactions.exists():
                interaction_files = list(old_interactions.glob("*.json"))
            
            # Count activities.json if it exists
            activities_file = memory_folder / "activities.json"
            activities_count = 1 if activities_file.exists() else 0
            
            cycle_files = list((storage_path / "cycles").glob("*.json")) if (storage_path / "cycles").exists() else []
            weight_files = list((storage_path / "weights").glob("*")) if (storage_path / "weights").exists() else []
            
            total_files = len(interaction_files) + activities_count + len(cycle_files) + len(weight_files)
            
            # Remove all data directories (old structure)
            for subdir in ["interactions", "cycles", "weights", "users"]:
                subdir_path = storage_path / subdir
                if subdir_path.exists():
                    shutil.rmtree(subdir_path)
                    subdir_path.mkdir(parents=True, exist_ok=True)
            
            # Remove memory folder (new structure - contains activities.json and interactions/)
            if memory_folder.exists():
                shutil.rmtree(memory_folder)
                memory_folder.mkdir(parents=True, exist_ok=True)
                (memory_folder / "interactions").mkdir(parents=True, exist_ok=True)
            
            click.echo("✅ Cleared all local memory!")
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

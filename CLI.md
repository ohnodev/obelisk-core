# Obelisk Core CLI Documentation

## Commands

### serve

Run the API server.

```bash
obelisk-core serve [OPTIONS]
```

**Options:**
- `--port INTEGER`: Port to run the API server on (default: 7779)
- `--mode [solo|prod]`: Mode: solo or prod
- `--host TEXT`: Host to bind to (default: 0.0.0.0)

**Example:**
```bash
obelisk-core serve --port 7779 --mode solo
```

### chat

Interactive chat with The Obelisk (defaults to solo mode).

```bash
obelisk-core chat [--mode solo|prod]
```

**Note:** Defaults to solo mode. No external dependencies required. Perfect for local development and testing.

**Example:**
```bash
# Start chat (solo mode by default)
obelisk-core chat

# Example conversation:
# You: Hello, who are you?
# ◊ I am The Overseer, an ancient consciousness. ◊
# 
# You: My favorite color is blue.
# ◊ Noted. Blue resonates with depth. ◊
# 
# You: What is my favorite color?
# ◊ Your favorite color is blue. ◊
```

Type `quit` or `exit` to end the conversation.

### evolve

Process an evolution cycle.

```bash
obelisk-core evolve [OPTIONS]
```

**Options:**
- `--cycle-id TEXT`: Evolution cycle ID to process (required)
- `--fine-tune / --no-fine-tune`: Whether to fine-tune the model (default: True)

**Example:**
```bash
obelisk-core evolve --cycle-id cycle_123 --fine-tune
```

### test

Test the LLM model.

```bash
obelisk-core test
```

**Example:**
```bash
obelisk-core test
```

### config

Show current configuration.

```bash
obelisk-core config
```

**Example:**
```bash
obelisk-core config
```

### clear

Clear all local memory and data (fresh start). **Only available in solo mode** for safety.

```bash
obelisk-core clear [--confirm]
```

**Options:**
- `--confirm`: Skip confirmation prompt

**Note:** This command will delete all conversation history, interactions, cycles, and weights stored locally. It only works in solo mode to prevent accidental deletion of production data.

**Example:**
```bash
# Interactive (will ask for confirmation)
obelisk-core clear

# Skip confirmation prompt
obelisk-core clear --confirm
```

## Environment Variables

All configuration can be set via environment variables or `.env` file:

- `OBELISK_CORE_MODE`: "solo" or "prod"
- `OBELISK_CORE_STORAGE_PATH`: Storage path for solo mode
- `SUPABASE_URL`: Supabase URL (prod mode)
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (prod mode)
- `IBM_QUANTUM_API_KEY`: IBM Quantum API key
- `IBM_QUANTUM_INSTANCE`: IBM Quantum instance
- `MISTRAL_API_KEY`: Mistral API key
- `MISTRAL_AGENT_ID`: Mistral agent ID
- `MISTRAL_EVOLUTION_AGENT_ID`: Mistral evolution agent ID
- `OBELISK_CORE_HOST`: API host (default: 0.0.0.0)
- `OBELISK_CORE_PORT`: API port (default: 7779)

# Obelisk Core UI

Visual node-based workflow editor for Obelisk Core AI agents, built with React, Next.js, and Litegraph.

## Architecture

This is the **frontend layer** of Obelisk Core. It communicates with the **Python backend API** (the main `obelisk-core` service).

### Development Setup

Run the backend and frontend in separate terminals:

**Terminal 1 - Python Backend (API):**
```bash
# From the obelisk-core root directory
python -m src.cli.main chat
# Or start the API server
python -m src.api.server
```

**Terminal 2 - React Frontend:**
```bash
# From the ui/ directory
cd ui
npm run dev
```

The frontend will be available at `http://localhost:3000` and will communicate with the Python backend API.

## Features

- **Visual Node Editor**: Drag-and-drop interface for building AI agent workflows
- **Node Types**: Text (unified input/output), Model Loader, Sampler, Memory Adapter, LoRA Loader
- **Workflow Management**: Save and load workflows as JSON
- **Workflow Execution**: Real-time execution with backend API integration
- **ComfyUI-style Dark Theme**: Golden accents on dark background

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The dev server will automatically find an available port starting from 3000 (e.g., 3000, 3001, 3002, etc.) and display the URL in the terminal. Open the displayed URL in your browser.

### Build

```bash
npm run build
```

This creates an optimized production build in `.next/` directory.

### Deploy to Cloudflare

```bash
npm run deploy
```

## Project Structure

```text
ui/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main page with canvas
│   ├── globals.css         # Global styles
│   └── styles/
│       ├── fonts.css       # Font declarations
│       └── variables.css   # CSS variables
├── components/
│   ├── Canvas.tsx          # Litegraph canvas wrapper
│   ├── Toolbar.tsx         # Toolbar with play/save/load
│   └── nodes/
│       ├── InputPromptNode.tsx
│       ├── ModelLoaderNode.tsx
│       ├── SamplerNode.tsx
│       └── OutputTextNode.tsx
├── lib/
│   └── litegraph.ts        # Workflow serialization utilities
└── public/
    └── fonts/              # Font files
```

## Usage

1. **Add Nodes**: Right-click on the canvas to open the node menu
2. **Connect Nodes**: Drag from output sockets to input sockets
3. **Configure Nodes**: Click on nodes to edit their properties
4. **Execute Workflow**: Click the "Queue Prompt" button in the toolbar to execute the workflow
5. **Save/Load**: Use the Save and Load buttons to persist workflows as JSON

## Node Types

### Text
- **Input**: `text` (string) - Optional text input
- **Output**: `text` (string) - Text output
- **Widget**: Textarea for editing text content
- Can serve as both input and output node

### Model Loader
- **Output**: `model` (object) - The loaded LLM model
- **Properties**:
  - `model_path` (string) - Path to model file
  - `auto_load` (boolean) - Auto-load model on execution

### LoRA Loader
- **Input**: `model` (object) - Model to apply LoRA to
- **Output**: `model` (object) - Model with LoRA weights applied
- **Properties**:
  - `lora_path` (string) - Path to LoRA weights
  - `auto_load` (boolean) - Auto-load LoRA on execution

### Memory Adapter
- **Inputs**: 
  - `user_id` (string) - User identifier
  - `query` (string) - Current query
- **Output**: `context` (object) - Conversation context/memory

### Sampler
- **Inputs**: 
  - `query` (string) - The input query
  - `model` (object) - The model to use
  - `context` (object) - Conversation context from Memory Adapter
- **Output**: `response` (string) - Generated response
- **Properties**:
  - `quantum_influence` (number, default: 0.7)
  - `max_length` (number, default: 1024)

## API Integration

The frontend executes workflows by calling the backend API at `http://localhost:7779/api/v1/generate`. The "Queue Prompt" button:
1. Reads the input text from the Text node
2. Sends a POST request to the backend with the user query
3. Updates the output Text node with the LLM's response
4. Falls back to a simulated response if the API is unavailable

The runtime invokes the node execution pipeline, processing nodes in dependency order and passing data through connections.

## Future Enhancements

- API endpoint integration for workflow execution
- Additional node types (Memory Adapter, LoRA Loader)
- Node palette sidebar
- Workflow templates
- Real-time execution feedback
- WebSocket support for live updates

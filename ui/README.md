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
- **4 Basic Nodes**: Input Prompt, Model Loader, Sampler, and Output Text
- **Workflow Management**: Save and load workflows as JSON
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

```
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

1. **Add Nodes**: Right-click on the canvas to open the node menu, or use the node palette (coming soon)
2. **Connect Nodes**: Drag from output sockets to input sockets
3. **Configure Nodes**: Click on nodes to edit their properties
4. **Execute Workflow**: Click the "Play" button in the toolbar (API integration coming soon)
5. **Save/Load**: Use the Save and Load buttons to persist workflows

## Node Types

### Input Prompt
- **Output**: `text` (string) - The user's input prompt

### Model Loader
- **Output**: `model` (object) - The loaded LLM model

### Sampler
- **Inputs**: 
  - `query` (string) - The input query
  - `model` (object) - The model to use
  - `context` (object) - Conversation context
- **Output**: `response` (string) - Generated response
- **Properties**:
  - `quantum_influence` (number, default: 0.7)
  - `max_length` (number, default: 1024)

### Output Text
- **Input**: `response` (string) - The final output text

## API Integration

The frontend generates JSON workflows that match the format expected by the Python backend execution engine (`src/core/execution/engine.py`). The Play button will POST workflow JSON to the backend API endpoint (to be implemented).

## Future Enhancements

- API endpoint integration for workflow execution
- Additional node types (Memory Adapter, LoRA Loader)
- Node palette sidebar
- Workflow templates
- Real-time execution feedback
- WebSocket support for live updates

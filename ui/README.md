# Obelisk Core UI

Visual node-based workflow editor for Obelisk Core AI agents, built with React, Next.js, and Litegraph.

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

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
```

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
4. **Execute Workflow**: Click the "Play" button in the toolbar
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

## Future Enhancements

- API integration for workflow execution
- Additional node types (Memory Adapter, LoRA Loader)
- Node palette sidebar
- Workflow templates
- Real-time execution feedback

"use client";

import { useState, useEffect, useRef } from "react";
import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

interface NodeMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onNodeSelect: (nodeType: string) => void;
}

interface NodeCategory {
  name: string;
  nodes: NodeMenuItem[];
}

interface NodeMenuItem {
  type: string;
  title: string;
  description?: string;
}

const NODE_CATEGORIES: NodeCategory[] = [
  {
    name: "Text",
    nodes: [
      {
        type: "text",
        title: "Text",
        description: "Text input/output node with textarea",
      },
    ],
  },
  {
    name: "Model",
    nodes: [
      {
        type: "model_loader",
        title: "Model Loader",
        description: "Loads the LLM model",
      },
      {
        type: "lora_loader",
        title: "LoRA Loader",
        description: "Applies LoRA weights to model",
      },
    ],
  },
  {
    name: "Memory",
    nodes: [
      {
        type: "memory_adapter",
        title: "Memory Adapter",
        description: "Gets conversation context from memory",
      },
    ],
  },
  {
    name: "Generation",
    nodes: [
      {
        type: "inference",
        title: "Inference",
        description: "Generates LLM response (inference for LLM use cases)",
      },
    ],
  },
];

export default function NodeMenu({ visible, x, y, onClose, onNodeSelect }: NodeMenuProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Filter nodes based on search query
  const filteredCategories = NODE_CATEGORIES.map((category) => ({
    ...category,
    nodes: category.nodes.filter(
      (node) =>
        node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((category) => category.nodes.length > 0);

  // Close menu when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const handleNodeClick = (nodeType: string) => {
    onNodeSelect(nodeType);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: "320px",
        maxHeight: "500px",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "6px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Search bar */}
      <div
        style={{
          padding: "0.75rem",
          borderBottom: "1px solid var(--color-border-primary)",
        }}
      >
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          style={{
            width: "100%",
            padding: "0.5rem",
            background: "var(--color-input-bg)",
            border: "1px solid var(--color-input-border)",
            borderRadius: "4px",
            color: "var(--color-input-text)",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filteredCategories.length > 0 && filteredCategories[0].nodes.length > 0) {
              handleNodeClick(filteredCategories[0].nodes[0].type);
            }
          }}
        />
      </div>

      {/* Node list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.5rem",
        }}
      >
        {filteredCategories.map((category) => (
          <div key={category.name} style={{ marginBottom: "0.75rem" }}>
            <div
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                borderBottom: "1px solid var(--color-border-tertiary)",
                marginBottom: "0.25rem",
              }}
            >
              {category.name}
            </div>
            {category.nodes.map((node) => (
              <button
                key={node.type}
                onClick={() => handleNodeClick(node.type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    if (e.key === " ") {
                      e.preventDefault(); // Prevent scrolling
                    }
                    handleNodeClick(node.type);
                  }
                }}
                aria-label={`Add ${node.title} node`}
                style={{
                  padding: "0.75rem",
                  margin: "0.25rem 0",
                  borderRadius: "4px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  background: "transparent",
                  border: "1px solid transparent",
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--color-button-primary-bg)";
                  e.currentTarget.style.borderColor = "var(--color-border-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <div
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  {node.title}
                </div>
                {node.description && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      lineHeight: 1.4,
                    }}
                  >
                    {node.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
        {filteredCategories.length === 0 && (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: "var(--color-text-muted)",
              fontSize: "0.875rem",
            }}
          >
            No nodes found
          </div>
        )}
      </div>
    </div>
  );
}

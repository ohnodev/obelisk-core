"use client";

import { useState, useEffect, useRef } from "react";
import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  Placement,
} from "@floating-ui/react";

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
        type: "memory_storage",
        title: "Memory Storage",
        description: "Creates/accesses storage instances based on storage path",
      },
      {
        type: "memory_selector",
        title: "Memory Selector",
        description: "Selects relevant conversation context from storage",
      },
      {
        type: "memory_creator",
        title: "Memory Creator",
        description: "Saves query/response interactions to storage",
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
  
  // Use Floating UI for smart positioning with virtual reference
  const { refs, floatingStyles } = useFloating({
    open: visible,
    placement: "bottom-start" as Placement,
    middleware: [
      offset(8), // 8px gap from click position
      flip({
        fallbackAxisSideDirection: "start",
        padding: { top: 60, bottom: 8, left: 8, right: 8 }, // Account for toolbar height
      }),
      shift({
        padding: { top: 60, bottom: 8, left: 8, right: 8 }, // Account for toolbar height
      }),
      size({
        apply({ availableWidth, elements }) {
          // Only constrain width, not height - we want a fixed small height
          elements.floating.style.maxWidth = `${Math.min(availableWidth, 280)}px`;
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  // Set virtual reference position using setPositionReference
  useEffect(() => {
    if (visible) {
      refs.setPositionReference({
        getBoundingClientRect: () => ({
          x,
          y,
          width: 0,
          height: 0,
          top: y,
          left: x,
          right: x,
          bottom: y,
        }),
      });
    }
  }, [visible, x, y, refs]);

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

  // Close menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!visible) return;

    // Add a small delay to prevent immediate closing when right-click releases
    const openTime = Date.now();
    const IGNORE_CLICKS_MS = 100; // Ignore clicks within 100ms of opening

    const handleClickOutside = (event: MouseEvent) => {
      // Ignore right mouse button releases (button 2) - these are from the contextmenu trigger
      if (event.button === 2) {
        return;
      }
      
      // Ignore clicks that happen too soon after opening (from mouse release)
      if (Date.now() - openTime < IGNORE_CLICKS_MS) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    // Use mouseup instead of mousedown to avoid catching the release of right-click
    // Also use a small delay to ensure the menu is fully rendered
    const timeoutId = setTimeout(() => {
      document.addEventListener("mouseup", handleClickOutside);
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, IGNORE_CLICKS_MS);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mouseup", handleClickOutside);
      document.removeEventListener("click", handleClickOutside);
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
      ref={(node) => {
        menuRef.current = node;
        refs.setFloating(node);
      }}
      style={{
        ...floatingStyles,
        position: "fixed",
        width: "280px",
        height: "400px",
        maxHeight: "400px",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "6px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Search bar with close button */}
      <div
        style={{
          padding: "0.75rem",
          borderBottom: "1px solid var(--color-border-primary)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          style={{
            flex: 1,
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
            if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <button
          onClick={onClose}
          aria-label="Close menu"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            padding: 0,
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "4px",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-button-secondary-bg)";
            e.currentTarget.style.borderColor = "var(--color-border-primary)";
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 4L4 12M4 4l8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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

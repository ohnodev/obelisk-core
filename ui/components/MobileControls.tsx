"use client";

import { useState, useEffect } from "react";

interface MobileControlsProps {
  onAddNode: () => void;
  onDeleteSelected: () => void;
}

export default function MobileControls({ onAddNode, onDeleteSelected }: MobileControlsProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  // Check if mobile device
  useEffect(() => {
    const checkMobile = () => {
      // Check for touch capability and screen width
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 1200;
      setIsMobile(isTouchDevice && isSmallScreen);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Check for selected nodes periodically
  useEffect(() => {
    const checkSelection = () => {
      const graph = (window as any).__obeliskGraph;
      if (graph) {
        const selectedNodes = graph.list_of_graphcanvas?.[0]?.selected_nodes;
        setHasSelection(selectedNodes && Object.keys(selectedNodes).length > 0);
      }
    };

    // Check every 200ms
    const interval = setInterval(checkSelection, 200);
    return () => clearInterval(interval);
  }, []);

  if (!isMobile) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        zIndex: 100,
      }}
    >
      {/* Delete Selected Button - only show when something is selected */}
      {hasSelection && (
        <button
          onClick={onDeleteSelected}
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: "none",
            background: "rgba(239, 68, 68, 0.9)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            transition: "transform 0.2s, background 0.2s",
          }}
          title="Delete selected node"
          aria-label="Delete selected node"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}

      {/* Add Node Button */}
      <button
        onClick={onAddNode}
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          border: "none",
          background: "rgba(212, 175, 55, 0.9)",
          color: "#1a1a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          transition: "transform 0.2s, background 0.2s",
        }}
        title="Add node"
        aria-label="Add node"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}

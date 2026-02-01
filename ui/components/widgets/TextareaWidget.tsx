"use client";

import { useEffect, useRef, useState } from "react";

interface TextareaWidgetProps {
  value: string;
  onChange: (value: string) => void;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeId: string;
  visible: boolean;
}

export default function TextareaWidget({
  value,
  onChange,
  x,
  y,
  width,
  height,
  nodeId,
  visible,
}: TextareaWidgetProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editValue.length, editValue.length);
    }
  }, [isEditing, editValue.length]);

  const handleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    onChange(editValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      setEditValue(value); // Reset to original value
      setIsEditing(false);
    } else if (e.key === "Enter" && e.ctrlKey) {
      handleBlur();
    }
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "auto",
        zIndex: isEditing ? 10000 : 1,
      }}
      onClick={handleClick}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            height: "100%",
            background: "#1a1a1a",
            color: "#FFFFFF",
            border: "1px solid #555555",
            padding: "4px",
            font: "12px Arial",
            resize: "none",
            outline: "none",
            boxSizing: "border-box",
            borderRadius: "4px",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#1a1a1a",
            border: "1px solid #555555",
            padding: "4px",
            font: "12px Arial",
            color: "#FFFFFF",
            boxSizing: "border-box",
            borderRadius: "4px",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            cursor: "text",
          }}
        >
          {value || <span style={{ color: "#666" }}>Click to edit...</span>}
        </div>
      )}
    </div>
  );
}

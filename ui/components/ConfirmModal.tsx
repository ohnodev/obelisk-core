"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: "danger" | "warning" | "success";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmStyle = "danger",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const getConfirmStyles = () => {
    switch (confirmStyle) {
      case "danger":
        return {
          bg: "rgba(231, 76, 60, 0.15)",
          border: "rgba(231, 76, 60, 0.4)",
          color: "#e74c3c",
          hoverBg: "rgba(231, 76, 60, 0.25)",
        };
      case "warning":
        return {
          bg: "rgba(241, 196, 15, 0.15)",
          border: "rgba(241, 196, 15, 0.4)",
          color: "#f1c40f",
          hoverBg: "rgba(241, 196, 15, 0.25)",
        };
      case "success":
        return {
          bg: "rgba(46, 204, 113, 0.15)",
          border: "rgba(46, 204, 113, 0.4)",
          color: "#2ecc71",
          hoverBg: "rgba(46, 204, 113, 0.25)",
        };
    }
  };

  const styles = getConfirmStyles();

  const modalContent = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1001,
      }}
      onMouseDown={onCancel}
      onTouchStart={onCancel}
    >
      <div
        style={{
          background: "var(--color-bg-secondary, #1a1a2e)",
          borderRadius: "8px",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "400px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: "0 0 0.75rem 0",
            color: "var(--color-text-primary, #fff)",
            fontSize: "1.1rem",
            fontWeight: 600,
          }}
        >
          {title}
        </h3>

        <p
          style={{
            color: "var(--color-text-muted, #888)",
            margin: "0 0 1.5rem 0",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "0.6rem 1.25rem",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              color: "var(--color-text-primary, #fff)",
              cursor: "pointer",
              fontSize: "0.9rem",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "0.6rem 1.25rem",
              background: styles.bg,
              border: `1px solid ${styles.border}`,
              borderRadius: "4px",
              color: styles.color,
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = styles.hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = styles.bg;
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

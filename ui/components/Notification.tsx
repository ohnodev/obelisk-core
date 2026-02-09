"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useRef, useSyncExternalStore, useCallback } from "react";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration: number;
}

// ─── Global notification store (singleton) ───────────────────────────
type Listener = () => void;

let _notifications: Notification[] = [];
const _listeners = new Set<Listener>();
let _lastMessage = "";
let _lastTime = 0;

function _emit() {
  for (const fn of _listeners) fn();
}

function _getSnapshot(): Notification[] {
  return _notifications;
}

function _subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Show a notification. Can be called from anywhere (inside or outside React). */
export function notify(
  message: string,
  type: NotificationType = "info",
  duration: number = 5000
): void {
  // Dedup: same message within 1s is ignored
  const now = Date.now();
  if (_lastMessage === message && now - _lastTime < 1000) return;
  _lastMessage = message;
  _lastTime = now;

  const id = `n-${now}-${(Math.random() * 1e6) | 0}`;
  _notifications = [..._notifications, { id, type, message, duration }];
  _emit();
}

function _dismiss(id: string) {
  _notifications = _notifications.filter((n) => n.id !== id);
  _emit();
}

// ─── Notification item ───────────────────────────────────────────────
function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Slide in
    const frame = requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    if (notification.duration > 0) {
      dismissTimer = setTimeout(() => {
        setVisible(false);
        fadeRef.current = setTimeout(() => onDismiss(notification.id), 300);
      }, notification.duration);
    }

    return () => {
      cancelAnimationFrame(frame);
      if (dismissTimer) clearTimeout(dismissTimer);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, [notification.id, notification.duration, onDismiss]);

  const handleClose = () => {
    setVisible(false);
    if (fadeRef.current) clearTimeout(fadeRef.current);
    fadeRef.current = setTimeout(() => onDismiss(notification.id), 300);
  };

  const colors: Record<NotificationType, { bg: string; border: string; icon: string }> = {
    error:   { bg: "rgba(220,38,38,0.15)",  border: "rgba(185,28,28,0.5)",  icon: "\u274C" },
    success: { bg: "rgba(22,163,74,0.15)",   border: "rgba(21,128,61,0.5)",  icon: "\u2705" },
    warning: { bg: "rgba(202,138,4,0.15)",   border: "rgba(161,98,7,0.5)",   icon: "\u26A0\uFE0F" },
    info:    { bg: "rgba(37,99,235,0.15)",   border: "rgba(29,78,216,0.5)",  icon: "\u2139\uFE0F" },
  };
  const s = colors[notification.type] ?? colors.info;

  return (
    <div
      role="alert"
      style={{
        backgroundColor: s.bg,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: `1px solid ${s.border}`,
        borderLeft: `4px solid ${s.border}`,
        color: "white",
        padding: "14px 20px",
        boxShadow: "0 10px 15px -3px rgba(0,0,0,0.2)",
        borderRadius: "0 8px 8px 0",
        marginBottom: "10px",
        minWidth: "280px",
        maxWidth: "460px",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <span style={{ fontSize: "18px", flexShrink: 0 }}>{s.icon}</span>
      <p style={{ fontWeight: 600, fontSize: "13px", margin: 0, flex: 1 }}>
        {notification.message}
      </p>
      <button
        onClick={handleClose}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "white",
          cursor: "pointer",
          padding: "2px",
          flexShrink: 0,
          opacity: 0.7,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Global container (render once in layout) ────────────────────────
export function NotificationContainer() {
  const notifications = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleDismiss = useCallback((id: string) => _dismiss(id), []);

  if (!mounted || typeof window === "undefined" || notifications.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 9999,
        pointerEvents: "none",
        maxHeight: "calc(100vh - 2rem)",
        overflowY: "auto",
      }}
    >
      <div style={{ pointerEvents: "auto" }}>
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onDismiss={handleDismiss} />
        ))}
      </div>
    </div>,
    document.body
  );
}

// ─── Backwards-compat hook (delegates to global store) ───────────────
export function useNotifications() {
  return {
    showNotification: notify,
    dismissNotification: _dismiss,
  };
}

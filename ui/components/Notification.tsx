"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useRef } from "react";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number; // Auto-dismiss after this many ms (0 = no auto-dismiss)
}

interface NotificationProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

function NotificationItem({ notification, onDismiss }: NotificationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Trigger animation
    setIsVisible(true);
    isMountedRef.current = true;

    // Auto-dismiss if duration is set
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        // Wait for fade-out animation before removing
        fadeTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            onDismiss(notification.id);
          }
        }, 300);
      }, notification.duration);

      return () => {
        clearTimeout(timer);
        if (fadeTimeoutRef.current) {
          clearTimeout(fadeTimeoutRef.current);
        }
        isMountedRef.current = false;
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [notification.id, notification.duration, onDismiss]);

  const getTypeStyles = () => {
    switch (notification.type) {
      case "error":
        return {
          bg: "rgba(220, 38, 38, 0.15)",
          border: "rgba(185, 28, 28, 0.5)",
          backdrop: "rgba(220, 38, 38, 0.1)",
          icon: "❌",
        };
      case "success":
        return {
          bg: "rgba(22, 163, 74, 0.15)",
          border: "rgba(21, 128, 61, 0.5)",
          backdrop: "rgba(22, 163, 74, 0.1)",
          icon: "✅",
        };
      case "warning":
        return {
          bg: "rgba(202, 138, 4, 0.15)",
          border: "rgba(161, 98, 7, 0.5)",
          backdrop: "rgba(202, 138, 4, 0.1)",
          icon: "⚠️",
        };
      case "info":
      default:
        return {
          bg: "rgba(37, 99, 235, 0.15)",
          border: "rgba(29, 78, 216, 0.5)",
          backdrop: "rgba(37, 99, 235, 0.1)",
          icon: "ℹ️",
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      style={{
        backgroundColor: styles.bg,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderLeft: `4px solid ${styles.border}`,
        borderTop: `1px solid ${styles.border}`,
        borderRight: `1px solid ${styles.border}`,
        borderBottom: `1px solid ${styles.border}`,
        color: "white",
        padding: "16px 24px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        marginBottom: "12px",
        minWidth: "300px",
        maxWidth: "500px",
        transition: "all 0.3s ease",
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateX(0)" : "translateX(-100%)",
      }}
      role="alert"
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <span style={{ fontSize: "20px", marginRight: "12px" }}>{styles.icon}</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: "14px", margin: 0 }}>{notification.message}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            // Clear any existing fade timeout
            if (fadeTimeoutRef.current) {
              clearTimeout(fadeTimeoutRef.current);
            }
            fadeTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                onDismiss(notification.id);
              }
            }, 300);
          }}
          style={{
            marginLeft: "16px",
            color: "white",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          aria-label="Dismiss notification"
        >
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

function NotificationContainer({
  notifications,
  onDismiss,
}: NotificationContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof window === "undefined") return null;

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
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}

// Hook for managing notifications
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const lastShownRef = useRef<{ message: string; time: number }>({ message: "", time: 0 });

  const showNotification = (
    message: string,
    type: NotificationType = "info",
    duration: number = 5000
  ) => {
    // Deduplicate: ignore if same message was shown within 1 second
    const now = Date.now();
    if (lastShownRef.current.message === message && now - lastShownRef.current.time < 1000) {
      return "";
    }
    lastShownRef.current = { message, time: now };

    const id = `notification-${now}-${Math.random()}`;
    const notification: Notification = {
      id,
      type,
      message,
      duration,
    };

    setNotifications((prev) => [...prev, notification]);
    return id;
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const NotificationProvider = () => (
    <NotificationContainer
      notifications={notifications}
      onDismiss={dismissNotification}
    />
  );

  return {
    showNotification,
    dismissNotification,
    NotificationProvider,
  };
}

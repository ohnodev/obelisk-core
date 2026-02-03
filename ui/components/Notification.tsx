"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    // Trigger animation
    setIsVisible(true);

    // Auto-dismiss if duration is set
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        // Wait for fade-out animation before removing
        setTimeout(() => onDismiss(notification.id), 300);
      }, notification.duration);

      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.duration, onDismiss]);

  const getTypeStyles = () => {
    switch (notification.type) {
      case "error":
        return {
          bg: "#dc2626",
          border: "#b91c1c",
          icon: "❌",
        };
      case "success":
        return {
          bg: "#16a34a",
          border: "#15803d",
          icon: "✅",
        };
      case "warning":
        return {
          bg: "#ca8a04",
          border: "#a16207",
          icon: "⚠️",
        };
      case "info":
      default:
        return {
          bg: "#2563eb",
          border: "#1d4ed8",
          icon: "ℹ️",
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      style={{
        backgroundColor: styles.bg,
        borderLeft: `4px solid ${styles.border}`,
        color: "white",
        padding: "16px 24px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
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
            setTimeout(() => onDismiss(notification.id), 300);
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
  if (typeof window === "undefined") return null;

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

  const showNotification = (
    message: string,
    type: NotificationType = "info",
    duration: number = 5000
  ) => {
    const id = `notification-${Date.now()}-${Math.random()}`;
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

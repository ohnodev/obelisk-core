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
          bg: "bg-red-600",
          border: "border-red-700",
          icon: "❌",
        };
      case "success":
        return {
          bg: "bg-green-600",
          border: "border-green-700",
          icon: "✅",
        };
      case "warning":
        return {
          bg: "bg-yellow-600",
          border: "border-yellow-700",
          icon: "⚠️",
        };
      case "info":
      default:
        return {
          bg: "bg-blue-600",
          border: "border-blue-700",
          icon: "ℹ️",
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      className={`${styles.bg} ${styles.border} border-l-4 text-white px-6 py-4 shadow-lg rounded-r-lg mb-3 min-w-[300px] max-w-[500px] transition-all duration-300 ${
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-full"
      }`}
      role="alert"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start">
          <span className="text-xl mr-3">{styles.icon}</span>
          <div className="flex-1">
            <p className="font-semibold text-sm">{notification.message}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => onDismiss(notification.id), 300);
          }}
          className="ml-4 text-white hover:text-gray-200 focus:outline-none"
          aria-label="Dismiss notification"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
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
      className="fixed top-4 right-4 z-[9999] pointer-events-none"
      style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}
    >
      <div className="pointer-events-auto">
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

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import RobotMaskIcon from "@/components/icons/RobotMaskIcon";
import ConfirmModal from "@/components/ConfirmModal";
import WalletButton from "@/components/WalletButton";
import { useNotifications } from "@/components/Notification";
import { getApiUrls } from "@/lib/api-config";
import { isAgentOwner, formatAddress } from "@/lib/wallet";

interface Agent {
  agent_id: string;
  name: string;
  status: string;
  container_id: string;
  created_at?: string;
  uptime?: string;
  user_id?: string;
}

interface AgentSlots {
  slots_used: number;
  slots_total: number;
  slots_available: number;
}

export default function DeploymentsPage() {
  // Memoize API URL to ensure stable reference
  const DEPLOYMENT_API = useMemo(() => getApiUrls().serviceApi, []);
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [slots, setSlots] = useState<AgentSlots | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    agentId: string;
    agentName: string;
    action: "stop" | "remove";
  }>({ isOpen: false, agentId: "", agentName: "", action: "stop" });
  const { showNotification, NotificationProvider } = useNotifications();

  // Wallet auth
  const { isConnected, address } = useAccount();
  const { connectWallet } = usePrivy();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      
      const [agentsRes, slotsRes] = await Promise.all([
        fetch(`${DEPLOYMENT_API}/agents`),
        fetch(`${DEPLOYMENT_API}/agents/slots`),
      ]);

      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(agentsData);
      } else {
        throw new Error("Failed to fetch agents");
      }

      if (slotsRes.ok) {
        const slotsData = await slotsRes.json();
        setSlots(slotsData);
      } else {
        // Clear stale slots data on failure
        setSlots(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to deployment service");
      // Clear stale data on error
      setSlots(null);
    } finally {
      setLoading(false);
    }
  }, [DEPLOYMENT_API]);

  useEffect(() => {
    fetchData();
    // Poll every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const requireAuth = (action: string): boolean => {
    if (!isConnected || !address) {
      connectWallet();
      showNotification(`Connect your wallet to ${action}`, "info", 3000);
      return false;
    }
    return true;
  };

  /** Check if the connected wallet can manage this agent */
  const canManageAgent = (agent: Agent): boolean => {
    // Anonymous/legacy agents (no owner) can be managed by any connected wallet
    if (!agent.user_id || agent.user_id === "anonymous") return true;
    // Otherwise, only the owner can manage
    return isAgentOwner(address, agent.user_id);
  };

  const openStopConfirm = (agent: Agent) => {
    if (!requireAuth("manage agents")) return;

    if (!canManageAgent(agent)) {
      showNotification("You can only manage agents you deployed", "error", 4000);
      return;
    }

    setConfirmModal({
      isOpen: true,
      agentId: agent.agent_id,
      agentName: agent.name,
      action: agent.status === "running" ? "stop" : "remove",
    });
  };

  const handleConfirmStop = async () => {
    const { agentId } = confirmModal;
    setConfirmModal(prev => ({ ...prev, isOpen: false }));

    setActionLoading(prev => ({ ...prev, [agentId]: true }));
    try {
      const response = await fetch(`${DEPLOYMENT_API}/agents/${agentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to stop agent");
      }

      showNotification("Agent stopped successfully", "success");
      await fetchData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Failed to stop agent", "error");
    } finally {
      setActionLoading(prev => ({ ...prev, [agentId]: false }));
    }
  };

  const handleRestart = async (agent: Agent) => {
    if (!requireAuth("restart agents")) return;

    if (!canManageAgent(agent)) {
      showNotification("You can only restart agents you deployed", "error", 4000);
      return;
    }

    setActionLoading(prev => ({ ...prev, [agent.agent_id]: true }));
    try {
      const response = await fetch(`${DEPLOYMENT_API}/agents/${agent.agent_id}/restart`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to restart agent");
      }

      showNotification("Agent restarted successfully", "success");
      await fetchData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : "Failed to restart agent", "error");
    } finally {
      setActionLoading(prev => ({ ...prev, [agent.agent_id]: false }));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "#2ecc71";
      case "exited":
      case "dead":
        return "#e74c3c";
      case "paused":
        return "#f39c12";
      default:
        return "#95a5a6";
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg-primary, #0f1419)",
        color: "var(--color-text-primary, #fff)",
        padding: "2rem",
      }}
    >
      {/* Header */}
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <Link
              href="/"
              style={{
                color: "var(--color-text-muted, #888)",
                textDecoration: "none",
                fontSize: "0.9rem",
                display: "inline-block",
                marginBottom: "0.5rem",
              }}
            >
              ← Back to Editor
            </Link>
            <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Deployed Agents</h1>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {/* Wallet Button */}
            <WalletButton />

            {/* Slots indicator */}
            {slots && (
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  padding: "1rem 1.5rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
              >
                <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted, #888)", marginBottom: "0.25rem" }}>
                  Deployment Slots
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  <span style={{ color: slots.slots_available > 0 ? "#2ecc71" : "#e74c3c" }}>
                    {slots.slots_used}
                  </span>
                  <span style={{ color: "var(--color-text-muted, #666)" }}> / {slots.slots_total}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Auth notice */}
        {!isConnected && (
          <div
            style={{
              background: "rgba(212, 175, 55, 0.08)",
              border: "1px solid rgba(212, 175, 55, 0.25)",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: "#d4af37", fontSize: "0.9rem" }}>
              Connect your wallet to manage your deployed agents. Only the wallet that deployed an agent can stop or restart it.
            </span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            style={{
              background: "rgba(231, 76, 60, 0.1)",
              border: "1px solid rgba(231, 76, 60, 0.3)",
              borderRadius: "8px",
              padding: "1rem",
              marginBottom: "1.5rem",
              color: "#e74c3c",
            }}
          >
            <strong>Connection Error:</strong> {error}
            <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--color-text-muted, #888)" }}>
              Make sure the deployment service is running at {DEPLOYMENT_API}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-muted, #888)" }}>
            Loading agents...
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && agents.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "4rem 2rem",
              background: "rgba(255, 255, 255, 0.02)",
              borderRadius: "8px",
              border: "1px dashed rgba(255, 255, 255, 0.1)",
            }}
          >
            <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "center" }}>
              <RobotMaskIcon size={72} color="#2ecc71" />
            </div>
            <h2 style={{ margin: "0 0 0.5rem 0", fontWeight: 500 }}>No agents deployed</h2>
            <p style={{ color: "var(--color-text-muted, #888)", margin: "0 0 1.5rem 0" }}>
              Deploy your first agent from the workflow editor
            </p>
            <Link
              href="/"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                background: "rgba(46, 204, 113, 0.15)",
                border: "1px solid rgba(46, 204, 113, 0.4)",
                borderRadius: "4px",
                color: "#2ecc71",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              Open Editor
            </Link>
          </div>
        )}

        {/* Agents list */}
        {!loading && agents.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {agents.map((agent) => {
              const isOwner = isAgentOwner(address, agent.user_id);
              const canManage = isConnected && canManageAgent(agent);

              return (
                <div
                  key={agent.agent_id}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: `1px solid ${isOwner ? "rgba(212, 175, 55, 0.15)" : "rgba(255, 255, 255, 0.08)"}`,
                    borderRadius: "8px",
                    padding: "1.25rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                      {/* Status indicator */}
                      <div
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: getStatusColor(agent.status),
                          boxShadow: agent.status === "running" ? `0 0 8px ${getStatusColor(agent.status)}` : "none",
                        }}
                      />
                      <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 500 }}>{agent.name}</h3>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          background: `${getStatusColor(agent.status)}20`,
                          color: getStatusColor(agent.status),
                          borderRadius: "4px",
                          textTransform: "uppercase",
                        }}
                      >
                        {agent.status}
                      </span>
                      {/* Ownership badge */}
                      {isOwner && (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.4rem",
                            background: "rgba(212, 175, 55, 0.1)",
                            color: "#d4af37",
                            borderRadius: "4px",
                            border: "1px solid rgba(212, 175, 55, 0.2)",
                          }}
                        >
                          YOUR AGENT
                        </span>
                      )}
                    </div>
                    
                    <div style={{ display: "flex", gap: "2rem", fontSize: "0.85rem", color: "var(--color-text-muted, #888)", flexWrap: "wrap" }}>
                      <div>
                        <span style={{ opacity: 0.7 }}>ID:</span>{" "}
                        <code style={{ fontFamily: "monospace" }}>{agent.agent_id}</code>
                      </div>
                      {agent.uptime && (
                        <div>
                          <span style={{ opacity: 0.7 }}>Uptime:</span> {agent.uptime}
                        </div>
                      )}
                      <div>
                        <span style={{ opacity: 0.7 }}>Container:</span>{" "}
                        <code style={{ fontFamily: "monospace" }}>{agent.container_id}</code>
                      </div>
                      {agent.user_id && agent.user_id !== "anonymous" && (
                        <div>
                          <span style={{ opacity: 0.7 }}>Owner:</span>{" "}
                          <code style={{ fontFamily: "monospace" }}>{formatAddress(agent.user_id)}</code>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions - only shown for owner */}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {canManage ? (
                      <>
                        {agent.status === "running" && (
                          <button
                            onClick={() => handleRestart(agent)}
                            disabled={actionLoading[agent.agent_id] || false}
                            style={{
                              padding: "0.5rem 1rem",
                              background: "rgba(241, 196, 15, 0.1)",
                              border: "1px solid rgba(241, 196, 15, 0.3)",
                              borderRadius: "4px",
                              color: "#f1c40f",
                              cursor: (actionLoading[agent.agent_id] || false) ? "not-allowed" : "pointer",
                              opacity: (actionLoading[agent.agent_id] || false) ? 0.5 : 1,
                              fontSize: "0.85rem",
                            }}
                          >
                            Restart
                          </button>
                        )}
                        <button
                          onClick={() => openStopConfirm(agent)}
                          disabled={actionLoading[agent.agent_id] || false}
                          style={{
                            padding: "0.5rem 1rem",
                            background: "rgba(231, 76, 60, 0.1)",
                            border: "1px solid rgba(231, 76, 60, 0.3)",
                            borderRadius: "4px",
                            color: "#e74c3c",
                            cursor: (actionLoading[agent.agent_id] || false) ? "not-allowed" : "pointer",
                            opacity: (actionLoading[agent.agent_id] || false) ? 0.5 : 1,
                            fontSize: "0.85rem",
                          }}
                        >
                          {agent.status === "running" ? "Stop" : "Remove"}
                        </button>
                      </>
                    ) : (
                      // Non-owner or not connected: show a muted label
                      <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted, #666)", fontStyle: "italic" }}>
                        {!isConnected
                          ? "Connect wallet to manage"
                          : "Owned by another wallet"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm Stop Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.action === "stop" ? "Stop Agent" : "Remove Agent"}
        message={`Are you sure you want to ${confirmModal.action} "${confirmModal.agentName}"? ${
          confirmModal.action === "stop" 
            ? "The agent will stop running and can be removed."
            : "This will permanently remove the agent."
        }`}
        confirmText={confirmModal.action === "stop" ? "Stop Agent" : "Remove"}
        confirmStyle="danger"
        onConfirm={handleConfirmStop}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Notifications */}
      <NotificationProvider />
    </div>
  );
}

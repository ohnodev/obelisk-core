"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { WorkflowGraph } from "@/lib/litegraph";
import { updateNodeOutputs } from "@/lib/workflow-execution";
import { getApiUrls } from "@/lib/api-config";
import PlayIcon from "./icons/PlayIcon";
import SaveIcon from "./icons/SaveIcon";
import LoadIcon from "./icons/LoadIcon";
import StopIcon from "./icons/StopIcon";
import DeployIcon from "./icons/DeployIcon";
import AgentsIcon from "./icons/AgentsIcon";
import HamburgerIcon from "./icons/HamburgerIcon";
import TemplatesIcon from "./icons/TemplatesIcon";
import DeployModal from "./DeployModal";
import WalletButton from "./WalletButton";
import { useNotifications } from "./Notification";

// Workflow templates
import telegramV1Template from "@/workflows/default.json";
import girlfriendTemplate from "@/workflows/girlfriend.json";

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  data: any;
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "telegram-v1",
    name: "Telegram V1 Bot",
    description: "Default Telegram bot with memory, binary intent, and boolean logic",
    data: telegramV1Template,
  },
  {
    id: "girlfriend",
    name: "Aria – The Playful One",
    description: "Energetic, witty HTTP-based AI companion with memory",
    data: girlfriendTemplate,
  },
];

// Node types that run autonomously (continuously) and require the persistent runner
const AUTONOMOUS_NODE_TYPES = new Set(["telegram_listener", "scheduler", "http_listener"]);

// Single breakpoint for responsive design
const MOBILE_BREAKPOINT = 1200;

interface ToolbarProps {
  onExecute?: (getGraph?: () => any) => void | Promise<void>;
  onSave?: (workflow: WorkflowGraph) => void;
  onLoad?: (workflow: WorkflowGraph) => void;
  workflow?: WorkflowGraph;
}

export default function Toolbar({ 
  onExecute, 
  onSave, 
  onLoad, 
  workflow, 
}: ToolbarProps) {
  // Get API URLs based on dev/prod mode
  const { coreApi: apiBaseUrl, serviceApi: deploymentApiUrl } = getApiUrls();
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isRunPending, setIsRunPending] = useState(false); // guards against double-clicks
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const templatesRef = useRef<HTMLDivElement>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const lastResultsVersionRef = useRef<number>(0);
  const { showNotification } = useNotifications();

  // Wallet auth
  const { isConnected, address } = useAccount();
  const { connectWallet } = usePrivy();

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      // Close menu when switching to desktop
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        setIsMobileMenuOpen(false);
      }
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleDeploy = async (name: string, envVars: Record<string, string>) => {
    // If wallet is not connected, prompt connection and return early so
    // the modal doesn't treat this as a failed deploy.
    if (!isConnected || !address) {
      connectWallet();
      return;
    }

    const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
    if (!serializeWorkflow) {
      throw new Error("Workflow serializer not available");
    }
    
    const currentWorkflow = serializeWorkflow();
    if (!currentWorkflow) {
      throw new Error("No workflow to deploy");
    }

    const response = await fetch(`${deploymentApiUrl}/agents/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: currentWorkflow,
        name,
        user_id: address.toLowerCase(), // Use wallet address as user_id
        env_vars: envVars,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server returned ${response.status}`);
    }

    const result = await response.json();
    showNotification(`Agent deployed successfully! ID: ${result.agent_id}`, "success", 6000);
  };

  // Close templates dropdown when clicking outside
  useEffect(() => {
    if (!isTemplatesOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setIsTemplatesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isTemplatesOpen]);

  const handleTemplateSelect = (template: WorkflowTemplate) => {
    setIsTemplatesOpen(false);
    setIsMobileMenuOpen(false);
    if (onLoad) {
      onLoad(template.data as WorkflowGraph);
      showNotification(`Loaded template: ${template.name}`, "info", 2000);
    }
  };

  const handleDeployClick = () => {
    if (!isConnected || !address) {
      // Prompt wallet connection first
      connectWallet();
      showNotification("Connect your wallet to deploy agents", "info", 3000);
      return;
    }
    setShowDeployModal(true);
    setIsMobileMenuOpen(false);
  };

  /** Check if a serialized workflow contains any autonomous nodes */
  const hasAutonomousNodes = (wf: WorkflowGraph): boolean => {
    return wf.nodes.some((n) => AUTONOMOUS_NODE_TYPES.has(n.type));
  };

  /** One-shot execution via the queue API */
  const executeOnce = async () => {
    setIsExecuting(true);
    try {
      const executeHandler = (window as any).__obeliskExecute;
      if (executeHandler) {
        await executeHandler();
      } else if (onExecute) {
        const getGraph = () => (window as any).__obeliskGraph;
        await onExecute(getGraph);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  /** Helper: tear down the status poller and reset running state */
  const clearRunnerState = () => {
    setIsRunning(false);
    setRunningWorkflowId(null);
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  };

  /** Unified Run button handler – auto-detects autonomous vs one-shot */
  const handleRun = async () => {
    // Guard against rapid double-clicks while a start/stop request is in flight
    if (isRunPending) return;
    setIsRunPending(true);

    try {
      // If already running autonomously, stop it
      if (isRunning && runningWorkflowId) {
        try {
          const response = await fetch(`${apiBaseUrl}/api/v1/workflow/stop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflow_id: runningWorkflowId }),
          });
          if (response.ok) {
            clearRunnerState();
          } else {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.detail || `Server returned ${response.status}`;
            showNotification(`Failed to stop workflow: ${errorMsg}`, "error");
            // Re-sync UI with actual server state — only clear if confirmed stopped
            try {
              const statusRes = await fetch(`${apiBaseUrl}/api/v1/workflow/status/${runningWorkflowId}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (status.state === "running") {
                  setIsRunning(true);
                } else {
                  clearRunnerState();
                }
              }
              // If status fetch fails, keep current state — don't assume stopped
            } catch {
              // Network error on status check — keep running state as-is
            }
          }
        } catch (error) {
          // Network/transport error on the stop request itself —
          // the workflow may still be running, so don't clear state
          const errorMsg = error instanceof Error ? error.message : String(error);
          showNotification(`Failed to stop workflow: ${errorMsg}`, "error");
        }
        return;
      }

      // Serialize the current workflow
      const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
      if (!serializeWorkflow) {
        showNotification("Workflow serializer not available", "error");
        return;
      }
      const currentWorkflow = serializeWorkflow() as WorkflowGraph | null;
      if (!currentWorkflow) {
        showNotification("No workflow to run", "error");
        return;
      }

      // Route: autonomous nodes → persistent runner, otherwise → one-shot queue
      if (hasAutonomousNodes(currentWorkflow)) {
        // Autonomous mode — persistent runner with status polling
        try {
          const response = await fetch(`${apiBaseUrl}/api/v1/workflow/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflow: currentWorkflow,
              options: {
                user_id: address?.toLowerCase() || "anonymous",
              },
            }),
          });

          if (response.ok) {
            const result = await response.json();
            setIsRunning(true);
            setRunningWorkflowId(result.workflow_id);
            lastResultsVersionRef.current = 0;

            statusPollRef.current = setInterval(async () => {
              try {
                const statusRes = await fetch(`${apiBaseUrl}/api/v1/workflow/status/${result.workflow_id}`);
                if (statusRes.ok) {
                  const status = await statusRes.json();

                  // Apply latest results first (including final results when workflow finishes)
                  if (status.results_version && status.results_version > lastResultsVersionRef.current) {
                    lastResultsVersionRef.current = status.results_version;
                    if (status.latest_results?.results) {
                      const graph = (window as any).__obeliskGraph;
                      if (graph) {
                        console.log("[Runner] Applying new results to graph, version:", status.results_version);
                        updateNodeOutputs(graph, status.latest_results.results, status.latest_results.executed_nodes);
                      }
                    }
                  }

                  // Then check if the workflow has stopped
                  if (status.state !== "running") {
                    clearRunnerState();
                    return;
                  }
                }
              } catch {
                // Ignore polling errors
              }
            }, 1000);
          } else {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.detail || `Server returned ${response.status}`;
            showNotification(`Failed to start workflow: ${errorMsg}`, "error");
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          showNotification(`Failed to start workflow: ${errorMsg}`, "error");
          clearRunnerState();
        }
      } else {
        // One-shot mode — execute once via queue
        await executeOnce();
      }
    } finally {
      setIsRunPending(false);
    }
  };

  /** Download a workflow object as a JSON file */
  const downloadWorkflow = (wf: WorkflowGraph) => {
    const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wf.name || "workflow"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    // Manually serialize current workflow from canvas
    const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
    if (serializeWorkflow) {
      const currentWorkflow = serializeWorkflow();
      if (currentWorkflow) {
        if (onSave) {
          onSave(currentWorkflow);
        }
        downloadWorkflow(currentWorkflow);
      }
    } else if (onSave && workflow) {
      // Fallback to prop workflow if serialize function not available
      onSave(workflow);
      downloadWorkflow(workflow);
    }
  };

  const handleLoad = () => {
    if (onLoad) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const workflow = JSON.parse(event.target?.result as string);
              onLoad(workflow);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              console.error("Failed to load workflow:", error);
              showNotification(`Failed to load workflow: ${msg}`, "error");
            }
          };
          reader.onerror = () => {
            console.error("Failed to read workflow file");
            showNotification("Failed to read workflow file", "error");
          };
          reader.readAsText(file);
        }
      };
      input.click();
    }
  };

  // Cleanup status polling on unmount
  useEffect(() => {
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, []);

  // Button style helpers
  const secondaryButtonStyle = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    background: "var(--color-button-secondary-bg)",
    color: "var(--color-button-secondary-text)",
    border: "1px solid var(--color-button-secondary-border)",
    borderRadius: "4px",
    fontFamily: "var(--font-body)",
    fontSize: "0.875rem",
    cursor: "pointer",
    transition: "all 0.2s ease",
    width: isMobile ? "100%" : "auto",
    justifyContent: isMobile ? "flex-start" : "center",
  } as React.CSSProperties;

  const mobileMenuStyle = {
    position: "absolute" as const,
    top: "100%",
    left: 0,
    right: 0,
    background: "rgba(15, 20, 25, 0.98)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "1rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
    zIndex: 100,
    animation: "slideDown 0.2s ease",
  };

  // Render menu items (reusable for both desktop and mobile)
  const renderLeftButtons = () => (
    <>
      {/* Templates dropdown */}
      <div ref={templatesRef} style={{ position: "relative" }}>
        <button
          onClick={() => setIsTemplatesOpen(!isTemplatesOpen)}
          style={{
            ...secondaryButtonStyle,
            background: isTemplatesOpen ? "rgba(212, 175, 55, 0.12)" : secondaryButtonStyle.background,
            color: isTemplatesOpen ? "var(--color-primary)" : secondaryButtonStyle.color,
            borderColor: isTemplatesOpen ? "rgba(212, 175, 55, 0.25)" : undefined,
          }}
        >
          <TemplatesIcon />
          <span>Templates</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              marginLeft: "0.125rem",
              transition: "transform 0.2s ease",
              transform: isTemplatesOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <path d="M2 3.5L5 6.5L8 3.5" />
          </svg>
        </button>

        {isTemplatesOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: "260px",
              background: "rgba(15, 20, 25, 0.98)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "0.375rem",
              zIndex: 200,
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
              animation: "slideDown 0.15s ease",
            }}
          >
            {WORKFLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "0.125rem",
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  background: "transparent",
                  color: "var(--color-text-primary)",
                  border: "none",
                  borderRadius: "4px",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(212, 175, 55, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ fontWeight: 500 }}>{template.name}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted)",
                    lineHeight: 1.3,
                  }}
                >
                  {template.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => { handleSave(); setIsMobileMenuOpen(false); }}
        disabled={!workflow}
        style={{
          ...secondaryButtonStyle,
          cursor: workflow ? "pointer" : "not-allowed",
          opacity: workflow ? 1 : 0.5,
        }}
      >
        <SaveIcon />
        <span>Save</span>
      </button>

      <button
        onClick={() => { handleLoad(); setIsMobileMenuOpen(false); }}
        style={secondaryButtonStyle}
      >
        <LoadIcon />
        <span>Load</span>
      </button>

      <a
        href="/deployments"
        onClick={() => setIsMobileMenuOpen(false)}
        style={{
          ...secondaryButtonStyle,
          textDecoration: "none",
        }}
      >
        <AgentsIcon />
        <span>Agents</span>
      </a>
    </>
  );

  const renderRightButtons = () => (
    <>
      <button
        onClick={handleDeployClick}
        disabled={!workflow}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem",
          background: "rgba(46, 204, 113, 0.08)",
          color: "#2ecc71",
          border: "1px solid rgba(46, 204, 113, 0.25)",
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: workflow ? "pointer" : "not-allowed",
          transition: "all 0.2s ease",
          boxShadow: "0 2px 6px rgba(46, 204, 113, 0.15)",
          opacity: workflow ? 1 : 0.5,
          width: isMobile ? "100%" : "auto",
          justifyContent: isMobile ? "flex-start" : "center",
        }}
        title={!isConnected ? "Connect wallet to deploy" : "Deploy workflow as persistent agent"}
      >
        <DeployIcon />
        <span>Deploy</span>
      </button>

      <button
        onClick={() => { handleRun(); setIsMobileMenuOpen(false); }}
        disabled={isExecuting || isRunPending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1.25rem",
          background: isRunning
            ? "rgba(231, 76, 60, 0.08)"
            : (isExecuting || isRunPending)
              ? "var(--color-button-secondary-bg)"
              : "rgba(212, 175, 55, 0.08)",
          color: isRunning
            ? "#e74c3c"
            : (isExecuting || isRunPending)
              ? "var(--color-text-muted)"
              : "var(--color-primary)",
          border: `1px solid ${
            isRunning
              ? "rgba(231, 76, 60, 0.25)"
              : (isExecuting || isRunPending)
                ? "var(--color-border-primary)"
                : "rgba(212, 175, 55, 0.25)"
          }`,
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: (isExecuting || isRunPending) ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          boxShadow: isRunning
            ? "0 2px 6px rgba(231, 76, 60, 0.15)"
            : (isExecuting || isRunPending)
              ? "none"
              : "0 2px 6px rgba(212, 175, 55, 0.15)",
          opacity: (isExecuting || isRunPending) ? 0.5 : 1,
          width: isMobile ? "100%" : "auto",
          justifyContent: isMobile ? "flex-start" : "center",
        }}
        title={isRunning ? "Stop workflow" : isExecuting ? "Executing..." : "Run workflow"}
      >
        {isRunning ? <StopIcon /> : <PlayIcon />}
        <span>{isRunning ? "Stop" : isExecuting ? "Executing..." : "Run"}</span>
      </button>
    </>
  );

  return (
    <>
      {/* CSS for animation */}
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <div
        className="toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.5rem 1rem",
          background: "rgba(15, 20, 25, 0.15)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          zIndex: 10,
          position: "relative",
        }}
      >
        {/* Mobile: Hamburger menu */}
        {isMobile ? (
          <>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.5rem",
                background: isMobileMenuOpen ? "rgba(212, 175, 55, 0.15)" : "transparent",
                color: isMobileMenuOpen ? "var(--color-primary)" : "var(--color-text-primary)",
                border: "1px solid transparent",
                borderRadius: "4px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              aria-label="Toggle menu"
            >
              <HamburgerIcon isOpen={isMobileMenuOpen} />
            </button>

            {/* Mobile logo/title */}
            <span style={{
              fontFamily: "var(--font-display)",
              fontSize: "1rem",
              color: "var(--color-primary)",
              letterSpacing: "0.05em",
            }}>
              OBELISK
            </span>

            {/* Quick action button on mobile */}
            <button
              onClick={() => { handleRun(); }}
              disabled={isExecuting || isRunPending}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.5rem 0.75rem",
                background: isRunning
                  ? "rgba(231, 76, 60, 0.15)"
                  : (isExecuting || isRunPending)
                    ? "var(--color-button-secondary-bg)"
                    : "rgba(212, 175, 55, 0.15)",
                color: isRunning
                  ? "#e74c3c"
                  : (isExecuting || isRunPending)
                    ? "var(--color-text-muted)"
                    : "var(--color-primary)",
                border: `1px solid ${
                  isRunning
                    ? "rgba(231, 76, 60, 0.3)"
                    : (isExecuting || isRunPending)
                      ? "var(--color-border-primary)"
                      : "rgba(212, 175, 55, 0.3)"
                }`,
                borderRadius: "4px",
                cursor: (isExecuting || isRunPending) ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                opacity: (isExecuting || isRunPending) ? 0.5 : 1,
              }}
              title={isRunning ? "Stop workflow" : "Run workflow"}
            >
              {isRunning ? <StopIcon /> : <PlayIcon />}
            </button>
          </>
        ) : (
          /* Desktop: Full toolbar */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {renderLeftButtons()}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {renderRightButtons()}
              {/* Wallet – always rightmost */}
              <WalletButton />
            </div>
          </>
        )}

        {/* Mobile dropdown menu */}
        {isMobile && isMobileMenuOpen && (
          <div style={mobileMenuStyle}>
            <div style={{ 
              borderBottom: "1px solid rgba(255, 255, 255, 0.1)", 
              paddingBottom: "0.75rem",
              marginBottom: "0.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}>
              {renderLeftButtons()}
            </div>
            <div style={{ 
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}>
              {renderRightButtons()}
              {/* Wallet – full-width variant for mobile */}
              <WalletButton fullWidth />
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close mobile menu */}
      {isMobile && isMobileMenuOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 5,
          }}
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Deploy Modal */}
      <DeployModal
        isOpen={showDeployModal}
        onClose={() => setShowDeployModal(false)}
        onDeploy={handleDeploy}
        workflowName={workflow?.name}
        walletAddress={address}
        workflow={workflow as Record<string, unknown> | undefined}
      />

    </>
  );
}

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
import DeployModal from "./DeployModal";
import WalletButton from "./WalletButton";
import { useNotifications } from "./Notification";

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
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const lastResultsVersionRef = useRef<number>(0);
  const { showNotification, NotificationProvider } = useNotifications();

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

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      // Call the execute handler from window (exposed by Canvas)
      const executeHandler = (window as any).__obeliskExecute;
      if (executeHandler) {
        await executeHandler();
      } else if (onExecute) {
        // Pass getGraph function if available
        const getGraph = () => (window as any).__obeliskGraph;
        await onExecute(getGraph);
      }
    } finally {
      setIsExecuting(false);
    }
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
        // Download as JSON file
        const blob = new Blob([JSON.stringify(currentWorkflow, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${currentWorkflow.name || "workflow"}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } else if (onSave && workflow) {
      // Fallback to prop workflow if serialize function not available
      onSave(workflow);
      const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflow.name || "workflow"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
              // Pass the parsed workflow to the parent component
              if (onLoad) {
                onLoad(workflow);
              }
            } catch (error) {
              console.error("Failed to load workflow:", error);
            }
          };
          reader.onerror = () => {
            console.error("Failed to read workflow file");
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

  const handleRunToggle = async () => {
    if (isRunning && runningWorkflowId) {
      // Stop the workflow
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/workflow/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow_id: runningWorkflowId }),
        });
        
        if (response.ok) {
          setIsRunning(false);
          setRunningWorkflowId(null);
          if (statusPollRef.current) {
            clearInterval(statusPollRef.current);
            statusPollRef.current = null;
          }
        } else {
          // Server returned error - refresh UI state
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.detail || `Server returned ${response.status}`;
          showNotification(`Failed to stop workflow: ${errorMsg}`, "error");
          // Resync UI state by checking actual server status
          try {
            const statusRes = await fetch(`${apiBaseUrl}/api/v1/workflow/status/${runningWorkflowId}`);
            if (statusRes.ok) {
              const status = await statusRes.json();
              setIsRunning(status.state === "running");
            } else {
              // Workflow not found, assume it's stopped
              setIsRunning(false);
              setRunningWorkflowId(null);
            }
          } catch {
            // Can't reach server, reset UI
            setIsRunning(false);
            setRunningWorkflowId(null);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        showNotification(`Failed to stop workflow: ${errorMsg}`, "error");
        // Resync UI state - assume stopped if we can't reach server
        setIsRunning(false);
        setRunningWorkflowId(null);
        if (statusPollRef.current) {
          clearInterval(statusPollRef.current);
          statusPollRef.current = null;
        }
      }
    } else {
      // Start the workflow
      const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
      if (!serializeWorkflow) {
        console.error("Workflow serializer not available");
        return;
      }
      
      const currentWorkflow = serializeWorkflow();
      if (!currentWorkflow) {
        console.error("No workflow to run");
        return;
      }
      
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
          
          // Reset results version tracking
          lastResultsVersionRef.current = 0;
          
          // Start polling for status and results
          statusPollRef.current = setInterval(async () => {
            try {
              const statusRes = await fetch(`${apiBaseUrl}/api/v1/workflow/status/${result.workflow_id}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                
                // Check if workflow stopped
                if (status.state !== "running") {
                  setIsRunning(false);
                  setRunningWorkflowId(null);
                  if (statusPollRef.current) {
                    clearInterval(statusPollRef.current);
                    statusPollRef.current = null;
                  }
                  return;
                }
                
                // Check if there are new results to apply
                if (status.results_version && status.results_version > lastResultsVersionRef.current) {
                  lastResultsVersionRef.current = status.results_version;
                  
                  // Apply results to the graph
                  if (status.latest_results?.results) {
                    const graph = (window as any).__obeliskGraph;
                    if (graph) {
                      console.log("[Scheduler] Applying new results to graph, version:", status.results_version);
                      updateNodeOutputs(graph, status.latest_results.results, status.latest_results.executed_nodes);
                    }
                  }
                }
              }
            } catch {
              // Ignore polling errors
            }
          }, 1000); // Poll more frequently for smoother updates
        } else {
          // Server returned error - show to user
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.detail || `Server returned ${response.status}`;
          showNotification(`Failed to start workflow: ${errorMsg}`, "error");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        showNotification(`Failed to start workflow: ${errorMsg}`, "error");
        // Clean up state on error
        setIsRunning(false);
        setRunningWorkflowId(null);
        if (statusPollRef.current) {
          clearInterval(statusPollRef.current);
          statusPollRef.current = null;
        }
      }
    }
  };

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
      {/* Wallet Button */}
      <WalletButton fullWidth={isMobile} />

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
        onClick={() => { handleRunToggle(); setIsMobileMenuOpen(false); }}
        disabled={isExecuting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem",
          background: isRunning ? "rgba(231, 76, 60, 0.08)" : "rgba(155, 89, 182, 0.08)",
          color: isRunning ? "#e74c3c" : "#9b59b6",
          border: `1px solid ${isRunning ? "rgba(231, 76, 60, 0.25)" : "rgba(155, 89, 182, 0.25)"}`,
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: isExecuting ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          boxShadow: isRunning ? "0 2px 6px rgba(231, 76, 60, 0.15)" : "0 2px 6px rgba(155, 89, 182, 0.15)",
          opacity: isExecuting ? 0.5 : 1,
          width: isMobile ? "100%" : "auto",
          justifyContent: isMobile ? "flex-start" : "center",
        }}
        title={isRunning ? "Stop autonomous execution" : "Start autonomous execution"}
      >
        {isRunning ? <StopIcon /> : <PlayIcon />}
        <span>{isRunning ? "Stop" : "Run"}</span>
      </button>

      <button
        onClick={() => { handleExecute(); setIsMobileMenuOpen(false); }}
        disabled={isExecuting || isRunning}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1.25rem",
          background: isExecuting || isRunning ? "var(--color-button-secondary-bg)" : "rgba(212, 175, 55, 0.08)",
          color: isExecuting || isRunning ? "var(--color-text-muted)" : "var(--color-primary)",
          border: `1px solid ${isExecuting || isRunning ? "var(--color-border-primary)" : "rgba(212, 175, 55, 0.25)"}`,
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: isExecuting || isRunning ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          boxShadow: isExecuting || isRunning ? "none" : "0 2px 6px rgba(212, 175, 55, 0.15)",
          opacity: isRunning ? 0.5 : 1,
          width: isMobile ? "100%" : "auto",
          justifyContent: isMobile ? "flex-start" : "center",
        }}
        title="Execute workflow once"
      >
        <PlayIcon />
        <span>{isExecuting ? "Executing..." : "Queue Prompt"}</span>
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
              onClick={() => { handleExecute(); }}
              disabled={isExecuting || isRunning}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.5rem 0.75rem",
                background: isExecuting || isRunning ? "var(--color-button-secondary-bg)" : "rgba(212, 175, 55, 0.15)",
                color: isExecuting || isRunning ? "var(--color-text-muted)" : "var(--color-primary)",
                border: `1px solid ${isExecuting || isRunning ? "var(--color-border-primary)" : "rgba(212, 175, 55, 0.3)"}`,
                borderRadius: "4px",
                cursor: isExecuting || isRunning ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                opacity: isRunning ? 0.5 : 1,
              }}
              title="Execute workflow once"
            >
              <PlayIcon />
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
      />

      {/* Notifications */}
      <NotificationProvider />
    </>
  );
}

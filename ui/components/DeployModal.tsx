"use client";

import { useState, useEffect } from "react";

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (name: string, envVars: Record<string, string>) => Promise<void>;
  workflowName?: string;
}

export default function DeployModal({ isOpen, onClose, onDeploy, workflowName }: DeployModalProps) {
  const [name, setName] = useState(workflowName || "My Agent");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" }
  ]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal is opened to ensure fresh state
  useEffect(() => {
    if (isOpen) {
      setName(workflowName ?? "My Agent");
      setEnvVars([{ key: "", value: "" }]);
      setError(null);
      setIsDeploying(false);
    }
  }, [isOpen, workflowName]);

  if (!isOpen) return null;

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvVarChange = (index: number, field: "key" | "value", value: string) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    setError(null);

    try {
      // Convert env vars array to object, filtering empty keys
      const envVarsObj: Record<string, string> = {};
      for (const { key, value } of envVars) {
        if (key.trim()) {
          envVarsObj[key.trim()] = value;
        }
      }

      await onDeploy(name, envVarsObj);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
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
        zIndex: 1000,
      }}
      onClick={() => !isDeploying && onClose()}
    >
      <div
        style={{
          background: "var(--color-bg-secondary, #1a1a2e)",
          borderRadius: "8px",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "500px",
          maxHeight: "80vh",
          overflow: "auto",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem 0", color: "var(--color-text-primary, #fff)" }}>
          Deploy Agent
        </h2>

        <p style={{ color: "var(--color-text-muted, #888)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          Deploy this workflow as a persistent Docker container that runs autonomously.
        </p>

        {/* Agent Name */}
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-primary, #fff)" }}>
            Agent Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "4px",
              color: "var(--color-text-primary, #fff)",
              fontSize: "0.9rem",
            }}
          />
        </div>

        {/* Environment Variables */}
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--color-text-primary, #fff)" }}>
            Environment Variables (optional)
          </label>
          <p style={{ color: "var(--color-text-muted, #666)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Add API keys or secrets needed by your workflow nodes
          </p>
          
          {envVars.map((envVar, index) => (
            <div key={index} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input
                type="text"
                value={envVar.key}
                onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                placeholder="KEY"
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "4px",
                  color: "var(--color-text-primary, #fff)",
                  fontSize: "0.85rem",
                  fontFamily: "monospace",
                }}
              />
              <input
                type="password"
                value={envVar.value}
                onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                placeholder="value"
                style={{
                  flex: 2,
                  padding: "0.5rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "4px",
                  color: "var(--color-text-primary, #fff)",
                  fontSize: "0.85rem",
                }}
              />
              <button
                onClick={() => handleRemoveEnvVar(index)}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "rgba(231, 76, 60, 0.1)",
                  border: "1px solid rgba(231, 76, 60, 0.3)",
                  borderRadius: "4px",
                  color: "#e74c3c",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          ))}
          
          <button
            onClick={handleAddEnvVar}
            style={{
              padding: "0.5rem 1rem",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px dashed rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              color: "var(--color-text-muted, #888)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            + Add Variable
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            padding: "0.75rem",
            background: "rgba(231, 76, 60, 0.1)",
            border: "1px solid rgba(231, 76, 60, 0.3)",
            borderRadius: "4px",
            color: "#e74c3c",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={isDeploying}
            style={{
              padding: "0.75rem 1.5rem",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              color: "var(--color-text-primary, #fff)",
              cursor: isDeploying ? "not-allowed" : "pointer",
              opacity: isDeploying ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDeploy}
            disabled={isDeploying || !name.trim()}
            style={{
              padding: "0.75rem 1.5rem",
              background: "rgba(46, 204, 113, 0.15)",
              border: "1px solid rgba(46, 204, 113, 0.4)",
              borderRadius: "4px",
              color: "#2ecc71",
              cursor: isDeploying || !name.trim() ? "not-allowed" : "pointer",
              fontWeight: 500,
              opacity: isDeploying || !name.trim() ? 0.5 : 1,
            }}
          >
            {isDeploying ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}

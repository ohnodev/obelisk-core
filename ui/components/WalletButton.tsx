"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useChainId, useSwitchChain, useDisconnect } from "wagmi";
import { base } from "viem/chains";
import { formatAddress } from "@/lib/wallet";
import "./WalletButton.css";

interface WalletButtonProps {
  /** Render as a full-width button (for mobile menus) */
  fullWidth?: boolean;
}

export default function WalletButton({ fullWidth }: WalletButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [mounted, setMounted] = useState(false);

  const { connectWallet } = usePrivy();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();

  const isOnBase = chainId === base.id;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Give wallet connection check time to complete
  useEffect(() => {
    const maxTimer = setTimeout(() => setIsInitializing(false), 2000);

    if (address) {
      setIsInitializing(false);
      return () => clearTimeout(maxTimer);
    }

    if (isConnected !== undefined) {
      const stateCheck = setTimeout(() => setIsInitializing(false), 300);
      return () => {
        clearTimeout(maxTimer);
        clearTimeout(stateCheck);
      };
    }

    return () => clearTimeout(maxTimer);
  }, [isConnected, address]);

  const handleConnect = () => {
    setIsModalOpen(false);
    setTimeout(() => connectWallet(), 100);
  };

  const handleDisconnect = () => {
    disconnect();
    setIsModalOpen(false);
  };

  const handleSwitchChain = async () => {
    try {
      await switchChain({ chainId: base.id });
    } catch (err) {
      console.error("Failed to switch chain:", err);
    }
  };

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Close modal on escape
  useEffect(() => {
    if (!isModalOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsModalOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isModalOpen]);

  const buttonStyle = fullWidth
    ? { width: "100%", justifyContent: "flex-start" as const }
    : {};

  // Loading state
  if (isInitializing && !address) {
    return (
      <button className="wallet-btn wallet-btn-loading" disabled style={buttonStyle}>
        <span className="wallet-dot wallet-dot-disconnected" />
        <span>···</span>
      </button>
    );
  }

  // Connected state
  if (isConnected && address) {
    return (
      <>
        <button
          className="wallet-btn wallet-btn-connected"
          onClick={() => setIsModalOpen(true)}
          style={buttonStyle}
        >
          <span className="wallet-dot wallet-dot-connected" />
          <span>{formatAddress(address)}</span>
        </button>

        {mounted && isModalOpen && createPortal(
          <div className="wallet-modal-overlay" onClick={() => setIsModalOpen(false)}>
            <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
              <div className="wallet-modal-header">
                <h3 className="wallet-modal-title">Wallet</h3>
                <button className="wallet-modal-close" onClick={() => setIsModalOpen(false)}>
                  ×
                </button>
              </div>

              <div className="wallet-modal-body">
                {/* Address */}
                <div className="wallet-modal-section">
                  <div className="wallet-modal-label">Address</div>
                  <div className="wallet-address-row">
                    <span className="wallet-address-text">{formatAddress(address)}</span>
                    <button className="wallet-copy-btn" onClick={handleCopy} title={copied ? "Copied!" : "Copy"}>
                      {copied ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Chain */}
                <div className="wallet-modal-section">
                  <div className="wallet-modal-label">Network</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className={`wallet-chain-badge ${isOnBase ? "chain-ok" : "chain-wrong"}`}>
                      {isOnBase ? "Base" : "⚠ Wrong Chain"}
                    </span>
                    {!isOnBase && (
                      <button className="wallet-switch-btn" onClick={handleSwitchChain}>
                        Switch to Base
                      </button>
                    )}
                  </div>
                </div>

                <div className="wallet-modal-divider" />

                {/* Disconnect */}
                <div className="wallet-modal-section">
                  <button className="wallet-disconnect-btn" onClick={handleDisconnect}>
                    Disconnect Wallet
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  // Disconnected state
  return (
    <button className="wallet-btn" onClick={handleConnect} style={buttonStyle}>
      <span className="wallet-dot wallet-dot-disconnected" />
      <span>Connect Wallet</span>
    </button>
  );
}

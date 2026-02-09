"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useChainId, useSwitchChain, useDisconnect } from "wagmi";
import { base } from "viem/chains";
import { formatAddress } from "@/lib/wallet";
import "./WalletButton.css";

interface WalletButtonProps {
  /** Render as a full-width row (for mobile hamburger menu) */
  fullWidth?: boolean;
}

export default function WalletButton({ fullWidth }: WalletButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);

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
    setChainError(null);
    try {
      await switchChain({ chainId: base.id });
    } catch (err: any) {
      console.error("Failed to switch chain:", err);
      const msg =
        err?.shortMessage || err?.message || "Unknown error switching chain";
      setChainError(msg);
      setTimeout(() => setChainError(null), 6000);
    }
  };

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy address to clipboard:", err);
      try {
        const ta = document.createElement("textarea");
        ta.value = address;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopied(false);
      }
    }
  };

  // Close modal on escape
  useEffect(() => {
    if (!isModalOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsModalOpen(false);
    };
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isModalOpen]);

  // -- Wallet SVG icon (simple wallet outline) --
  const WalletIcon = () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
    </svg>
  );

  // -- Render the trigger button (desktop square or mobile full-width) --
  const renderButton = () => {
    // Full-width variant for mobile hamburger menu
    if (fullWidth) {
      return (
        <button
          className="wallet-btn-mobile"
          onClick={() => setIsModalOpen(true)}
        >
          <WalletIcon />
          <span>
            {isInitializing && !address
              ? "···"
              : isConnected && address
                ? formatAddress(address)
                : "Wallet"}
          </span>
        </button>
      );
    }

    // Square icon button for desktop toolbar
    // Loading
    if (isInitializing && !address) {
      return (
        <button
          className="wallet-icon-btn wallet-icon-btn-loading"
          disabled
          title="Loading wallet…"
        >
          <WalletIcon />
        </button>
      );
    }

    // Connected – show green ring + icon
    if (isConnected && address) {
      return (
        <button
          className="wallet-icon-btn wallet-icon-btn-connected"
          onClick={() => setIsModalOpen(true)}
          title={address}
        >
          <span className="wallet-icon-dot" />
          <WalletIcon />
        </button>
      );
    }

    // Disconnected
    return (
      <button
        className="wallet-icon-btn"
        onClick={() => setIsModalOpen(true)}
        title="Wallet"
      >
        <WalletIcon />
      </button>
    );
  };

  // -- Disconnected modal: navigation + connect --
  const renderDisconnectedModal = () => (
    <div className="wallet-modal-overlay" onClick={() => setIsModalOpen(false)}>
      <div className="wallet-modal wallet-modal-menu" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-modal-header">
          <h3 className="wallet-modal-title">Menu</h3>
          <button className="wallet-modal-close" onClick={() => setIsModalOpen(false)}>
            ×
          </button>
        </div>

        <div className="wallet-modal-body">
          {/* Navigation */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Navigate</div>
            <div className="wallet-modal-links">
              <a href="/" className="wallet-modal-link" onClick={() => setIsModalOpen(false)}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <span>Home</span>
              </a>
              <a href="/deployments" className="wallet-modal-link" onClick={() => setIsModalOpen(false)}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Agents</span>
              </a>
            </div>
          </div>

          <div className="wallet-modal-divider" />

          {/* Resources */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Resources</div>
            <div className="wallet-modal-links">
              <a href="https://docs.theobelisk.ai" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <span>Documentation</span>
              </a>
              <a href="https://github.com/ohnodev/obelisk-core" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#d4af37" className="wallet-link-icon">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span>GitHub</span>
              </a>
            </div>
          </div>

          <div className="wallet-modal-divider" />

          {/* Community */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Community</div>
            <div className="wallet-modal-links">
              <a href="https://t.me/theobeliskportal" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#d4af37" className="wallet-link-icon">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                <span>Telegram</span>
              </a>
              <a href="https://x.com/theobeliskai" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff" className="wallet-link-icon">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span>X (Twitter)</span>
              </a>
            </div>
          </div>

          <div className="wallet-modal-divider" />

          {/* Connect Wallet */}
          <div className="wallet-modal-section">
            <button className="wallet-connect-btn" onClick={handleConnect}>
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // -- Connected modal: wallet info + navigation + disconnect --
  const renderConnectedModal = () => (
    <div className="wallet-modal-overlay" onClick={() => setIsModalOpen(false)}>
      <div className="wallet-modal wallet-modal-menu" onClick={(e) => e.stopPropagation()}>
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
              <span className="wallet-address-text">{formatAddress(address!)}</span>
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
            <div className="wallet-chain-display">
              <span className={`wallet-chain-badge ${isOnBase ? "chain-ok" : "chain-wrong"}`}>
                {isOnBase ? "Base" : "⚠ Wrong Chain"}
              </span>
              {!isOnBase && (
                <button className="wallet-switch-btn" onClick={handleSwitchChain}>
                  Switch to Base
                </button>
              )}
            </div>
            {chainError && (
              <div className="wallet-chain-error">
                ⚠ {chainError}
              </div>
            )}
          </div>

          {/* View on BaseScan */}
          {address && (
            <div className="wallet-modal-section">
              <a
                href={`https://basescan.org/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="wallet-modal-link"
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>View on BaseScan</span>
              </a>
            </div>
          )}

          <div className="wallet-modal-divider" />

          {/* Navigation */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Navigate</div>
            <div className="wallet-modal-links">
              <a href="/" className="wallet-modal-link" onClick={() => setIsModalOpen(false)}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <span>Home</span>
              </a>
              <a href="/deployments" className="wallet-modal-link" onClick={() => setIsModalOpen(false)}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Agents</span>
              </a>
            </div>
          </div>

          <div className="wallet-modal-divider" />

          {/* Resources */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Resources</div>
            <div className="wallet-modal-links">
              <a href="https://docs.theobelisk.ai" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-link-icon">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <span>Documentation</span>
              </a>
              <a href="https://github.com/ohnodev/obelisk-core" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#d4af37" className="wallet-link-icon">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span>GitHub</span>
              </a>
            </div>
          </div>

          <div className="wallet-modal-divider" />

          {/* Community */}
          <div className="wallet-modal-section">
            <div className="wallet-modal-label">Community</div>
            <div className="wallet-modal-links">
              <a href="https://t.me/theobeliskportal" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#d4af37" className="wallet-link-icon">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                <span>Telegram</span>
              </a>
              <a href="https://x.com/theobeliskai" target="_blank" rel="noopener noreferrer" className="wallet-modal-link">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff" className="wallet-link-icon">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span>X (Twitter)</span>
              </a>
            </div>
          </div>

          {/* Disconnect */}
          <div className="wallet-modal-section">
            <button className="wallet-disconnect-btn" onClick={handleDisconnect}>
              Disconnect Wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {renderButton()}

      {mounted && isModalOpen && createPortal(
        isConnected && address ? renderConnectedModal() : renderDisconnectedModal(),
        document.body,
      )}
    </>
  );
}

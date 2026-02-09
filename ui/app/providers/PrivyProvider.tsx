'use client';

import { type ReactNode, useEffect, useState } from "react";
import { NotificationContainer } from "@/components/Notification";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "@privy-io/wagmi";
import { base } from 'viem/chains';
import { wagmiConfig } from "../config/wagmi";
import { useAccount } from 'wagmi';
import { useWallets } from '@privy-io/react-auth';

// Component to handle automatic chain switching when wallet connects
function ChainSwitcher() {
  const { isConnected } = useAccount();
  const { wallets } = useWallets();

  useEffect(() => {
    if (!isConnected || !wallets.length) return;

    const checkAndSwitchChain = async () => {
      const wallet = wallets[0];
      if (!wallet) return;

      try {
        let provider: any = null;
        if (typeof (wallet as any).getEthereumProvider === 'function') {
          provider = await (wallet as any).getEthereumProvider();
        }
        
        if (!provider && typeof window !== 'undefined') {
          provider = (window as any).ethereum || (window as any).phantom?.ethereum;
        }

        if (!provider) return;

        const chainIdHex = await provider.request({ method: 'eth_chainId' });
        const actualChainId = parseInt(chainIdHex, 16);

        if (actualChainId !== base.id) {
          console.log(`🔄 Auto-switching wallet from chain ${actualChainId} to Base (${base.id})...`);
          if (typeof wallet.switchChain === 'function') {
            await wallet.switchChain(base.id);
            console.log('✅ Successfully auto-switched to Base');
          }
        }
      } catch (error: any) {
        console.error('Failed to auto-switch chain:', error);
      }
    };

    checkAndSwitchChain();
  }, [isConnected, wallets]);

  return null;
}

// Privy App ID — must be set via NEXT_PUBLIC_PRIVY_APP_ID env var.
// Fail fast if missing so misconfigurations are caught immediately.
const PRIVY_APP_ID: string = (() => {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is not set. " +
      "Add it to your .env.local or hosting environment."
    );
  }
  return id;
})();

// Privy configuration - wallet-only login on Base
const privyConfig: PrivyClientConfig = {
  loginMethods: ['wallet'] as ('wallet')[],
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'off' as const,
    },
  },
  appearance: {
    theme: 'dark' as const,
    accentColor: '#d4af37' as `#${string}`,
    showWalletLoginFirst: true,
  },
  defaultChain: base,
  supportedChains: [base],
};

type Props = { children: ReactNode };

function OnchainProviders({ children }: Props) {
  // Create QueryClient inside state so each SSR request gets its own instance
  // (avoids cross-request state leakage) while the browser reuses a single one.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={privyConfig}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <ChainSwitcher />
          {children}
          <NotificationContainer />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export { OnchainProviders as PrivyProvider };

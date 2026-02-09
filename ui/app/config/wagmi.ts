// Import createConfig from @privy-io/wagmi (not wagmi) for Privy integration
// Privy handles all wallet connections, so we don't need wagmi connectors
import { createConfig } from '@privy-io/wagmi';
import { base } from 'viem/chains';
import { http } from 'wagmi';

export const wagmiConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http('https://mainnet.base.org'),
  },
});

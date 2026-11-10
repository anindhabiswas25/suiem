"use client";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import { NetworkBadge } from "@suiem/ui";
import { useConnection, useSwitchChain } from "wagmi";

/** Shows the wallet's current network with its badge and lets the user switch (4663 ↔ 46630). */
export function NetworkSwitcher() {
  const { chainId, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  if (!isConnected) return <span className="s-small s-muted">No wallet connected</span>;
  const network =
    chainId === robinhoodMainnet.id
      ? "mainnet"
      : chainId === robinhoodTestnet.id
        ? "testnet"
        : null;
  return (
    <div className="s-row s-small">
      {network ? (
        <NetworkBadge network={network} />
      ) : (
        <span className="s-badge" data-tone="neutral">
          Unsupported network
        </span>
      )}
      <label className="s-row" style={{ gap: 6 }}>
        <span className="s-muted">Network</span>
        <select
          className="s-select"
          value={chainId ?? ""}
          disabled={switchChain.isPending}
          onChange={(e) => switchChain.mutate({ chainId: Number(e.target.value) as 4663 | 46630 })}
          aria-label="Switch network"
        >
          {!network ? <option value="">Choose…</option> : null}
          <option value={robinhoodMainnet.id}>Mainnet (4663) · $WIF</option>
          <option value={robinhoodTestnet.id}>Testnet (46630) · no value</option>
        </select>
      </label>
      {switchChain.error ? (
        <span role="alert" className="s-small">
          Switch failed: {switchChain.error.message.split("\n")[0]}
        </span>
      ) : null}
    </div>
  );
}

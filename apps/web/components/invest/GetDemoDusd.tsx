"use client";
import { encodeClaim } from "@suiem/chain/write";
import { explorerTx } from "@suiem/shared/invest";
import { Alert, Button } from "@suiem/ui";
import { useState } from "react";
import { getAddress } from "viem";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { wagmiConfig } from "../../lib/wagmi";

/** Calls DemoUSD.claim() from the user's own wallet (1,000 dUSD, once per 24 h). Testnet only. */
export function GetDemoDusd({ dusd, faucetUrl }: { dusd: string; faucetUrl: string }) {
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [state, setState] = useState<{
    busy: boolean;
    msg: string | null;
    tone: "warning" | "negative";
    link?: string;
  }>({ busy: false, msg: null, tone: "warning" });
  async function claim() {
    setState({ busy: true, msg: null, tone: "warning" });
    try {
      if (!account.address) await connectAsync({ connector: connectors[0]! });
      if (account.chainId !== 46630) await switchChainAsync({ chainId: 46630 });
      const hash = await sendTransactionAsync({
        to: getAddress(dusd),
        data: encodeClaim(),
        chainId: 46630,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: 46630 });
      setState({
        busy: false,
        msg: "1,000 dUSD claimed (testnet, no value).",
        tone: "warning",
        link: explorerTx(hash),
      });
    } catch (e) {
      const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
      setState({
        busy: false,
        msg: /ClaimCooldown/.test(m) ? "You can claim dUSD once every 24 hours." : m,
        tone: "negative",
      });
    }
  }
  return (
    <div className="s-stack" style={{ gap: 6 }}>
      <div className="s-row">
        <Button onClick={() => void claim()} loading={state.busy} data-testid="get-dusd">
          Get test dUSD
        </Button>
        <a href={faucetUrl} target="_blank" rel="noreferrer noopener" className="s-small">
          Need testnet ETH for gas? Official testnet faucet
        </a>
      </div>
      {state.msg ? (
        <Alert tone={state.tone}>
          {state.msg}{" "}
          {state.link ? (
            <a href={state.link} target="_blank" rel="noreferrer noopener">
              view on explorer
            </a>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}

// Deploys SuiemElections to Robinhood Chain MAINNET (4663, REAL value) and writes the manifest.
//   pnpm contracts:deploy:mainnet --estimate        # no transaction: checks + gas estimate only
//   CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL pnpm contracts:deploy:mainnet --verify
//   tsx scripts/deploy-mainnet.ts --rpc http://127.0.0.1:8547 --out deployments/anvil-4663.json  (fork rehearsal)
// Guards: chain 4663 only; PO approval token; $WIF identity; deployer ETH >= 2 × estimated cost.
// The key comes from MAINNET_DEPLOYER_PRIVATE_KEY and is never printed. The RPC URL (secret) is
// never printed and never written to the manifest; child-process output is redacted.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createSuiemPublicClient,
  redactRpcSecrets,
  registerSecretRpcUrl,
  rpcLabel,
} from "@suiem/chain";
import { assertWifIdentity } from "@suiem/chain/elections";
import { WIF } from "@suiem/config/chains";
import { encodeAbiParameters, formatEther, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(import.meta.dirname, "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rpc = arg("--rpc") ?? process.env.MAINNET_RPC_URL;
if (!rpc) throw new Error("MAINNET_RPC_URL must be set in .env (or pass --rpc for a local fork)");
registerSecretRpcUrl(rpc);
const outFile = join(CONTRACTS, arg("--out") ?? "deployments/4663.json");
const estimateOnly = process.argv.includes("--estimate");
const verify = process.argv.includes("--verify");
const say = (s: string) => console.log(redactRpcSecrets(s));

const key = process.env.MAINNET_DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("MAINNET_DEPLOYER_PRIVATE_KEY must be set in .env");
const deployer = privateKeyToAccount(key).address;

const client = createSuiemPublicClient({ chainId: 4663, rpcUrl: rpc, maxRps: 10 });
const chainId = await client.getChainId();
if (chainId !== 4663) throw new Error(`Refusing: RPC chain is ${chainId}, expected 4663 (mainnet)`);
await assertWifIdentity(client);

const artifact = JSON.parse(
  readFileSync(join(CONTRACTS, "out", "SuiemElections.sol", "SuiemElections.json"), "utf8"),
) as { bytecode: { object: Hex } };
const ctorArgs = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }],
  [deployer, WIF.address],
);
const deployGas = await client.estimateGas({
  account: deployer,
  data: `${artifact.bytecode.object}${ctorArgs.slice(2)}` as Hex,
});
// createElection measured on the fork rehearsal (~95k gas cold); 3 elections budgeted at 120k each.
const createGas = 3n * 120_000n;
const gasPrice = await client.getGasPrice();
const cost = (deployGas + createGas) * gasPrice;
const balance = await client.getBalance({ address: deployer });
const sourceHash = keccak256(toHex(readFileSync(join(CONTRACTS, "src", "SuiemElections.sol"))));
say(
  [
    `chain 4663 (${rpcLabel(rpc)} RPC) · $WIF identity OK (${WIF.address}, 18 decimals, symbol WIF)`,
    `deployer ${deployer} · balance ${formatEther(balance)} ETH`,
    `SuiemElections.sol keccak256 ${sourceHash}`,
    `gas: deploy ${deployGas} + 3 × createElection ≤ ${createGas} at ${gasPrice} wei/gas`,
    `estimated cost ${formatEther(cost)} ETH · required balance (2×) ${formatEther(2n * cost)} ETH`,
  ].join("\n"),
);
if (estimateOnly) process.exit(0);

if (process.env.CONFIRM_MAINNET_DEPLOY !== "I_HAVE_PO_APPROVAL") {
  say("STOP: mainnet deploy needs explicit PO approval: CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL");
  process.exit(3);
}
if (balance < 2n * cost) {
  say(`STOP: fund ${deployer} with at least ${formatEther(2n * cost - balance)} more ETH on 4663`);
  process.exit(2);
}

const forge = spawnSync(
  "forge",
  ["script", "script/DeployMainnet.s.sol:DeployMainnet", "--broadcast", "--slow"],
  {
    cwd: CONTRACTS,
    encoding: "utf8",
    // The RPC goes through the environment (not argv) and output is redacted before printing.
    env: {
      ...process.env,
      ETH_RPC_URL: rpc,
      FOUNDRY_ETH_RPC_URL: rpc,
      MAINNET_DEPLOYER_PRIVATE_KEY: key,
    },
  },
);
say(`${forge.stdout ?? ""}${forge.stderr ?? ""}`);
if (forge.status !== 0) throw new Error("forge script failed (output above, redacted)");

interface BroadcastTx {
  hash: Hex;
  transactionType: string;
  contractName: string | null;
  contractAddress: string | null;
  arguments: string[] | null;
}
const run = JSON.parse(
  readFileSync(
    join(CONTRACTS, "broadcast", "DeployMainnet.s.sol", "4663", "run-latest.json"),
    "utf8",
  ),
) as {
  transactions: BroadcastTx[];
  receipts: { blockNumber: string; status: string; transactionHash: Hex }[];
};
if (run.receipts.some((r) => r.status !== "0x1"))
  throw new Error("the deployment transaction reverted");
const create = run.transactions.find((t) => t.contractName === "SuiemElections")!;
const elections = create.contractAddress!;
const owner = await client.readContract({
  address: elections as Hex,
  abi: [
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [{ type: "address" }],
      stateMutability: "view",
    },
  ],
  functionName: "owner",
});
const wifOnchain = await client.readContract({
  address: elections as Hex,
  abi: [
    {
      type: "function",
      name: "WIF",
      inputs: [],
      outputs: [{ type: "address" }],
      stateMutability: "view",
    },
  ],
  functionName: "WIF",
});
if (wifOnchain !== WIF.address) throw new Error(`deployed contract WIF() is ${wifOnchain}`);

const foundry = readFileSync(join(CONTRACTS, "foundry.toml"), "utf8");
const manifest = {
  chainId: 4663 as const,
  elections,
  wif: WIF.address,
  owner,
  deployer,
  block: Number(run.receipts[0]!.blockNumber),
  transactions: run.transactions.map((t, i) => ({
    contract: t.contractName ?? "call",
    address: t.contractAddress,
    hash: t.hash,
    block: Number(run.receipts[i]!.blockNumber),
  })),
  constructorArgs: [deployer, WIF.address],
  sourceHash,
  gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
  compiler: `solc ${/solc_version\s*=\s*"([^"]+)"/.exec(foundry)?.[1]} (optimizer 200 runs)`,
  deployedAt: new Date().toISOString(),
  explorer: "https://robinhoodchain.blockscout.com",
  verified: false,
};

if (verify) {
  const v = spawnSync(
    "forge",
    [
      "verify-contract",
      elections,
      "src/SuiemElections.sol:SuiemElections",
      "--chain-id",
      "4663",
      "--verifier",
      "blockscout",
      "--verifier-url",
      `${manifest.explorer}/api/`,
      "--constructor-args",
      ctorArgs,
      "--watch",
    ],
    {
      cwd: CONTRACTS,
      encoding: "utf8",
      env: { ...process.env, ETH_RPC_URL: rpc, FOUNDRY_ETH_RPC_URL: rpc },
    },
  );
  say(`${v.stdout ?? ""}${v.stderr ?? ""}`);
  manifest.verified = v.status === 0;
}
mkdirSync(dirname(outFile), { recursive: true });
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (text.includes(rpc) || /quiknode\.pro/i.test(text))
  throw new Error("manifest would contain the RPC URL");
writeFileSync(outFile, text);
say(`wrote ${outFile}: SuiemElections ${elections} (owner ${owner}) · tx ${create.hash}`);

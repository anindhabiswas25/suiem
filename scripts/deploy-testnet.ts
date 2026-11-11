// Deploys SuiemDemoVenue + dUSD + 5 demo tokens to Robinhood Chain TESTNET (46630) and writes the
// manifest. Usage:
//   pnpm contracts:deploy:testnet                     # real testnet, writes deployments/46630.json
//   tsx scripts/deploy-testnet.ts --rpc http://127.0.0.1:8545 --out deployments/anvil-46630.json
// Keys come from the environment only (never argv, never printed). Chain 46630 only.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(import.meta.dirname, "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rpc =
  arg("--rpc") ?? process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const outFile = join(CONTRACTS, arg("--out") ?? "deployments/46630.json");
const verify = process.argv.includes("--verify");
const deployerKey = process.env.TESTNET_DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
const signerKey = process.env.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
if (!deployerKey || !signerKey)
  throw new Error("TESTNET_DEPLOYER_PRIVATE_KEY and QUOTE_SIGNER_PRIVATE_KEY must be set in .env");

const rpcCall = async (method: string, params: unknown[] = []) => {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await r.json()) as { result: string }).result;
};
const chainId = Number(await rpcCall("eth_chainId"));
if (chainId !== 46630)
  throw new Error(`Refusing to deploy: RPC chain is ${chainId}, expected 46630 (testnet only)`);
const deployer = privateKeyToAccount(deployerKey).address;
const quoteSigner = privateKeyToAccount(signerKey).address;
const balance = BigInt(await rpcCall("eth_getBalance", [deployer, "latest"]));
console.log(
  `chain 46630 · deployer ${deployer} · balance ${balance} wei · quote signer ${quoteSigner}`,
);
if (balance === 0n) {
  console.log(
    `STOP: the deployer has no testnet ETH. Fund ${deployer} at https://faucet.testnet.chain.robinhood.com`,
  );
  process.exit(2);
}

execFileSync(
  "forge",
  ["script", "script/DeployTestnet.s.sol:DeployTestnet", "--rpc-url", rpc, "--broadcast", "--slow"],
  {
    cwd: CONTRACTS,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      TESTNET_DEPLOYER_PRIVATE_KEY: deployerKey,
      QUOTE_SIGNER_ADDRESS: quoteSigner,
    },
  },
);

interface BroadcastTx {
  hash: string;
  transactionType: string;
  contractName: string | null;
  contractAddress: string | null;
  arguments: string[] | null;
  function: string | null;
}
const run = JSON.parse(
  readFileSync(
    join(CONTRACTS, "broadcast", "DeployTestnet.s.sol", "46630", "run-latest.json"),
    "utf8",
  ),
) as {
  transactions: BroadcastTx[];
  receipts: { blockNumber: string; status: string }[];
};
if (run.receipts.some((r) => r.status !== "0x1"))
  throw new Error("a deployment transaction reverted");
const creates = run.transactions.filter((t) => t.transactionType === "CREATE");
const venue = creates.find((t) => t.contractName === "SuiemDemoVenue")!.contractAddress!;
const dusd = creates.find((t) => t.contractName === "DemoUSD")!.contractAddress!;
const tokens = Object.fromEntries(
  creates
    .filter((t) => t.contractName === "DemoStockToken")
    .map((t) => [t.arguments![0]!.replace(/"/g, ""), t.contractAddress!]),
);
const foundry = readFileSync(join(CONTRACTS, "foundry.toml"), "utf8");
const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const manifest = {
  chainId: 46630 as const,
  venue,
  dusd,
  tokens,
  deployer,
  quoteSigner,
  block: Math.min(...run.receipts.map((r) => Number(r.blockNumber))),
  transactions: run.transactions.map((t) => ({
    contract:
      t.transactionType === "CREATE"
        ? (t.contractName ?? "create")
        : `${t.contractName ?? "call"}.${(t.function ?? "call").split("(")[0]}`,
    address: t.contractAddress,
    hash: t.hash,
    arguments: t.arguments,
  })),
  gitSha,
  compiler: `solc ${/solc_version\s*=\s*"([^"]+)"/.exec(foundry)?.[1]} (optimizer 200 runs)`,
  deployedAt: new Date().toISOString(),
  explorer: "https://explorer.testnet.chain.robinhood.com",
  verified: {} as Record<string, boolean>,
};

if (verify) {
  // Blockscout verification (best effort; the deployment is valid either way).
  const targets: [string, string, string][] = [
    [venue, "src/SuiemDemoVenue.sol:SuiemDemoVenue", "SuiemDemoVenue"],
    [dusd, "src/DemoUSD.sol:DemoUSD", "DemoUSD"],
    ...Object.entries(tokens).map(
      ([t, a]) => [a, "src/DemoStockToken.sol:DemoStockToken", `d${t}`] as [string, string, string],
    ),
  ];
  for (const [address, contract, label] of targets) {
    try {
      execFileSync(
        "forge",
        [
          "verify-contract",
          address,
          contract,
          "--chain-id",
          "46630",
          "--verifier",
          "blockscout",
          "--verifier-url",
          `${manifest.explorer}/api/`,
          "--guess-constructor-args",
          "--rpc-url",
          rpc,
          "--watch",
        ],
        {
          cwd: CONTRACTS,
          stdio: ["ignore", "ignore", "inherit"],
        },
      );
      manifest.verified[label] = true;
    } catch {
      manifest.verified[label] = false;
    }
  }
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outFile}: venue ${venue}, dUSD ${dusd}, tokens ${JSON.stringify(tokens)}`);

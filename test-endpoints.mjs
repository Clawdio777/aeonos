/**
 * AEONOS multi-endpoint quality test (x402 v2)
 * Usage: TEST_PRIVATE_KEY=0x... node test-endpoints.mjs
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

const BASE = "https://aeonos.basechainlabs.com";
const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY;

const ENDPOINTS = [
  { path: "/api/agent",    price: 0.05, query: "What schema markup should a SaaS company add to get cited in Google AI Overviews?" },
  { path: "/api/schema",   price: 0.50, query: "Generate JSON-LD schema for drinklongbrew.com — premium freeze-dried cold brew coffee, pre-order sales" },
  { path: "/api/llms-txt", price: 0.50, query: "Write a complete llms.txt for drinklongbrew.com — premium Australian freeze-dried cold brew coffee brand" },
  { path: "/api/progress", price: 1.50, query: "Generate an AEO Four Layers progress report for drinklongbrew.com" },
  { path: "/api/audit",    price: 2.50, query: "Run a full AEO/GEO audit on drinklongbrew.com and give me a P1/P2/P3 action plan" },
];

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

async function getUSDCBalance(address) {
  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const data = "0x70a08231000000000000000000000000" + address.slice(2).toLowerCase();
  const res = await fetch("https://mainnet.base.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDC, data }, "latest"] }),
  });
  const json = await res.json();
  return Number(BigInt(json.result)) / 1e6;
}

async function main() {
  if (!PRIVATE_KEY) {
    console.error(C.red("TEST_PRIVATE_KEY env var required"));
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http("https://mainnet.base.org");

  const walletClient = createWalletClient({ account, chain: base, transport });
  const publicClient = createPublicClient({ chain: base, transport });

  // viem WalletClient stores address on .account.address — toClientEvmSigner needs .address
  const signerInput = {
    address: account.address,
    signTypedData: (msg) => walletClient.signTypedData(msg),
    readContract: (args) => publicClient.readContract(args),
  };
  const signer = toClientEvmSigner(signerInput, publicClient);
  const evmScheme = new ExactEvmScheme(signer);

  const client = x402Client.fromConfig({
    schemes: [{ x402Version: 2, network: "eip155:8453", client: evmScheme }],
  });

  const x402Fetch = wrapFetchWithPayment(fetch, client);

  const balance = await getUSDCBalance(account.address);
  console.log(C.bold(`\n=== AEONOS Endpoint Quality Tests ===`));
  console.log(`Wallet: ${account.address}`);
  console.log(`Balance: ${C.yellow(balance.toFixed(6) + " USDC")}\n`);

  const totalNeeded = ENDPOINTS.reduce((s, e) => s + e.price, 0);
  if (balance < totalNeeded) {
    console.log(C.yellow(`⚠  Need ${totalNeeded.toFixed(2)} USDC to test all. Have ${balance.toFixed(6)} USDC.`));
    console.log(C.yellow(`   Skipping endpoints that exceed remaining balance.\n`));
  }

  let remaining = balance;

  for (const ep of ENDPOINTS) {
    console.log(C.bold(`\n── ${ep.path} (${ep.price} USDC) ──`));

    if (ep.price > remaining + 0.001) {
      console.log(C.red(`  ✗ Skipped — insufficient balance (~${remaining.toFixed(3)} USDC remaining)`));
      continue;
    }

    try {
      console.log(C.cyan(`  → ${ep.query.slice(0, 80)}...`));
      const start = Date.now();

      const res = await x402Fetch(`${BASE}${ep.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: ep.query }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      remaining -= ep.price;

      const text = data?.artifact?.parts?.[0]?.text ?? data?.response ?? JSON.stringify(data);
      console.log(C.green(`  ✓ Success (${elapsed}s)`));
      console.log(C.green(`  Preview (first 500 chars):`));
      console.log("  " + text.slice(0, 500).replace(/\n/g, "\n  ") + (text.length > 500 ? "..." : ""));
    } catch (e) {
      console.log(C.red(`  ✗ Error: ${e.message.slice(0, 300)}`));
    }
  }

  const finalBalance = await getUSDCBalance(account.address);
  console.log(C.bold(`\n=== Done — Final balance: ${finalBalance.toFixed(6)} USDC ===\n`));
}

main().catch(e => { console.error(C.red(`Fatal: ${e.message}`)); process.exit(1); });

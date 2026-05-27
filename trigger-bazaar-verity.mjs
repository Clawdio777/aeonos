/**
 * Trigger agentic.market Bazaar indexing for VERITY
 * x402 v2 protocol — uses @x402/fetch + @x402/evm/exact/client
 *
 * Usage: OWNER_PRIVATE_KEY=0x... node trigger-bazaar-verity.mjs
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const AGENT_URL = "https://verity.basechainlabs.com/api/verify";

async function main() {
  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) { console.error("OWNER_PRIVATE_KEY required"); process.exit(1); }

  const evmSigner = privateKeyToAccount(pk);
  console.log(`\nWallet: ${evmSigner.address}`);
  console.log(`Hitting: ${AGENT_URL}\n`);

  // Build x402 v2 client
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(evmSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // Step 1 — probe to confirm 402 with extensions.bazaar
  console.log("Step 1: Probing for 402...");
  const probe = await fetch(AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(`Probe status: ${probe.status}`);
  if (probe.status === 402) {
    const paymentRequired = await probe.json();
    console.log("x402Version:", paymentRequired.x402Version);
    console.log("extensions.bazaar present:", !!paymentRequired?.extensions?.bazaar);
    console.log("resource.url:", paymentRequired?.resource?.url);
  } else {
    console.error(`Expected 402, got ${probe.status} — check server`);
    process.exit(1);
  }

  // Step 2 — make paid request (0.10 USDC)
  console.log("\nStep 2: Sending paid request...");
  const paid = await fetchWithPayment(AGENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: "VERITY is the first structured fact-checking MCP agent on Smithery.",
      caller_id: "bazaar-index-trigger",
    }),
  });

  console.log(`\nResponse status: ${paid.status}`);

  if (paid.ok) {
    const result = await paid.json();
    console.log("✅ Payment accepted — Bazaar indexing should trigger within 5–10 minutes");
    console.log("\nVerdict preview:");
    const text = result?.verdict ?? result?.result ?? JSON.stringify(result).slice(0, 300);
    console.log(text);
  } else {
    const err = await paid.text();
    console.error(`❌ Payment failed: ${paid.status} ${err}`);
  }

  console.log(`\nCheck listing: https://agentic.market/?search=verity`);
  console.log(`(Allow 5–15 mins for indexing)\n`);
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });

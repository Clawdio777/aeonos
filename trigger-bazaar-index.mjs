/**
 * Trigger agentic.market Bazaar indexing for AEONOS
 * x402 v2 protocol — uses @x402/fetch + @x402/evm/exact/client
 *
 * Bazaar lists a resource once a payment for it settles through the CDP facilitator,
 * so this sends one real paid request per endpoint (caller_id "bazaar-index-trigger").
 *
 * Usage:
 *   node trigger-bazaar-index.mjs --dry-run schema llms-txt share-of-voice   (probe only, no payment)
 *   OWNER_PRIVATE_KEY=0x... node trigger-bazaar-index.mjs schema llms-txt share-of-voice
 *   (no endpoint names = agent, as before)
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL  = "https://aeonos.basechainlabs.com/api";
const CALLER_ID = "bazaar-index-trigger";

// Real, non-placeholder bodies (AEONOS's own site) so the result is genuine output
const ENDPOINTS = {
  "agent":          { query: "Give me 3 quick AEO wins for a SaaS landing page." },
  "schema":         { query: "Generate Schema.org JSON-LD for https://aeonos.basechainlabs.com, an AI search visibility audit agent sold per call over x402." },
  "llms-txt":       { query: "Generate an llms.txt file for https://aeonos.basechainlabs.com, an AI search visibility audit agent sold per call over x402." },
  "share-of-voice": { brands: ["aeonos.basechainlabs.com", "agentstools.dev"], queries: ["best AI search visibility audit API for agents"] },
};

async function main() {
  const args   = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const names  = args.filter(a => a !== "--dry-run");
  const targets = names.length ? names : ["agent"];

  const unknown = targets.filter(n => !ENDPOINTS[n]);
  if (unknown.length) { console.error(`Unknown endpoint(s): ${unknown.join(", ")}. Known: ${Object.keys(ENDPOINTS).join(", ")}`); process.exit(1); }

  // Step 1 — probe every target first; abort before paying anything if one is not ready
  console.log("Step 1: Probing for 402 with extensions.bazaar...");
  for (const name of targets) {
    const probe = await fetch(`${BASE_URL}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const paymentRequired = probe.status === 402 ? await probe.json() : null;
    const hasBazaar = !!paymentRequired?.extensions?.bazaar;
    console.log(`  ${name}: status ${probe.status}, x402Version ${paymentRequired?.x402Version}, bazaar ${hasBazaar}, resource ${paymentRequired?.resource?.url}`);
    if (!hasBazaar) { console.error(`❌ ${name} is not returning a 402 with extensions.bazaar, nothing paid`); process.exit(1); }
  }
  if (dryRun) { console.log("\nDry run: all probes OK, no payment sent.\n"); return; }

  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) { console.error("OWNER_PRIVATE_KEY required"); process.exit(1); }

  const evmSigner = privateKeyToAccount(pk);
  console.log(`\nWallet: ${evmSigner.address}`);

  // Build x402 v2 client — registers exact EVM scheme for Base mainnet
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(evmSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // Step 2 — one paid request per endpoint (x402 v2 auto-pays on 402)
  console.log("\nStep 2: Sending paid requests (auto-payment via @x402/fetch)...");
  for (const name of targets) {
    const paid = await fetchWithPayment(`${BASE_URL}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ENDPOINTS[name], caller_id: CALLER_ID }),
    });

    console.log(`\n${name}: response status ${paid.status}`);

    if (paid.ok) {
      const result = await paid.json();
      console.log("✅ Payment accepted — CDP Facilitator processed this payment");
      const text = result?.artifact?.parts?.[0]?.text ?? result?.result ?? JSON.stringify(result);
      console.log(text.slice(0, 300) + "...");
    } else {
      const err = await paid.text();
      console.error(`❌ Payment failed: ${paid.status} ${err}`);
    }
  }

  console.log(`\nCheck listing: https://agentic.market/?search=aeonos`);
  console.log(`Validate endpoint: https://agentic.market/validate`);
  console.log(`(Allow 5–15 mins for indexing)\n`);
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });

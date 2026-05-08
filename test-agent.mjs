/**
 * AEONOS Test Agent
 * Tests the full A2A + x402 payment flow against the live endpoint.
 *
 * Free tier test (no wallet needed):
 *   node test-agent.mjs
 *
 * Full payment flow test (needs USDC on Base):
 *   TEST_PRIVATE_KEY=0x... node test-agent.mjs --paid
 */

import { createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";

const AGENT_URL = "https://aeonos-fawn.vercel.app/api/agent";
const PAID_MODE = process.argv.includes("--paid");

const COLOURS = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function log(label, msg) {
  console.log(`${COLOURS.cyan(`[${label}]`)} ${msg}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function queryAgent(query, walletClient) {
  log("→ QUERY", `"${query}"`);

  const headers = { "Content-Type": "application/json" };

  // Build initial request
  const body = JSON.stringify({ query });
  let res = await fetch(AGENT_URL, { method: "POST", headers, body });

  // Handle 402 payment required
  if (res.status === 402) {
    const responseBody = await res.json();
    log("402", COLOURS.yellow("Payment required — handling x402..."));

    if (!walletClient) {
      console.log(COLOURS.yellow("\n  ⚡ 402 response received (correct format):"));
      console.log(JSON.stringify(responseBody, null, 2));
      console.log(COLOURS.yellow("\n  Run with --paid and TEST_PRIVATE_KEY to complete payment.\n"));
      return null;
    }

    // Select the payment requirement
    const paymentReqs = selectPaymentRequirements(responseBody.accepts, "base", "exact");
    if (!paymentReqs) throw new Error("No compatible payment requirement found");

    log("💳", `Paying ${formatUnits(BigInt(paymentReqs.maxAmountRequired), 6)} USDC → ${paymentReqs.payTo}`);

    // Sign and create payment header
    const paymentHeader = await createPaymentHeader(walletClient, responseBody.x402Version, paymentReqs);
    log("✍️", "Payment signed");

    // Retry with payment header
    res = await fetch(AGENT_URL, {
      method: "POST",
      headers: { ...headers, "X-Payment": paymentHeader },
      body,
    });

    if (res.status === 402) {
      const err = await res.json();
      throw new Error(`Payment rejected: ${err.error}`);
    }

    const settlementHeader = res.headers.get("X-Payment-Response");
    if (settlementHeader) {
      const settlement = JSON.parse(Buffer.from(settlementHeader, "base64").toString());
      log("✅", COLOURS.green(`Payment settled — tx: ${settlement.transaction}`));
    }
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.result?.artifact?.parts?.[0]?.text
    ?? data?.artifact?.parts?.[0]?.text
    ?? data?.response
    ?? JSON.stringify(data);

  return text;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(COLOURS.bold("\n=== AEONOS Test Agent ===\n"));

  // 1. Agent card
  log("CARD", "Fetching agent card...");
  const card = await (await fetch(AGENT_URL)).json();
  console.log(COLOURS.green(`  ✓ Name: ${card.name}`));
  console.log(COLOURS.green(`  ✓ agentURI: ${card.agentURI}`));
  console.log(COLOURS.green(`  ✓ supportedTrust: ${JSON.stringify(card.supportedTrust)}`));
  console.log(COLOURS.green(`  ✓ protocols: ${card.protocols?.join(", ")}`));
  console.log(COLOURS.green(`  ✓ Free tier: ${card.pricing?.free_tier}`));
  console.log();

  // 2. Set up wallet if paid mode
  let walletClient = null;
  if (PAID_MODE) {
    const pk = process.env.TEST_PRIVATE_KEY;
    if (!pk) {
      console.error(COLOURS.red("TEST_PRIVATE_KEY env var required for --paid mode"));
      process.exit(1);
    }
    const account = privateKeyToAccount(pk);
    walletClient = createWalletClient({ account, chain: base, transport: http() });
    log("WALLET", COLOURS.green(`Paying from: ${account.address}`));
    console.log();
  }

  // 3. Free tier queries
  const freeQueries = [
    "What is AEO and how does it differ from traditional SEO?",
    "What schema markup should a local medical clinic add to rank in AI search?",
    "Give me a checklist to get my business cited in Google AI Overviews.",
  ];

  for (let i = 0; i < freeQueries.length; i++) {
    console.log(COLOURS.bold(`\n── Query ${i + 1} of ${freeQueries.length} (free tier) ──`));
    try {
      const answer = await queryAgent(freeQueries[i], null);
      if (answer) {
        console.log(COLOURS.green("\n  Response (first 300 chars):"));
        console.log("  " + answer.slice(0, 300) + (answer.length > 300 ? "..." : ""));
      }
    } catch (e) {
      console.log(COLOURS.red(`  Error: ${e.message}`));
    }
  }

  // 4. Paid query (triggers 402)
  console.log(COLOURS.bold("\n── Query 4 (paid tier) ──"));
  try {
    const answer = await queryAgent(
      "Run an AEO audit on sherbournehouse.com.au and give me the top 3 improvements.",
      walletClient
    );
    if (answer) {
      console.log(COLOURS.green("\n  Response (first 300 chars):"));
      console.log("  " + answer.slice(0, 300) + (answer.length > 300 ? "..." : ""));
    }
  } catch (e) {
    console.log(COLOURS.red(`  Error: ${e.message}`));
  }

  console.log(COLOURS.bold("\n=== Test complete ===\n"));
}

main().catch((e) => {
  console.error(COLOURS.red(`\nFatal: ${e.message}`));
  process.exit(1);
});

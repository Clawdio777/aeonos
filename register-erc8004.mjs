/**
 * AEONOS — ERC-8004 Independent Registration (2-step)
 *
 * Correct protocol per ERC-8004 spec:
 *   Step 1: register() → get agentId (mints token to your wallet)
 *   Step 2: build card with correct agentId → upload to IPFS → setAgentURI()
 *
 * This gives you a token you own with:
 *   - content-addressed IPFS URI (fixes WA040)
 *   - supportedTrust: ["reputation","crypto-economic"] (fixes IA008)
 *   - correct agentId in registrations field (spec compliant)
 *
 * Usage:
 *   OWNER_PRIVATE_KEY=0x... PINATA_JWT=eyJ... node register-erc8004.mjs
 */

import { createWalletClient, createPublicClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI",  type: "string"  },
    ],
    outputs: [],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from",    type: "address", indexed: true },
      { name: "to",      type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
];

// ── Agent card template ────────────────────────────────────────────────────

function buildAgentCard(agentId) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "AEONOS",
    description:
      "Persistent AEO/GEO memory agent. Other agents pay per query or subscribe for ongoing citation grounding and business positioning. AEONOS helps any agent get its operator's site cited by ChatGPT, Perplexity, Claude, and Google AI Overviews — audits, schema markup, llms.txt, keyword strategy, and progress reports. No hallucination — grounded in live research and real campaign data. Protocols: A2A + x402.",
    image:
      "https://acpcdn-prod.s3.ap-southeast-1.amazonaws.com/agents/a7725c83-5d9a-417a-8d38-c76b63ddbc73.webp",
    services: [
      {
        name: "A2A",
        endpoint: "https://aeonos-fawn.vercel.app/api/agent",
        version: "1.0.0",
      },
      {
        name: "web",
        endpoint:
          "https://app.virtuals.io/acp/agent/019dfbe3-94e6-73f8-9acb-641c5c8d8d9c",
      },
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentId: Number(agentId),
        agentRegistry: `eip155:8453:${REGISTRY}`,
      },
    ],
    supportedTrust: ["reputation", "crypto-economic"],
  };
}

// ── IPFS upload via Pinata ─────────────────────────────────────────────────

async function uploadToIPFS(card, jwt) {
  const body = JSON.stringify({
    pinataContent: card,
    pinataMetadata: { name: `aeonos-erc8004-${card.registrations[0].agentId}.json` },
    pinataOptions: { cidVersion: 1 },
  });

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinata upload failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.IpfsHash;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pk  = process.env.OWNER_PRIVATE_KEY;
  const jwt = process.env.PINATA_JWT;

  if (!pk) {
    console.error("OWNER_PRIVATE_KEY env var required");
    process.exit(1);
  }
  if (!jwt) {
    console.error("PINATA_JWT env var required");
    process.exit(1);
  }

  const account      = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  console.log(`\nWallet:   ${account.address}`);
  console.log(`Registry: ${REGISTRY}\n`);

  // Check ETH balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`ETH balance: ${(Number(balance) / 1e18).toFixed(6)} ETH`);
  if (balance < 500000000000000n) {
    console.error("❌ Low balance — need at least 0.0005 ETH for gas (two txs)");
    process.exit(1);
  }
  console.log("✅ Sufficient balance\n");

  // ── Step 1: register() — mint token, get agentId ──────────────────────

  console.log("── Step 1: Minting ERC-8004 token (no URI yet)...");
  const hash1 = await walletClient.writeContract({
    address: REGISTRY,
    abi: ABI,
    functionName: "register",
    args: [],
  });
  console.log(`   tx: ${hash1}`);

  console.log("   Waiting for confirmation...");
  const receipt1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
  console.log(`   ✅ Confirmed in block ${receipt1.blockNumber}`);

  // Extract agentId from Transfer event (mint = from 0x0)
  let agentId;
  for (const log of receipt1.logs) {
    try {
      const event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (
        event.eventName === "Transfer" &&
        event.args.from === "0x0000000000000000000000000000000000000000"
      ) {
        agentId = event.args.tokenId;
        break;
      }
    } catch {}
  }

  if (agentId === undefined) {
    console.error("❌ Could not parse agentId from tx logs");
    console.error(`   Check manually: https://basescan.org/tx/${hash1}`);
    process.exit(1);
  }
  console.log(`\n   🎉 New Agent ID: ${agentId}\n`);

  // ── Step 2: build card → upload to IPFS → setAgentURI ─────────────────

  console.log("── Step 2: Building agent card with correct agentId...");
  const card = buildAgentCard(agentId);
  console.log(`   registrations[0].agentId = ${card.registrations[0].agentId}`);
  console.log(`   supportedTrust = ${JSON.stringify(card.supportedTrust)}`);

  console.log("\n   Uploading to IPFS via Pinata...");
  const cid = await uploadToIPFS(card, jwt);
  const ipfsURI = `ipfs://${cid}`;
  console.log(`   ✅ Pinned: ${ipfsURI}`);
  console.log(`   Gateway:  https://gateway.pinata.cloud/ipfs/${cid}\n`);

  console.log("   Calling setAgentURI...");
  const hash2 = await walletClient.writeContract({
    address: REGISTRY,
    abi: ABI,
    functionName: "setAgentURI",
    args: [agentId, ipfsURI],
  });
  console.log(`   tx: ${hash2}`);

  console.log("   Waiting for confirmation...");
  const receipt2 = await publicClient.waitForTransactionReceipt({ hash: hash2 });
  console.log(`   ✅ Confirmed in block ${receipt2.blockNumber}`);

  // ── Verify ─────────────────────────────────────────────────────────────

  const finalURI = await publicClient.readContract({
    address: REGISTRY, abi: ABI, functionName: "tokenURI", args: [agentId],
  });
  const owner = await publicClient.readContract({
    address: REGISTRY, abi: ABI, functionName: "ownerOf", args: [agentId],
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ AEONOS registered on ERC-8004`);
  console.log(`   Agent ID:  ${agentId}`);
  console.log(`   Owner:     ${owner}`);
  console.log(`   Token URI: ${finalURI}`);
  console.log(`\n   8004scan:  https://8004scan.io/agents/base/${agentId}?tab=metadata`);
  console.log(`   BaseScan:  https://basescan.org/token/${REGISTRY}?a=${agentId}`);
  console.log(`${"─".repeat(60)}\n`);
  console.log(`Next: update api/agent.ts — set agentId to ${agentId}`);
}

main().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  process.exit(1);
});

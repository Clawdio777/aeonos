/**
 * AEONOS — Update ERC-8004 on-chain agentURI
 *
 * Calls setAgentURI(46926, "ipfs://...") on the ERC-8004 Identity Registry
 * on Base to point AEONOS to the new IPFS-hosted metadata card.
 *
 * Fixes:
 *   WA040 — replaces mutable HTTPS URI with content-addressed IPFS URI
 *   IA008 — new card includes supportedTrust: ["reputation", "crypto-economic"]
 *   Also adds A2A service endpoint so agents can discover our real API
 *
 * Usage:
 *   OWNER_PRIVATE_KEY=0x... node update-erc8004-uri.mjs
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY  = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_ID  = 47096n; // owned by 0x4a0D792185d05330C8506B29cC9335fb7820B958
const IPFS_URI  = "ipfs://bafkreibeuaqom35wkxpj6th4zpunx64gti4sfitfj4btetfn3fadncdds4"; // IA024 fix — A2A endpoint → /.well-known/agent-card.json

const ABI = [
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI",  type: "string"  }
    ],
    outputs: []
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }]
  }
];

async function main() {
  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) {
    console.error("OWNER_PRIVATE_KEY env var required");
    console.error("Usage: OWNER_PRIVATE_KEY=0x... node update-erc8004-uri.mjs");
    process.exit(1);
  }

  const account      = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  console.log(`\nWallet:   ${account.address}`);
  console.log(`Registry: ${REGISTRY}`);
  console.log(`Agent ID: ${AGENT_ID}`);
  console.log(`New URI:  ${IPFS_URI}\n`);

  // Verify ownership
  const owner = await publicClient.readContract({
    address: REGISTRY, abi: ABI, functionName: "ownerOf", args: [AGENT_ID]
  });
  console.log(`On-chain owner: ${owner}`);
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`\n❌ Wallet ${account.address} does not own token ${AGENT_ID}`);
    console.error(`   Owner is: ${owner}`);
    process.exit(1);
  }
  console.log("✅ Ownership confirmed\n");

  // Show current URI
  const currentURI = await publicClient.readContract({
    address: REGISTRY, abi: ABI, functionName: "tokenURI", args: [AGENT_ID]
  });
  console.log(`Current URI: ${currentURI}`);
  console.log(`New URI:     ${IPFS_URI}\n`);

  // Send transaction
  console.log("Sending setAgentURI transaction...");
  const hash = await walletClient.writeContract({
    address: REGISTRY, abi: ABI, functionName: "setAgentURI",
    args: [AGENT_ID, IPFS_URI]
  });
  console.log(`✅ Transaction sent: ${hash}`);
  console.log(`   View on BaseScan: https://basescan.org/tx/${hash}\n`);

  // Wait for confirmation
  console.log("Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`\nDone! 8004scan will re-index within a few minutes.`);
  console.log(`Check: https://8004scan.io/agents/base/46926?tab=metadata\n`);
}

main().catch(e => {
  console.error(`\nFatal: ${e.message}`);
  process.exit(1);
});

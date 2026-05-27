/**
 * AEONOS — ERC-8004 metadata update
 * Updates the agent card URLs to aeonos.basechainlabs.com
 *
 * Usage:
 *   OWNER_PRIVATE_KEY=0x... PINATA_JWT=eyJ... node update-erc8004.mjs
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_ID  = 47096n;

const ABI = [
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
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
];

const card = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "AEONOS",
  description:
    "Persistent AEO/GEO memory agent. Other agents pay per query or subscribe for ongoing citation grounding and business positioning. AEONOS helps any agent get its operator's site cited by ChatGPT, Perplexity, Claude, and Google AI Overviews — audits, schema markup, llms.txt, keyword strategy, and progress reports. No hallucination — grounded in live research and real campaign data. Protocols: A2A + x402.",
  image:
    "https://aeonos.basechainlabs.com/aeonos-logo.jpg",
  services: [
    {
      name: "A2A",
      endpoint: "https://aeonos.basechainlabs.com/api/agent",
      version: "1.0.0",
    },
    {
      name: "web",
      endpoint: "https://aeonos.basechainlabs.com",
    },
  ],
  x402Support: true,
  active: true,
  registrations: [
    {
      agentId: Number(AGENT_ID),
      agentRegistry: `eip155:8453:${REGISTRY}`,
    },
  ],
  supportedTrust: ["reputation", "crypto-economic"],
};

async function uploadToIPFS(jwt) {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: card,
      pinataMetadata: { name: `aeonos-erc8004-${Number(AGENT_ID)}-v2.json` },
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!res.ok) throw new Error(`Pinata: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.IpfsHash;
}

async function main() {
  const pk  = process.env.OWNER_PRIVATE_KEY;
  const jwt = process.env.PINATA_JWT;
  if (!pk)  { console.error("OWNER_PRIVATE_KEY required"); process.exit(1); }
  if (!jwt) { console.error("PINATA_JWT required"); process.exit(1); }

  const account      = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  console.log(`\nWallet:   ${account.address}`);
  console.log(`Agent ID: ${AGENT_ID}\n`);

  console.log("Uploading updated card to IPFS...");
  const cid     = await uploadToIPFS(jwt);
  const ipfsURI = `ipfs://${cid}`;
  console.log(`✅ Pinned: ${ipfsURI}`);
  console.log(`   Gateway: https://gateway.pinata.cloud/ipfs/${cid}\n`);

  console.log("Calling setAgentURI on-chain...");
  const hash = await walletClient.writeContract({
    address: REGISTRY,
    abi: ABI,
    functionName: "setAgentURI",
    args: [AGENT_ID, ipfsURI],
  });
  console.log(`   tx: ${hash}`);

  await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ Confirmed\n");

  const finalURI = await publicClient.readContract({
    address: REGISTRY, abi: ABI, functionName: "tokenURI", args: [AGENT_ID],
  });
  console.log(`Token URI: ${finalURI}`);
  console.log(`\n8004scan: https://8004scan.io/agents/base/${AGENT_ID}`);
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });

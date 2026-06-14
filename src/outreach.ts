/**
 * outreach.ts — AEONOS distribution outreach content
 *
 * Pitch copy and target contacts for AEO tool roundup inclusion
 * and MCP directory submissions.
 */

export const AEONOS_PITCH = `Subject: Add AEONOS to your 2026 AEO tools roundup

Hi [Editor name],

I wanted to flag a gap in your 2026 AEO/GEO tools roundup: no MCP-native agents are listed.

AEONOS is the only AEO/GEO tool built as an MCP server with per-call USDC payments — no subscription, works inside Claude, Cursor, or any MCP client natively. Where every other AEO platform requires a dashboard login, AEONOS is callable programmatically by any AI agent via the Model Context Protocol, making it the first AEO tool purpose-built for the agentic web.

Key differentiators worth a line in your list:
• MCP-native: runs inside Claude/Cursor with zero setup
• Per-call USDC micropayments via x402 — no subscription lock-in
• Live citation checks across Perplexity, ChatGPT, Google AI Overviews, and Bing/Copilot
• Agent-to-agent compatible: other AI agents can invoke it autonomously

npm package: https://www.npmjs.com/package/aeonos-mcp
Homepage: https://basechainlabs.com

Happy to provide a product screenshot, demo, or a brief quote for the piece.

Best,
The AEONOS team`;

export const AEONOS_DIRECTORY_DESCRIPTION =
  "AEONOS — AEO/GEO optimisation agent. Optimise content for ChatGPT, Perplexity, Claude citations. Pay-per-call via x402 USDC on Base. No API keys required.";

export interface OutreachTarget {
  outlet: string;
  url: string;
  contactPath: string;
  notes: string;
}

export const ROUNDUP_TARGETS: OutreachTarget[] = [
  {
    outlet: "Scrunch",
    url: "https://scrunch.com",
    contactPath: "/contact",
    notes: "AEO/GEO tool coverage — request addition to 2026 AEO tools roundup",
  },
  {
    outlet: "Frase",
    url: "https://frase.io",
    contactPath: "/blog",
    notes: "Content/SEO audience — pitch as the MCP-native entry missing from their AEO list",
  },
  {
    outlet: "Writer",
    url: "https://writer.com",
    contactPath: "/blog",
    notes: "Enterprise AI writing — angle on agentic AEO for content teams",
  },
  {
    outlet: "toloka.ai",
    url: "https://toloka.ai",
    contactPath: "/blog/best-mcp-servers-for-ai-agents",
    notes: "Request AEONOS inclusion in top-20 MCP servers list — emphasise x402 pay-per-call and Base-native as unique category",
  },
  {
    outlet: "k2view",
    url: "https://k2view.com",
    contactPath: "/blog/awesome-mcp-servers",
    notes: "Request AEONOS inclusion in awesome-mcp-servers list — emphasise x402 pay-per-call and Base-native as unique category",
  },
];

export interface DirectorySubmission {
  directory: string;
  url: string;
  submissionPath: string;
  packageName?: string;
  description?: string;
  notes: string;
}

export const DIRECTORY_SUBMISSIONS: DirectorySubmission[] = [
  {
    directory: "MCP Manager",
    url: "https://mcpmanager.ai",
    submissionPath: "/submit",
    notes: "Submit aeonos-mcp npm package for MCP server directory listing",
  },
  {
    directory: "Skyvia MCP Blog",
    url: "https://skyvia.com",
    submissionPath: "/blog/best-mcp-servers",
    notes: "Request inclusion in 'Best MCP Servers' reference article",
  },
  {
    directory: "Smithery",
    url: "https://smithery.ai",
    submissionPath: "/server/new",
    packageName: "aeonos-mcp",
    description: AEONOS_DIRECTORY_DESCRIPTION,
    notes: "Submit aeonos-mcp npm package to Smithery at smithery.ai/server/new",
  },
  {
    directory: "mcpmarket.com",
    url: "https://mcpmarket.com",
    submissionPath: "/daily",
    description: AEONOS_DIRECTORY_DESCRIPTION,
    notes: "Submit to mcpmarket.com daily listing form using the standard directory description",
  },
];

export function buildOutreachReport(): string {
  const targetLines = ROUNDUP_TARGETS.map(
    (t) => `• ${t.outlet} (${t.url}${t.contactPath}) — ${t.notes}`
  ).join("\n");

  const dirLines = DIRECTORY_SUBMISSIONS.map(
    (d) =>
      `• ${d.directory} (${d.url}${d.submissionPath})${d.packageName ? ` [npm: ${d.packageName}]` : ""}${d.description ? `\n  Description: "${d.description}"` : ""} — ${d.notes}`
  ).join("\n");

  return [
    "## AEONOS Distribution Outreach Package",
    "",
    "### Blog Editor Pitch (send to Scrunch / Frase / Writer / toloka.ai / k2view)",
    "",
    AEONOS_PITCH,
    "",
    "### Roundup Targets",
    targetLines,
    "",
    "### MCP Directory Submissions",
    dirLines,
    "",
    "### Assets to attach",
    "• npm: https://www.npmjs.com/package/aeonos-mcp",
    "• Homepage: https://basechainlabs.com",
  ].join("\n");
}

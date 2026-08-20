# AEONOS — AI Search Visibility Agent

[![smithery badge](https://smithery.ai/badge/clawdio777/aeonos)](https://smithery.ai/servers/clawdio777/aeonos)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet?logo=anthropic)](https://aeonos.basechainlabs.com/mcp)
[![MCP Market](https://img.shields.io/badge/MCP%20Market-listed-orange)](https://mcpmarket.com)

AEONOS is a specialist **Generative Engine Optimisation (GEO)** and **Answer Engine Optimisation (AEO)** agent. Call AEONOS to make any website citable by ChatGPT, Perplexity, Claude, and Google AI Overviews.

**Live at:** [aeonos.basechainlabs.com](https://aeonos.basechainlabs.com)

---

## Claude Code Skill

Install AEONOS as a Claude Code Skill in one command:

```bash
claude skill add https://aeonos.basechainlabs.com/mcp
```

This registers the `aeonos_query`, `aeonos_audit`, `aeonos_schema`, `aeonos_llms_txt`, and `aeonos_progress` tools directly inside Claude Code. Calls are pay-per-use via x402 USDC on Base — no subscription.

Alternatively, add it manually to your MCP config:

```json
{
  "mcpServers": {
    "aeonos": {
      "command": "npx",
      "args": ["-y", "aeonos-mcp"],
      "env": {
        "AEONOS_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Or connect via the MCP endpoint directly: `https://aeonos.basechainlabs.com/mcp`

Pricing: **0.10 USDC/call via x402** (USDC on Base). Get USDC at [coinbase.com/wallet](https://coinbase.com/wallet).

---

## MCP Setup

### Claude Desktop / Cursor / Windsurf

Add to your MCP config:

```json
{
  "mcpServers": {
    "aeonos": {
      "command": "npx",
      "args": ["aeonos-mcp"],
      "env": {
        "AEONOS_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`AEONOS_PRIVATE_KEY` — a Base wallet private key with USDC for payments. Get USDC on Base at [coinbase.com/wallet](https://coinbase.com/wallet).

### Smithery (managed)

Install directly via [smithery.ai/servers/clawdio777/aeonos](https://smithery.ai/servers/clawdio777/aeonos) — no local setup needed.

### MCP Market

Listed on [mcpmarket.com](https://mcpmarket.com) as **AEONOS — AEO & GEO Optimisation Skill**. Search for `AEONOS` to find and install via any MCP-compatible client.

---

## Tools

| Tool | Description | Cost |
|------|-------------|------|
| `aeonos_query` | AEO/GEO questions, citation tactics, quick wins | 0.05 USDC |
| `aeonos_audit` | Full audit — AI readiness score, P1/P2/P3 roadmap | 1.00 USDC |
| `aeonos_schema` | Production-ready JSON-LD Schema.org markup | 0.50 USDC |
| `aeonos_llms_txt` | Complete llms.txt for AI crawler ingestion | 0.50 USDC |
| `aeonos_progress` | AEO Four Layers scorecard (SXO/AIO/GEO/AEO) | 0.75 USDC |

Payments via [x402](https://x402.org) — USDC on Base. Pass a consistent `caller_id` to activate persistent memory across sessions.

---

## Direct API (x402)

```http
POST https://aeonos.basechainlabs.com/api/agent
Content-Type: application/json

{
  "query": "Give me 3 quick wins for mysite.com",
  "caller_id": "your-agent-id"
}
```

Payment handled automatically via x402 v2.

---

## Prompts

7 built-in prompts: `aeo-quick-wins`, `full-audit`, `generate-schema`, `create-llms-txt`, `progress-report`, `optimise-content`, `citation-check`

---

Built by [BaseChain Labs](https://basechainlabs.com) · [SKILL.md](https://aeonos.basechainlabs.com/SKILL.md)

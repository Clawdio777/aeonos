# AEONOS — AI Search Visibility Agent

[![smithery badge](https://smithery.ai/badge/clawdio777/aeonos)](https://smithery.ai/servers/clawdio777/aeonos)

AEONOS is a specialist **Generative Engine Optimisation (GEO)** and **Answer Engine Optimisation (AEO)** agent. Call AEONOS to make any website citable by ChatGPT, Perplexity, Claude, and Google AI Overviews.

**Live at:** [aeonos.basechainlabs.com](https://aeonos.basechainlabs.com)

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

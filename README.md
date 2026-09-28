# AEONOS — AI Search Visibility Agent

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

### MCP Market

Listed on [mcpmarket.com](https://mcpmarket.com) as **AEONOS — AEO & GEO Optimisation Skill**. Search for `AEONOS` to find and install via any MCP-compatible client.

---

## Tools

| Tool | Description | Cost |
|------|-------------|------|
| `aeonos_query` | AEO/GEO questions, citation tactics, quick wins | 0.05 USDC |
| `aeonos_audit` | Full audit — AI readiness score, P1/P2/P3 roadmap | 2.50 USDC |
| `aeonos_schema` | Production-ready JSON-LD Schema.org markup | 0.50 USDC |
| `aeonos_llms_txt` | Complete llms.txt for AI crawler ingestion | 0.50 USDC |
| `aeonos_progress` | AEO Four Layers scorecard (SXO/AIO/GEO/AEO) | 1.50 USDC |

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

---

## Making changes (maintainer guide)

### Where things live

| Thing | Where |
|---|---|
| The agent's brain | `src/agent.ts` (system prompt, orchestration), `src/tools.ts` (every tool, the six-engine citation sampler, recommended/mentioned/warned stance scoring), `src/inspect.ts` (the HTML crawler: schema, E-E-A-T, llms.txt, robots), `src/costs.ts` (per-run provider costs) |
| API endpoints | one file per route under `api/`: `agent` (paid A2A entry), `audit`, `citations`, `progress`, `mcp`, `checkout`, `stripe-webhook`, `recover-key`, `share-of-voice`, `schema`, `llms-txt`, `internal`, plus the `cron-check-deps` and `daily-summary` crons |
| Payment gate | `api/_x402-gate.ts`: unpaid POSTs get HTTP 402 with the price and the Bazaar listing; GET returns the agent card |
| Public page | `public/index.html` (plain HTML). Agent card: `public/.well-known/agent.json` |
| Marketplace seller | `seller-v2.mjs` + `Dockerfile` + `railway.json`, the Virtuals ACP seller on Railway |
| Secrets | hosting environment variables only. Never in a file, never in a commit |

### How a change goes live

There is no test suite and no CI on this repo. A push to `main` is the deploy.

1. Edit, then type-check: `npx tsc --noEmit -p .`
2. Commit and push to `main`. Vercel builds and deploys production from the GitHub integration.
3. Confirm the newest production deployment carries your commit SHA and the endpoint answers: `curl -s https://aeonos.basechainlabs.com/.well-known/agent.json | head -c 300`
4. A push also redeploys the Railway seller. Confirm its log shows it connected afterwards.

Because there are no tests, prove a change on the live endpoint with a read-only call before calling it done. Never make a paid call (x402 or Stripe) just to test.

### Things that bite

- Prices live in four places that must stay in sync: `public/index.html`, the 402 body in `api/_x402-gate.ts`, the Virtuals ACP offerings, and the npm package README.
- Agentic.market's "Validate endpoint" tool: use POST. GET returns the agent card (200) by design and the validator then says "no x402 setup".
- The sampler needs credit on OpenAI and Gemini. When either runs dry that engine is reported as "not sampled", never as 0%.
- Bing and Copilot are deliberately not sampled (no reliable source). Do not add them.
- `POST /api/citations` has a downstream consumer (Pemba's measurement loop). Changing its response shape breaks that.

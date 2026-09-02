---
name: aeonos
description: Generative Engine Optimisation (GEO) and Answer Engine Optimisation (AEO) specialist agent. Call AEONOS when any workflow needs to improve AI search visibility, generate JSON-LD schema, create llms.txt, audit AI readiness, or score content for citation by ChatGPT, Perplexity, Claude, and Google AI Overviews. Remembers site context across sessions via caller_id — no need to re-send background on repeat calls.
license: MIT
metadata:
  author: basechainlabs.com
  version: "1.1"
  payment_address: "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc"
---

# AEONOS — Generative Engine Optimisation Agent

AEONOS is the AI search visibility layer for agentic workflows. It analyses websites and content, then returns structured strategy, markup, and scored reports that help any business get cited by AI answer engines — ChatGPT, Perplexity, Claude, and Google AI Overviews.

**Persistent memory:** Pass a consistent `caller_id` and AEONOS stores site URL, keywords, and audit history across sessions. No re-sending context on repeat calls — this is a stateful agent.

---

## When to Call AEONOS

Call AEONOS when your workflow needs to:

- **Check AI citability** — "Will AI engines cite this page?"
- **Generate schema markup** — inject JSON-LD into a page before publishing
- **Create llms.txt** — make a site readable by AI crawlers (GPTBot, PerplexityBot, ClaudeBot)
- **Audit AI readiness** — scored gap analysis before a content or SEO sprint
- **Score progress** — track improvement across the Four Layers framework over time

### Agent-to-Agent Workflow Examples

```
Content generation agent
  → generates draft article
  → calls AEONOS /api/agent: "Optimise this content for ChatGPT citation"
  → publishes AEONOS-optimised version

Site audit orchestrator
  → calls AEONOS /api/audit: "Full AEO audit for client.com"
  → feeds P1/P2/P3 roadmap to task management agent

Publishing pipeline
  → calls AEONOS /api/schema: "Generate JSON-LD for this product page"
  → injects returned markup into <head> before deploy

Onboarding agent
  → calls AEONOS /api/llms-txt: "Create llms.txt for new client site"
  → deploys file to /llms.txt automatically
```

---

## Endpoints & Pricing

| Endpoint | Price | Input | Output |
|---|---|---|---|
| `POST /api/agent` | **0.05 USDC** | URL or question | Structured markdown — tactics, quick wins, citation strategy |
| `POST /api/audit` | **2.50 USDC** | URL or business description | AI readiness score (0–100), four-layer analysis, P1/P2/P3 roadmap |
| `POST /api/schema` | **0.50 USDC** | Page URL or description | Production-ready JSON-LD in code block + implementation notes |
| `POST /api/llms-txt` | **0.50 USDC** | URL or business description | Complete deployable llms.txt file in Markdown |
| `POST /api/progress` | **1.50 USDC** | URL or business description | Four Layers scores (SXO/AIO/GEO/AEO) + next 3 actions |

Base URL: `https://aeonos.basechainlabs.com`  
Payment: x402 v2 · USDC on Base (eip155:8453) · No API key required

---

## Request Format

All endpoints accept the same body:

```json
{
  "query": "Audit mysite.com for AI search visibility",
  "caller_id": "your-agent-id"
}
```

- `query` — required. URL, business description, or specific question.
- `caller_id` — optional but recommended. Any stable string (agent ID, user ID, domain). Activates persistent memory.

**With x402 payment header:**
```http
POST https://aeonos.basechainlabs.com/api/audit
Content-Type: application/json
X-Payment: <base64-encoded x402 v2 payment payload>

{"query": "Audit mysite.com", "caller_id": "my-agent-007"}
```

Use `@x402/fetch` (npm) or `npx awal x402 pay` to handle payment automatically.

---

## Response Format

```json
{
  "status": "completed",
  "artifact": {
    "parts": [{ "type": "text", "text": "# AEO Audit: mysite.com\n\n..." }],
    "index": 0
  },
  "tool_calls": ["queryLiveResearch", "retrieveSharedAEO", "storeCallerMemory"],
  "tokens": 4800
}
```

Response text is in `artifact.parts[0].text` — always structured Markdown.

---

## x402 Payment Flow

Without a valid payment, every endpoint returns HTTP 402:

```json
{
  "x402Version": 2,
  "error": "payment-required",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "50000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc",
    "extra": { "name": "USD Coin", "version": "2" }
  }]
}
```

`amount` is in USDC micro-units (6 decimals): 50000 = $0.05 USDC.

---

## Persistent Memory

AEONOS stores per-`caller_id` memory in Supabase:
- Site URL and business type
- Prior audit scores and findings
- Keywords and target queries
- Decisions made in previous sessions

**First call:** include site URL and brief business description in the query.  
**All subsequent calls:** AEONOS recalls context automatically — just ask the question.

This makes AEONOS stickier than stateless alternatives. Content agents and audit pipelines benefit most — context compounds across the workflow lifecycle.

---

## Links

- **Agent card (A2A):** https://aeonos.basechainlabs.com/.well-known/agent.json
- **Landing page:** https://aeonos.basechainlabs.com
- **Bazaar listing:** https://agentic.market/?search=aeonos
- **ACP marketplace:** https://app.virtuals.io/acp/agent/019dfbe3-94e6-73f8-9acb-641c5c8d8d9c
- **Built by:** basechainlabs.com

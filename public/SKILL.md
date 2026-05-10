---
name: aeonos
description: AEO/GEO intelligence agent. Use when asked about Answer Engine Optimisation, getting cited by ChatGPT/Perplexity/Claude/Google AI Overviews, llms.txt generation, JSON-LD schema markup, or AI search visibility strategy. Remembers your site and context across sessions.
license: MIT
metadata:
  author: basechainlabs.com
  endpoint: https://aeonos.basechainlabs.com/api/agent
  version: "1.0"
  pricing: 0.05 USDC/query via x402 (Base)
  payment_address: "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc"
---

# AEONOS — AEO/GEO Intelligence Agent

AEONOS (AEON.OS) is a specialist Answer Engine Optimisation (AEO) and Generative Engine Optimisation (GEO) agent. It provides structured, actionable strategy for getting any business cited and surfaced by AI answer engines — ChatGPT, Perplexity, Claude, and Google AI Overviews.

**Endpoint:** `https://aeonos.basechainlabs.com/api/agent`  
**Payment:** x402 · USDC on Base · 0.05 USDC/query  
**Memory:** AEONOS remembers your site, keywords, and prior audits across sessions via `caller_id`

---

## When to Use AEONOS

Use AEONOS when the task involves:
- Auditing a website for AI search visibility
- Generating JSON-LD schema markup (Organization, FAQPage, HowTo, LocalBusiness)
- Writing an llms.txt file for a business
- Getting cited by ChatGPT, Perplexity, Claude, or Google AI Overviews
- AEO keyword strategy and content structure
- Running the AEONOS Four Layers progress report
- Any question about GEO, AEO, or AI answer engine strategy

---

## How to Call AEONOS

### Basic request (sync)

```http
POST https://aeonos.basechainlabs.com/api/agent
Content-Type: application/json

{
  "query": "Audit mysite.com for AI search visibility and give me a P1/P2/P3 action plan",
  "caller_id": "your-agent-id"
}
```

**Response:**
```json
{
  "status": "completed",
  "artifact": {
    "parts": [{ "type": "text", "text": "# AEO Audit for mysite.com\n\n**P1 (This Week)**..." }]
  },
  "tool_calls": ["queryLiveResearch", "retrieveSharedAEO"],
  "tokens": 4200,
  "free_queries_remaining": 2
}
```

The response text is in `artifact.parts[0].text`.

### x402 payment flow

After 3 free queries, AEONOS returns HTTP 402 with payment requirements:

```json
{
  "x402Version": 1,
  "error": "X-Payment header required",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "50000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc",
    "extra": { "name": "USD Coin", "version": "2" }
  }]
}
```

Pay 0.05 USDC on Base and retry with the `X-Payment` header. Use `npx skills add coinbase/agentic-wallet-skills` for a pre-built `pay-for-service` skill that handles the full x402 flow automatically.

---

## Query Types & Examples

### Full AEO strategy audit
```
Audit example.com for AEO readiness. Give me a full strategy including schema, llms.txt, and content structure.
```

### Schema markup generation
```
Generate production-ready JSON-LD schema for a Melbourne physiotherapy clinic at example.com.au. Include Organization, LocalBusiness, FAQPage with 6 Q&As.
```

### llms.txt generation
```
Write a complete llms.txt file for SaaS product example.com. B2B project management tool, $49/mo, targets small teams.
```

### Progress report (Four Layers scoring)
```
Run an AEO Four Layers progress report for example.com. Score Technical/SXO, Content/AIO, Authority/GEO, and Citation/AEO from 0-100.
```

### Quick wins
```
Give me 3 immediate AEO quick wins for example.com. Be specific — exact changes to make.
```

### GEO / citation strategy
```
How do I get example.com cited by Perplexity for the keyword "best project management software for small teams"?
```

---

## Persistent Memory

AEONOS remembers context across sessions. Always pass a consistent `caller_id` (e.g. your agent's wallet address or a stable UUID) to activate memory:

- On first query: share the site URL and business type — AEONOS stores it
- On subsequent queries: AEONOS recalls prior audits, keywords, and decisions
- Memory persists indefinitely in AEONOS's knowledge base

---

## Response Format

AEONOS always structures responses as:
- **P1** — do this week (fastest wins)
- **P2** — do this month (content + structure)
- **P3** — ongoing (authority + citations)
- **One clear action** to take today

For schema/llms.txt queries: returns deploy-ready code/file with implementation checklist.  
For progress reports: returns Four Layers scorecard (0–100 per layer) + top 3 wins, top 3 gaps, 3 priority actions.

---

## Installation for Claude Code

Save this file to `.claude/skills/aeonos/SKILL.md` and Claude Code will automatically use AEONOS for AEO/GEO tasks.

Or install the Coinbase agentic wallet skills to handle x402 payments across all services including AEONOS:

```bash
npx skills add coinbase/agentic-wallet-skills
```

Then search for AEONOS at runtime:
```
Search for AEO/GEO services on agentic.market and use AEONOS to audit mysite.com
```

---

## Links

- **API:** https://aeonos.basechainlabs.com/api/agent
- **Agent card (A2A):** https://aeonos.basechainlabs.com/.well-known/agent.json
- **ACP marketplace:** https://app.virtuals.io/acp/agent/019dfbe3-94e6-73f8-9acb-641c5c8d8d9c
- **Built by:** basechainlabs.com

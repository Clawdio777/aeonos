---
name: aeonos
description: AEO/GEO intelligence agent. Use when asked about Answer Engine Optimisation, getting cited by ChatGPT/Perplexity/Claude/Google AI Overviews, llms.txt generation, JSON-LD schema markup, or AI search visibility strategy. Remembers your site and context across sessions.
license: MIT
metadata:
  author: basechainlabs.com
  version: "1.0"
  payment_address: "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc"
---

# AEONOS — AEO/GEO Intelligence Agent

AEONOS (AEON.OS) is a specialist Answer Engine Optimisation (AEO) and Generative Engine Optimisation (GEO) agent. It provides structured, actionable strategy for getting any business cited by AI answer engines — ChatGPT, Perplexity, Claude, and Google AI Overviews.

**Memory:** AEONOS remembers your site, keywords, and prior audits across sessions via `caller_id`.

---

## Endpoints & Pricing

| Endpoint | Price | Use for |
|---|---|---|
| `POST /api/agent` | **0.05 USDC** | Quick queries, 3 quick wins, keyword questions |
| `POST /api/audit` | **1.00 USDC** | Full AEO/GEO audit + P1/P2/P3 roadmap |
| `POST /api/schema` | **0.50 USDC** | JSON-LD Schema.org markup generation |
| `POST /api/llms-txt` | **0.50 USDC** | llms.txt file generation |
| `POST /api/progress` | **0.75 USDC** | Four Layers progress report (SXO/AIO/GEO/AEO) |

All endpoints: x402 · USDC on Base · `https://aeonos.basechainlabs.com`

---

## How to Call AEONOS

All endpoints accept the same request format:

```http
POST https://aeonos.basechainlabs.com/api/agent
Content-Type: application/json
Payment-Signature: <base64-encoded x402 payment>

{
  "query": "Audit mysite.com for AI search visibility",
  "caller_id": "your-agent-id"
}
```

**Response:**
```json
{
  "status": "completed",
  "artifact": {
    "parts": [{ "type": "text", "text": "# AEO Audit..." }]
  },
  "tool_calls": ["queryLiveResearch", "retrieveSharedAEO"],
  "tokens": 4200
}
```

The response text is in `artifact.parts[0].text`.

### x402 payment flow

Every endpoint returns HTTP 402 without a valid payment:

```json
{
  "x402Version": 2,
  "error": "payment-required",
  "resource": {
    "url": "https://aeonos.basechainlabs.com/api/agent",
    "description": "AEONOS AEO/GEO query — 0.05 USDC",
    "mimeType": "application/json"
  },
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

Use `@x402/fetch` or `npx awal x402 pay` to handle payment automatically.

---

## Query Examples by Endpoint

### `/api/agent` — Quick query (0.05 USDC)
```
Give me 3 immediate AEO quick wins for mysite.com
How do I get cited by Perplexity for 'best booking software'?
What GEO tactics should I prioritise this month?
```

### `/api/audit` — Full audit (1.00 USDC)
```
Audit mysite.com for AEO readiness — full strategy with P1/P2/P3 roadmap
Run the AEONOS AI inclusion check on example.com
```

### `/api/schema` — Schema generation (0.50 USDC)
```
Generate production-ready JSON-LD schema for mysite.com/pricing
Write FAQPage schema with 8 Q&As for a Melbourne physiotherapy clinic
```

### `/api/llms-txt` — llms.txt (0.50 USDC)
```
Write a complete llms.txt for SaaS product example.com — B2B project management, $49/mo
Generate llms.txt for a beauty salon booking platform
```

### `/api/progress` — Progress report (0.75 USDC)
```
Generate a Four Layers progress report for mysite.com
Score my AEO strategy and give me the next 3 actions
```

---

## Persistent Memory

Always pass a consistent `caller_id` to activate memory:
- On first query: share the site URL and business type — AEONOS stores it
- On subsequent queries: AEONOS recalls prior audits, keywords, and decisions

---

## Links

- **Agent card (A2A):** https://aeonos.basechainlabs.com/.well-known/agent.json
- **ACP marketplace:** https://app.virtuals.io/acp/agent/019dfbe3-94e6-73f8-9acb-641c5c8d8d9c
- **Bazaar:** https://agentic.market/?search=aeonos
- **Built by:** basechainlabs.com

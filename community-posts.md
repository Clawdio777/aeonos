# AEONOS + VERITY — Community Post Drafts

## Reddit — r/MCPservers

### AEONOS post

**Title:** AEONOS — AEO/GEO audit MCP server (pay-per-call via x402, no API key)

**Body:**
Built AEONOS to solve a real problem: clients spending thousands on SEO while their content gets completely ignored by ChatGPT, Perplexity, and Google AI Overviews.

**What it does:**
- Full AEO/GEO audit — P1/P2/P3 gap analysis, E-E-A-T scoring (0-100), entity disambiguation score
- JSON-LD schema generation (ready to paste, validated)
- llms.txt file generation for AI crawler rules
- Citation tracking — checks if your domain is being cited by Perplexity, ChatGPT, and Google AIO in real time
- Sentiment analysis on those citations (🟢/🟡/🔴)
- Delta reporting — returning callers get a "what changed since last audit" comparison

**Why MCP:** Agent-native. Any Claude/Cursor/MCP-compatible agent can call it mid-task. No subscription — pay per call via x402 on Base (0.05–1.00 USDC depending on endpoint).

Install in 30 seconds:
```
npx aeonos-mcp
```

GitHub: https://github.com/Clawduo777/aeonos
Live: https://aeonos.basechainlabs.com

---

### VERITY post

**Title:** VERITY — Real-time fact-checking MCP server (CURRENT / OUTDATED / DISPUTED / UNVERIFIABLE verdicts)

**Body:**
Built this after getting burned by AI agents confidently stating outdated info. VERITY verifies any claim, URL, or piece of content against live web sources before it ships.

**What makes it different:**
- Structured verdicts: CURRENT / OUTDATED / DISPUTED / UNVERIFIABLE (not just "I'm not sure")
- `what_changed` field — plain English explanation of what shifted and which sources say so
- Confidence score 0–100 so you can set your own threshold
- Persistent memory per caller_id — repeat verifications are skipped automatically
- No API key — pay per call via x402 on Base (0.10 USDC standard, 0.75 USDC batch)

**Use cases:**
- AI content pipelines — check facts before publishing
- Research agents — ground claims in live sources
- Cursor/Claude agents — mid-task verification without breaking flow

```
npx verity-mcp
```

GitHub: https://github.com/Clawduo777/verity
Live: https://verity.basechainlabs.com

---

## Reddit — r/AI_Agents

### Combined post

**Title:** Two agent-native MCP servers I built — AEO auditing (AEONOS) and fact-checking (VERITY). Both pay-per-call via x402, no subscriptions.

**Body:**
Been building on the x402 protocol (USDC payments on Base) and wanted to share two agents that are live and running:

**AEONOS** — AI Search Visibility Agent
The problem: most content teams optimise for Google but get invisible to AI search engines. AEONOS audits websites for AEO/GEO readiness, tracks citations across ChatGPT/Perplexity/Google AIO, and generates the schema + llms.txt needed to get cited.
- `npx aeonos-mcp` | 0.05–1.00 USDC/call
- https://github.com/Clawduo777/aeonos

**VERITY** — Real-time fact-checker
The problem: LLMs hallucinate and training data goes stale. VERITY verifies claims against live web before your agent ships them. Returns CURRENT / OUTDATED / DISPUTED / UNVERIFIABLE with exactly what changed.
- `npx verity-mcp` | 0.10–0.75 USDC/call
- https://github.com/Clawduo777/verity

Both are on Smithery (verified ✅), agentic.market, and the Official MCP Registry. Happy to answer questions on the x402 integration if anyone's building similar.

---

## X/Twitter — AEONOS thread

**Tweet 1:**
Built AEONOS — an AI search visibility agent that audits your site for AEO/GEO readiness and tells you exactly why ChatGPT, Perplexity, and Google AIO aren't citing you.

P1/P2/P3 gaps. Schema templates. E-E-A-T score. llms.txt.

Agent-native, pay-per-call via x402 on Base.

npx aeonos-mcp 🦉

**Tweet 2 (reply):**
What AEONOS actually checks:
→ Schema gaps (P1 = critical, P2 = important, P3 = nice-to-have)
→ Entity disambiguation score (below 60 = AI search can't identify you)
→ E-E-A-T score 0-100
→ Whether Perplexity / ChatGPT / Google AIO are citing your domain right now
→ Sentiment on those citations 🟢🟡🔴

Delta reporting on every return visit — see what improved.

**Tweet 3 (reply):**
No API key. No subscription.

0.05 USDC for a quick query.
1.00 USDC for a full audit.

Paid via x402 — the agent payment protocol built on Base. Runs natively in Claude, Cursor, or any MCP-compatible agent.

github.com/Clawduo777/aeonos

---

## X/Twitter — VERITY thread

**Tweet 1:**
Built VERITY — an MCP server that fact-checks AI agent output before it ships.

Not "I think this might be wrong." Actual verdicts:

✅ CURRENT
⚠️ OUTDATED  
❓ DISPUTED
⛔ UNVERIFIABLE

+ confidence score + exactly what changed.

npx verity-mcp

**Tweet 2 (reply):**
Why structured verdicts matter:

Most agents either hallucinate silently or add generic disclaimers. VERITY gives a machine-readable result your agent can act on.

Set your own threshold: confidence < 70? Block the output. confidence > 85? Ship it.

**Tweet 3 (reply):**
Also: persistent memory per caller_id.

If your agent already verified a claim this session, VERITY skips the lookup. Tokens saved, latency down.

No API key. 0.10 USDC/verify via x402 on Base.

github.com/Clawduo777/verity
Smithery: smithery.ai/servers/clawdio777/verity ✅ verified

---

## Farcaster — AEONOS launch

### Launch cast (post from BaseChain Labs account)

**Cast (238 chars):**
We built the first AEO/GEO optimisation agent on MCP. AEONOS helps your content appear in ChatGPT, Claude & Perplexity answers. $0.10/call via x402 on Base. Try it: [npm install aeonos-mcp] Listed on Smithery + MCP Registry. @jesse.base.eth

**Tag:** @jesse.base.eth

**Cross-post to channels:** /base · /mcp · /ai-agents

### Weekly cadence — use-case example casts

Cast 2 (week 2):
A SaaS homepage with no FAQ schema, no llms.txt, and 0 citations in Perplexity. AEONOS audited it in 40 seconds, generated the missing JSON-LD, and flagged the exact query gaps. One-time fix, permanent citation signal. $0.10 via x402 on Base. npx aeonos-mcp

Cast 3 (week 3):
Why is your competitor cited in ChatGPT and you're not? Usually 3 things: missing entity disambiguation, no structured Q&A blocks, and llms.txt blocked. AEONOS checks all three + gives you the templates. Pay per audit, no subscription. /base /mcp /ai-agents

Cast 4 (week 4):
AEO ≠ SEO. Google ranks pages. AI engines cite entities. If your site doesn't clearly define what you are, who you serve, and what you do in structured data — you're invisible to Perplexity, Claude, and ChatGPT. AEONOS fixes that. npx aeonos-mcp · x402 on Base

---

## AEO/GEO Roundup Outreach — Pitch & Submission Tracker

### Standard pitch (3 sentences)

AEONOS is the only MCP-native AEO/GEO agent callable by other AI agents via x402 micropayments on Base blockchain. Unlike SaaS dashboards, it integrates directly into agent workflows — any Claude, Cursor, or MCP-compatible agent can call AEONOS mid-task without a subscription. Try it: `npx aeonos-mcp` (npm) · https://smithery.ai/servers/clawdio777/aeonos (Smithery)

---

### Scrunch

**Target:** scrunch.com/blog contact form / editorial team
**URL:** https://scrunch.com/blog
**Submit via:** Contact form or editorial@scrunch.com (check site for current address)
**Subject:** Tool submission: AEONOS for your AEO/GEO roundup
**Body:**

Hi,

I wanted to flag AEONOS for inclusion in any upcoming AEO or GEO tool roundups on the Scrunch blog.

AEONOS is the only MCP-native AEO/GEO agent callable by other AI agents via x402 micropayments on Base blockchain. Unlike SaaS dashboards, it integrates directly into agent workflows — any Claude, Cursor, or MCP-compatible agent can call AEONOS mid-task without a subscription. Try it: `npx aeonos-mcp` (npm) · https://smithery.ai/servers/clawdio777/aeonos (Smithery)

Happy to provide a demo, case data, or a short quote for editorial context.

Thanks

**Status:** [ ] Submitted | Date: ___

---

### Frase

**Target:** frase.io editorial / content team
**URL:** https://frase.io/blog
**Submit via:** hello@frase.io or in-app contact (check site for current address)
**Subject:** Tool submission: AEONOS — MCP-native AEO/GEO agent for your roundup
**Body:**

Hi Frase team,

I'm reaching out about AEONOS, which I think fits well in any roundup covering AEO or GEO tools.

AEONOS is the only MCP-native AEO/GEO agent callable by other AI agents via x402 micropayments on Base blockchain. Unlike SaaS dashboards, it integrates directly into agent workflows — any Claude, Cursor, or MCP-compatible agent can call AEONOS mid-task without a subscription. Try it: `npx aeonos-mcp` (npm) · https://smithery.ai/servers/clawdio777/aeonos (Smithery)

Let me know if you'd like screenshots, audit output samples, or a walkthrough.

Thanks

**Status:** [ ] Submitted | Date: ___

---

### Medium / Meridian (@try_meridian)

**Target:** Reply to the Medium post at medium.com/@try_meridian that published the AEO/GEO roundup
**Submit via:** Medium comment / reply on the relevant post
**Reply text:**

Great roundup — one tool worth adding to a future edition: AEONOS is the only MCP-native AEO/GEO agent callable by other AI agents via x402 micropayments on Base blockchain. Unlike SaaS dashboards, it integrates directly into agent workflows. Try it: `npx aeonos-mcp` · https://smithery.ai/servers/clawdio777/aeonos

**Status:** [ ] Submitted | Date: ___

---

### Hidekazu Konishi — MCP Ecosystem Reference (2026 page)

**Target:** hidekazu-konishi.com — MCP ecosystem reference author
**Submit via:** Contact form at hidekazu-konishi.com (check site for current address)
**Subject:** Submission for MCP ecosystem reference — AEONOS AEO/GEO agent
**Body:**

Hi Hidekazu,

I've been following your MCP ecosystem reference work and wanted to submit AEONOS for consideration in the 2026 edition.

AEONOS is the only MCP-native AEO/GEO agent callable by other AI agents via x402 micropayments on Base blockchain. Unlike SaaS dashboards, it integrates directly into agent workflows — any Claude, Cursor, or MCP-compatible agent can call AEONOS mid-task without a subscription. Try it: `npx aeonos-mcp` (npm) · https://smithery.ai/servers/clawdio777/aeonos (Smithery)

Category suggestion: AEO/GEO · AI Search Visibility · Agent-to-Agent (A2A) tooling

Happy to provide any additional detail you need for the reference page.

Thanks

**Status:** [ ] Submitted | Date: ___

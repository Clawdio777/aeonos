/**
 * Accuracy guards (17/11/2026). Run: bun test
 * No word-count folklore, no unsourced impact figures, regulated-industry guardrails, and nothing filled in or guessed:
 * a check that failed or wasn't run says "not checked". Every HTTP call and the model are mocked; an unexpected URL
 * throws, so no test makes a live or paid call. Tests that need src/tools.ts or the agent are in knowledge-model.test.ts (the agent run in its own process),
 * because tools.ts builds its Anthropic client on import and citations.test.ts must mock that SDK first.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

Object.assign(process.env, { SUPABASE_URL: "http://localhost:1", SUPABASE_SERVICE_KEY: "test-service", ANTHROPIC_API_KEY: "test-anthropic" });

import * as g from "../src/guards.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A fake site: each path's response, or "throw" for a fetch that fails. Anything else throws. */
function fakeSite(pages: Record<string, { status: number; body?: string } | "throw">) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const p = pages[url];
    if (p === "throw") throw new DOMException("The operation timed out.", "TimeoutError");
    if (!p) throw new Error(`unexpected live call in test: ${url}`);
    return new Response(p.body ?? "", { status: p.status });
  }) as typeof fetch;
}

const CLINIC_HTML = `<!doctype html><html><head><title>Acme Osteopathy | Springfield</title></head><body>
<h1>Acme Osteopathy</h1><h2>Our services</h2><p>We treat back pain. Call us.</p></body></html>`;

// inspect.ts is imported with a query so another test file's mock of it can't stand in (none today; cheap insurance)
let inspect: typeof import("../src/inspect.ts");
beforeAll(async () => {
  inspect = await import("../src/inspect.ts?accuracy");
});

describe("1. No word-count rules", () => {
  test("length targets go, the advice stays, measured counts stay", () => {
    expect(g.withoutWordCountRules("Add a 40-60 word direct answer under each question.")).toBe("Add a short direct answer under each question.");
    expect(g.withoutWordCountRules("Expand each page to 800+ words covering fees and what to expect.")).toBe("Expand each page covering fees and what to expect.");
    expect(g.withoutWordCountRules("Aim for around 1500 words. Lead with the answer.")).toBe("Lead with the answer.");
    expect(g.withoutWordCountRules("Your condition pages are 199 to 251 words.")).toBe("Your condition pages are 199 to 251 words.");
    // Ranges as written in AEONOS's stored knowledge
    expect(g.withoutWordCountRules("Add answer-first paragraphs (40-60 words) under each question heading.")).toBe("Add answer-first paragraphs under each question heading.");
    expect(g.withoutWordCountRules("Write 2-4 long-form blog posts targeting problem-aware keywords (1500-2500 words each).")).toBe("Write 2-4 long-form blog posts targeting problem-aware keywords.");
    expect(g.withoutWordCountRules("This page is only 120 to 150 words.")).toBe("This page is only 120 to 150 words.");
  });

  test("only the site's root is the homepage (a /blog/post/ URL used to count)", async () => {
    const article = `<html><head><title>Acme Tools blog</title></head><body><article><h1>How to use it</h1><p>Text.</p></article></body></html>`;
    fakeSite({ "https://acme.example/blog/post/": { status: 200, body: article }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/blog/post/", caller_id: "" });
    expect(out).not.toContain("on the homepage");
    expect(out).toContain("Missing Article schema");
  });

  test("the agent's answer is cleaned outside code blocks and tables only", () => {
    const answer = ["## P1", "- Write 1500-2500 words per post.", "- Add an FAQ.", "```json", '{"text": "a 40-60 word answer"}', "```", "| page | 210 words |"].join("\n");
    expect(g.guardAnswer(answer)).toBe(["## P1", "- Add an FAQ.", "```json", '{"text": "a 40-60 word answer"}', "```", "| page | 210 words |"].join("\n"));
  });

  test("inspect no longer has a word-count or sentence-length rule, and its templates set no length", async () => {
    const thin = `<html><head><title>Acme Tools</title></head><body><h1>Acme Tools</h1><p>${"Long sentence word ".repeat(12)}.</p></body></html>`;
    fakeSite({ "https://acme.example/": { status: 200, body: thin }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(out).not.toMatch(/\d+\s*(?:-|to)\s*\d+[- ]word|minimum \d+ words|over 25 words|aim for \d/i);
    expect(out).not.toMatch(/Thin content/);
  });
});

describe("2. No unsourced impact figures", () => {
  test("a figure for what a change achieves goes; a measured result stays", () => {
    expect(g.withoutImpactStats("Fix this first. It gives an 80% AI visibility improvement.")).toBe("Fix this first.");
    expect(g.withoutImpactStats("Pages with FAQ markup are 3x more likely to be cited.")).toBe("");
    expect(g.withoutImpactStats("AI engines now handle a majority of informational queries.")).toBe("");
    expect(g.withoutImpactStats("Perplexity named you in 40% of samples (2/5).")).toBe("Perplexity named you in 40% of samples (2/5).");
  });

  test("the agent's system prompt no longer makes the market claim or asks for citation likelihood estimates", async () => {
    const src = await Bun.file(new URL("../src/agent.ts", import.meta.url)).text();
    expect(src).not.toMatch(/majority of informational queries|citation likelihood estimates|real campaign results/);
    expect(src).toContain("EVIDENCE RULES");
  });
});

describe("3. Regulated businesses: health, legal, financial", () => {
  test("detected from the page title and headings", () => {
    expect(g.regulatedIndustry({ title: "Acme Osteopathy | Springfield", headings: [] })).toEqual({ kind: "health", name: "osteopathy" });
    expect(g.regulatedIndustry({ title: "Smith Lawyers", headings: [] })).toEqual({ kind: "legal", name: "lawyers" });
    expect(g.regulatedIndustry({ title: "Home", headings: ["Mortgage brokers in Melbourne"] })).toEqual({ kind: "financial", name: "mortgage brokers" });
    expect(g.regulatedIndustry({ title: "Acme Coffee", headings: ["Cold brew"] })).toBeNull();
  });

  test("testimonials, comparisons, 'best', guarantees and case results are removed for them, not for others", () => {
    const text = "Add an FAQ page. Create an Acme vs Rival comparison page. Add patient testimonials. Say you are the best clinic in Springfield. Show case results and win rates. Results guaranteed.";
    expect(g.withoutRegulatedAdRisk(text)).toBe("Add an FAQ page.");
    const health = { kind: "health" as const, name: "osteopathy" };
    expect(g.guardAnswer(`- ${text}`, health)).toBe("- Add an FAQ page.");
    expect(g.guardAnswer(`- ${text}`, null)).toBe(`- ${text}`);
  });

  test("inspect flags the regulated industry, and the agent reads it back", async () => {
    fakeSite({ "https://acme.example/": { status: 200, body: CLINIC_HTML }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(g.regulatedFromToolOutput(out)).toEqual({ kind: "health", name: "osteopathy" });
  });
});

describe("4. Nothing filled in, guessed or stale presented as current", () => {
  test("every inspect result says what was fetched, when, and that JavaScript wasn't run", async () => {
    fakeSite({ "https://acme.example/": { status: 200, body: CLINIC_HTML }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(out).toMatch(/Fetched: https:\/\/acme\.example\/ at \d{4}-\d{2}-\d{2}T[\d:.]+Z \(this one page only, raw HTML; JavaScript was not run/);
  });

  test("a page that can't be fetched is 'not checked', never described", async () => {
    fakeSite({ "https://acme.example/": "throw" });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(out).toMatch(/^Not checked: https:\/\/acme\.example\/ could not be fetched at \d{4}-/);
    expect(out).not.toMatch(/Score/);
  });

  test("llms.txt or robots.txt that can't be fetched is 'not checked', never 'missing' or 'none blocked'", async () => {
    fakeSite({ "https://acme.example/": { status: 200, body: CLINIC_HTML }, "https://acme.example/llms.txt": "throw", "https://acme.example/robots.txt": { status: 503 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(out).toContain("- llms.txt: not checked (fetch failed: timed out)");
    expect(out).toContain("- AI crawlers blocked: not checked (robots.txt HTTP 503)");
    expect(out).not.toMatch(/No \/llms\.txt file/);
  });

  test("a page with no date: freshness is 'not measured', not a made-up 50, and it is left out of the overall score", async () => {
    fakeSite({ "https://acme.example/": { status: 200, body: CLINIC_HTML }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/", caller_id: "" });
    expect(out).toContain("- Content Freshness: not measured (no date found on the page)");
    expect(inspect.weightedScore([[80, 0.5], [null, 0.25], [40, 0.25]])).toBe(Math.round((80 * 0.5 + 40 * 0.25) / 0.75));
  });

  test("schema templates hold placeholders, never a made-up logo, email or today's date", async () => {
    const article = `<html><head><title>How to treat back pain</title></head><body><article><h1>How to treat back pain</h1><p>Text.</p></article></body></html>`;
    fakeSite({ "https://acme.example/blog/back-pain/": { status: 200, body: article }, "https://acme.example/llms.txt": { status: 404 }, "https://acme.example/robots.txt": { status: 404 } });
    const out = await inspect.runInspectSiteStructure({ url: "https://acme.example/blog/back-pain/", caller_id: "" });
    const today = new Date().toISOString().slice(0, 10);
    expect(out).toContain('"datePublished": "[YYYY-MM-DD the page was first published]"');
    expect(out).not.toContain(`"dateModified": "${today}"`);
    expect(out).not.toMatch(/logo\.png|hello@acme\.example/);
  });

});

describe("6. Report directives ask for measured scores only", () => {
  test("no route asks the model to score a layer out of 100 or predict citations", async () => {
    for (const f of ["../api/progress.ts", "../api/audit.ts", "../api/mcp.ts"]) {
      const src = await Bun.file(new URL(f, import.meta.url)).text();
      expect(src).not.toMatch(/Score each layer \(SXO, AIO, GEO, AEO\) out of 100|Score SXO, AIO, GEO, and AEO out of 100|will ChatGPT, Perplexity, Claude, and Google AI Overviews cite this content|citation likelihood/);
    }
    const progress = await Bun.file(new URL("../api/progress.ts", import.meta.url)).text();
    expect(progress).toContain('write "not measured", never an estimated number');
  });
});

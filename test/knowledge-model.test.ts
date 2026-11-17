/**
 * Accuracy guards, part 2 (17/11/2026): knowledge labels, share-of-voice "not checked", the agent's model and its
 * guarded answer. Run: bun test
 * Only pure modules are loaded here; the agent run happens in its own process (test/agent-loop.check.ts). No test makes
 * a live or paid call.
 */
import { describe, expect, test } from "bun:test";
import { formatKnowledge, formatSharedAEO } from "../src/guards.ts";
import { queryLine, checkedLines } from "../api/_sov-lines.ts";
import { anthropicCost } from "../src/costs.ts";

describe("4. Knowledge and share of voice: nothing stale or unchecked presented as current", () => {
  test("knowledge notes carry their own dates and are labelled as background, not live", () => {
    const k = formatKnowledge([{ category: "geo_strategy", title: "Answers", insight: "Add a 40-60 word answer. It gives an 80% AI visibility improvement.", date: "2026-09-01" }], new Date("2026-11-17T00:00:00Z"));
    expect(k).toContain("(written 2026-09-01)");
    expect(k).toContain("fetched 2026-11-17T00:00:00.000Z");
    expect(k).not.toMatch(/\blive,|40-60|80%/);
    expect(k).toContain("not live data");
  });

  test("shared knowledge base entries are cleaned and labelled", () => {
    const out = formatSharedAEO([{ category: "aeo_fundamentals", content: { steps: ["Add answer-first paragraphs (40-60 words) under each heading", "Use 3-7 questions per page"], ai_impact: "80% AI visibility improvement" }, last_updated: "2026-10-01" }]);
    expect(out).toMatch(/^AEONOS knowledge base: background notes/);
    expect(out).not.toMatch(/40-60 word|80% AI visibility/);
    expect(out).toContain("Add answer-first paragraphs under each heading");
    expect(out).toContain('"last_updated": "2026-10-01"');
  });

  test("share of voice: an engine with no answer is 'not checked', never 'not cited', and the run says when and where", () => {
    const empty = { cited: 0, total: 0, citedSamples: 0, samples: 0, rate: 0, results: [] as any[] };
    const snap: any = {
      domain: "acme.example", perplexity: { ...empty, results: [{ query: "q1", cited: true }] }, chatgpt: { ...empty, results: [{ query: "q1", cited: false }] },
      gemini: empty, claude: empty, googleAIO: empty, googleAIMode: empty, unavailable: { gemini: "quota exceeded" }, valid: true, invalidReasons: [],
      method: { version: "v4", samples: 1, models: {}, locations: { perplexity: "AU" } }, checkedAt: "2026-11-17T01:00:00.000Z",
    };
    expect(queryLine(snap, "q1")).toBe("acme.example: cited by Perplexity; not cited by ChatGPT; not checked: Gemini, Google AIO, Google AI Mode, Claude");
    expect(checkedLines([snap])).toEqual([
      "Checked: 2026-11-17T01:00:00.000Z (answers fetched live this run). Asked from: perplexity AU.",
      "Not checked: gemini (quota exceeded). These are unknown, not 0%.",
    ]);
    expect(checkedLines([{ ...snap, unavailable: {}, valid: false, invalidReasons: ["perplexity: 2 of 5 samples"] }])[1]).toBe("Incomplete run, treat with care: acme.example: perplexity: 2 of 5 samples");
  });
});

/** One agent run in its own process (see test/agent-loop.check.ts); mode = how the knowledge feed answers. */
async function agentRun(mode: "404" | "ok" | "throw" | "notoken") {
  const proc = Bun.spawn(["bun", "run", new URL("./agent-loop.check.ts", import.meta.url).pathname, mode], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  return JSON.parse(out.trim().split("\n").pop()!);
}

describe("5. Model", () => {
  test("Claude Sonnet 5.5 is priced at US$2/US$10 per million tokens, same as Sonnet 5", () => {
    expect(anthropicCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(12);
    expect(anthropicCost("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500 })).toBe(anthropicCost("claude-sonnet-5", { input_tokens: 1000, output_tokens: 500 }));
  });

  test("one agent run: every model call names Sonnet 5.5, and the answer goes through the guards (regulated clinic)", async () => {
    const r = await agentRun("404");
    expect(r.agentModel).toBe("claude-sonnet-5-5");
    expect(r.models).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
    // The comparison page and testimonials are removed for an osteopathy clinic; the word-count rule for everyone
    expect(r.response).toBe("## P1\n- Add an FAQ page.");
  }, 20_000);
});

describe("6. Pemba Agent's knowledge feed (17/11/2026)", () => {
  test("sends PEMBA_KNOWLEDGE_TOKEN as the bearer token, and the dated, cleaned notes reach the model", async () => {
    const r = await agentRun("ok");
    expect(r.knowledgeAuthIsBearerToken).toBe(true);
    expect(r.systemHasKnowledge).toBe(true);
    expect(r.systemHasNote).toBe(true);
    expect(r.systemHasRawRule).toBe(false);
    expect(r.systemHasCleanedRule).toBe(true);
    expect(r.warnings).toEqual([]);
  }, 20_000);

  test("a non-200 reply logs one line with the status only, and the answer runs with no notes", async () => {
    const r = await agentRun("404");
    expect(r.warnings).toEqual(["[aeonos] knowledge feed not loaded: HTTP 404"]);
    expect(r.warnings.join(" ")).not.toMatch(/fake-knowledge-token|secret detail/);
    expect(r.systemHasKnowledge).toBe(false);
  }, 20_000);

  test("a failed fetch logs the error name only; no token set logs that and makes no request", async () => {
    const t = await agentRun("throw");
    expect(t.warnings).toEqual(["[aeonos] knowledge feed not loaded: TimeoutError"]);
    expect(t.systemHasKnowledge).toBe(false);
    const n = await agentRun("notoken");
    expect(n.warnings).toEqual(["[aeonos] knowledge feed not loaded: PEMBA_KNOWLEDGE_TOKEN not set"]);
    expect(n.knowledgeCalls).toBe(0);
    expect(n.systemHasKnowledge).toBe(false);
  }, 30_000);
});

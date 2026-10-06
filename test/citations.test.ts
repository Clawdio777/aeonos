/**
 * Citation method v3 tests (06/10/2026). Run: bun test
 * Every provider is mocked: global fetch (Perplexity, OpenAI, Gemini, DataForSEO) and the Anthropic SDK.
 * Any request to an unexpected URL throws, so a test can never make a live paid call.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Fake credentials only, so every engine is "attempted". Nothing here is a real key.
const FAKE_ENV: Record<string, string> = {
  PPLX_API_KEY: "test-pplx", OPENAI_API_KEY: "test-openai", GEMINI_API_KEY: "test-gemini", ANTHROPIC_API_KEY: "test-anthropic",
  DATAFORSEO_LOGIN: "test-login", DATAFORSEO_PASSWORD: "test-password",
  SUPABASE_URL: "http://localhost:1", SUPABASE_SERVICE_KEY: "test-service", PEMBA_API_KEY: "test-pemba",
};
Object.assign(process.env, FAKE_ENV);

type Engine = "pplx" | "gpt" | "gemini" | "claude" | "aio" | "aimode";
type Fail = "429" | "500" | "timeout" | "empty";

const state = {
  /** Number of calls per engine that should fail, and how. */
  fail: {} as Partial<Record<Engine, { count: number; kind: Fail }>>,
  /** Queries whose SERP fetch fails outright (Google surfaces). */
  serpFail: {} as Partial<Record<"aio" | "aimode", Set<string>>>,
  /** Queries whose SERP carries an AI answer. Others load with no AI answer. */
  shown: { aio: new Set<string>(), aimode: new Set<string>() },
  calls: { pplx: 0, gpt: 0, gemini: 0, claude: 0, aio: 0, aimode: 0 } as Record<Engine, number>,
  models: { pplx: [] as string[], gpt: [] as string[], gemini: [] as string[], claude: [] as string[] },
  answerText: "Some options include Acme and Other Co.",
};

function reset() {
  state.fail = {};
  state.serpFail = {};
  state.shown = { aio: new Set(), aimode: new Set() };
  state.calls = { pplx: 0, gpt: 0, gemini: 0, claude: 0, aio: 0, aimode: 0 };
  state.models = { pplx: [], gpt: [], gemini: [], claude: [] };
  state.answerText = "Some options include Acme and Other Co.";
  Object.assign(process.env, FAKE_ENV);
}

/** Returns the failure for this call, if this call is one of the first `count` calls to the engine. */
function nextFailure(engine: Engine): Fail | null {
  const n = ++state.calls[engine];
  const f = state.fail[engine];
  return f && n <= f.count ? f.kind : null;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function failResponse(kind: Fail, empty: unknown): Response {
  if (kind === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
  if (kind === "429") return json({ error: "rate limited" }, 429);
  if (kind === "500") return json({ error: "server" }, 500);
  return json(empty);
}

const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;

  if (url === "https://api.perplexity.ai/chat/completions") {
    state.models.pplx.push(body.model);
    const f = nextFailure("pplx");
    if (f) return failResponse(f, { choices: [{ message: { content: "" } }], citations: [] });
    return json({ choices: [{ message: { content: state.answerText } }], citations: ["https://acme.com/best"], usage: {} });
  }
  if (url === "https://api.openai.com/v1/responses") {
    state.models.gpt.push(body.model);
    const f = nextFailure("gpt");
    if (f) return failResponse(f, { output: [] });
    return json({ output: [{ type: "message", content: [{ type: "output_text", text: state.answerText, annotations: [{ type: "url_citation", url: "https://acme.com/a" }] }] }], usage: {} });
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/")) {
    state.models.gemini.push(url.split("/models/")[1].split(":")[0]);
    const f = nextFailure("gemini");
    if (f) return failResponse(f, { candidates: [] });
    return json({ candidates: [{ content: { parts: [{ text: state.answerText }] }, groundingMetadata: { groundingChunks: [{ web: { title: "acme.com", uri: "https://redirect.example/1" } }] } }], usageMetadata: {} });
  }
  const serp = url === "https://api.dataforseo.com/v3/serp/google/organic/live/advanced" ? "aio"
    : url === "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced" ? "aimode" : null;
  if (serp) {
    state.calls[serp]++;
    const keyword: string = body[0].keyword;
    if (state.serpFail[serp]?.has(keyword)) return json({ error: "server" }, 500);
    const items = state.shown[serp].has(keyword)
      ? [{ type: serp === "aio" ? "ai_overview" : "ai_mode", markdown: "Pemba tracks AI citations [pemba](https://pemba.ai/).", references: [{ url: "https://pemba.ai/" }] }]
      : [{ type: "organic", url: "https://acme.com/" }];
    return json({ tasks: [{ status_code: 20000, cost: 0.002, result: [{ items }] }] });
  }
  throw new Error(`unexpected live call in test: ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

// Anthropic SDK: the Claude sampler call has tools (web search); the stance/sentiment classifiers do not.
mock.module("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (params: { model: string; tools?: unknown[] }) => {
        if (!params.tools) return { content: [{ type: "text", text: "[]" }], usage: {} };
        state.models.claude.push(params.model);
        const f = nextFailure("claude");
        if (f === "429") throw Object.assign(new Error("429 rate_limit_error"), { status: 429 });
        if (f === "500") throw Object.assign(new Error("500 api_error"), { status: 500 });
        if (f === "timeout") throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
        if (f === "empty") return { content: [], usage: {} };
        return { content: [{ type: "text", text: state.answerText, citations: [{ url: "https://acme.com/c" }] }], usage: {} };
      },
    };
  }
  return { default: FakeAnthropic };
});
mock.module("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => { throw new Error("no db in tests"); } }) }));

let tools: typeof import("../src/tools.ts");
let handler: typeof import("../api/citations.ts").default;
beforeAll(async () => {
  tools = await import("../src/tools.ts");
  handler = (await import("../api/citations.ts")).default;
});
beforeEach(reset);

const Q2 = ["best ai visibility tool", "how to get cited by chatgpt"];
const Q6 = ["q1", "q2", "q3", "q4", "q5", "q6"];

describe("1. Claude gets the full sample count", () => {
  test("Claude runs samples per query, not min(samples, 2)", async () => {
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 4);
    expect(state.calls.claude).toBe(8);
    expect(r.claude.results.map((x) => x.samples)).toEqual([4, 4]);
    expect(r.claude.expectedSamples).toBe(8);
    expect(r.claude.gotSamples).toBe(8);
  });
});

describe("2. Google surfaces: no-answer SERPs are rows, failed fetches are not", () => {
  test("a fetched SERP with no AI answer is a shown:false row counted as not cited", async () => {
    state.shown.aio.add(Q2[0]);
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 1);
    expect(r.googleAIO.results).toHaveLength(2);
    const [shownRow, hiddenRow] = r.googleAIO.results;
    expect(shownRow).toMatchObject({ query: Q2[0], shown: true, cited: true, samples: 1 });
    expect(hiddenRow).toMatchObject({ query: Q2[1], shown: false, cited: false, citedSamples: 0, samples: 1 });
    expect(r.googleAIO).toMatchObject({ total: 2, cited: 1, samples: 2, rate: 50, expectedSamples: 2, gotSamples: 2, aiAnswerShown: 1, errors: [] });
    // AI Mode showed nothing for either query: two not-cited rows, a real 0%, not "not sampled"
    expect(r.googleAIMode).toMatchObject({ total: 2, cited: 0, rate: 0, gotSamples: 2, aiAnswerShown: 0 });
    expect(r.unavailable.google_ai_mode).toBeUndefined();
  });

  test("a failed fetch is not a row; it is listed in errors", async () => {
    state.shown.aio.add(Q2[0]);
    state.serpFail.aio = new Set([Q2[1]]);
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 1);
    expect(state.calls.aio).toBe(2); // still one fetch per question
    expect(r.googleAIO.results.map((x) => x.query)).toEqual([Q2[0]]);
    expect(r.googleAIO).toMatchObject({ expectedSamples: 2, gotSamples: 1, aiAnswerShown: 1, rate: 100 });
    expect(r.googleAIO.errors).toEqual([{ query: Q2[1], reason: "http 500" }]);
  });
});

describe("3. Expected vs got, errors and validity", () => {
  test("failed calls are listed per engine with a short reason", async () => {
    state.fail = {
      pplx: { count: 2, kind: "429" },
      gpt: { count: 1, kind: "timeout" },
      gemini: { count: 1, kind: "empty" },
      claude: { count: 1, kind: "429" },
    };
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 3);
    expect(r.perplexity.errors.map((e) => e.reason)).toEqual(["rate limit", "rate limit"]);
    expect(r.chatgpt.errors.map((e) => e.reason)).toEqual(["timeout"]);
    expect(r.gemini.errors.map((e) => e.reason)).toEqual(["empty"]);
    expect(r.claude.errors.map((e) => e.reason)).toEqual(["rate limit"]);
    for (const e of [...r.perplexity.errors, ...r.chatgpt.errors]) expect(Q2).toContain(e.query);
    expect(r.perplexity).toMatchObject({ expectedSamples: 6, gotSamples: 4, samples: 4 });
    expect(r.chatgpt).toMatchObject({ expectedSamples: 6, gotSamples: 5 });
    // 4 of 6 = 67% on Perplexity, so the run is not valid
    expect(r.valid).toBe(false);
    expect(r.invalidReasons).toEqual(["perplexity: got 4 of 6 expected samples (67%), below 80%"]);
  });

  test("checkValidity: 80% passes, 79% fails", () => {
    expect(tools.checkValidity({ chatgpt: { attempted: true, expectedSamples: 100, gotSamples: 80 } })).toEqual({ valid: true, invalidReasons: [] });
    expect(tools.checkValidity({ chatgpt: { attempted: true, expectedSamples: 100, gotSamples: 79 } })).toEqual({
      valid: false, invalidReasons: ["chatgpt: got 79 of 100 expected samples (79%), below 80%"],
    });
  });

  test("checkValidity ignores engines that were not attempted, and fails when none were", () => {
    expect(tools.checkValidity({
      chatgpt: { attempted: true, expectedSamples: 10, gotSamples: 10 },
      gemini: { attempted: false, expectedSamples: 10, gotSamples: 0 },
    }).valid).toBe(true);
    expect(tools.checkValidity({ gemini: { attempted: false, expectedSamples: 10, gotSamples: 0 } })).toEqual({ valid: false, invalidReasons: ["no engine was attempted"] });
  });

  test("end to end: 24 of 30 samples (80%) is valid, 23 of 30 (77%) is not", async () => {
    state.fail = { pplx: { count: 6, kind: "500" } };
    const ok = await tools.checkCitationsRaw("pemba.ai", Q6, 5);
    expect(ok.perplexity).toMatchObject({ expectedSamples: 30, gotSamples: 24 });
    expect(ok.perplexity.errors).toHaveLength(6);
    expect(ok.valid).toBe(true);

    reset();
    state.fail = { pplx: { count: 7, kind: "500" } };
    const bad = await tools.checkCitationsRaw("pemba.ai", Q6, 5);
    expect(bad.perplexity).toMatchObject({ expectedSamples: 30, gotSamples: 23 });
    expect(bad.perplexity.errors.every((e) => e.reason === "http 500")).toBe(true);
    expect(bad.valid).toBe(false);
    expect(bad.invalidReasons).toEqual(["perplexity: got 23 of 30 expected samples (77%), below 80%"]);
  });

  test("an engine with no key is not attempted and does not make the run invalid", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 2);
    expect(state.calls.gemini).toBe(0);
    expect(r.gemini).toMatchObject({ attempted: false, gotSamples: 0, expectedSamples: 4 });
    expect(r.unavailable.gemini).toBe("no GEMINI_API_KEY");
    expect(r.valid).toBe(true);
  });

  test("failReason maps errors to short reasons", () => {
    expect(tools.failReason(new DOMException("x", "TimeoutError"))).toBe("timeout");
    expect(tools.failReason(Object.assign(new Error("x"), { status: 429 }))).toBe("rate limit");
    expect(tools.failReason(Object.assign(new Error("x"), { status: 503 }))).toBe("http 503");
    expect(tools.failReason(new Error("Request timed out."))).toBe("timeout");
  });
});

describe("4. Pinned models and the method block", () => {
  test("every sampler calls the pinned model ID and the method block names them", async () => {
    const r = await tools.checkCitationsRaw("pemba.ai", Q2, 2);
    expect(tools.CITATION_MODELS).toEqual({
      chatgpt: "gpt-4.1-mini-2025-04-14", gemini: "gemini-3.8-flash", perplexity: "sonar",
      claude: "claude-haiku-4-5-20251001", google_ai: "serp", google_ai_mode: "serp",
    });
    expect(new Set(state.models.gpt)).toEqual(new Set(["gpt-4.1-mini-2025-04-14"]));
    expect(new Set(state.models.gemini)).toEqual(new Set(["gemini-3.8-flash"]));
    expect(new Set(state.models.pplx)).toEqual(new Set(["sonar"]));
    expect(new Set(state.models.claude)).toEqual(new Set(["claude-haiku-4-5-20251001"]));
    expect(r.method).toEqual({ version: "v3", samples: 2, models: tools.CITATION_MODELS });
  });

  test("env overrides no longer change the model", async () => {
    process.env.OPENAI_SEARCH_MODEL = "gpt-something-else";
    process.env.GEMINI_MODEL = "gemini-flash-latest";
    await tools.checkCitationsRaw("pemba.ai", ["q1"], 1);
    expect(state.models.gpt).toEqual(["gpt-4.1-mini-2025-04-14"]);
    expect(state.models.gemini).toEqual(["gemini-3.8-flash"]);
    delete process.env.OPENAI_SEARCH_MODEL;
    delete process.env.GEMINI_MODEL;
  });
});

describe("5. Brand match", () => {
  const ex = (answer: string, citations: string[] = [], brand = "Pemba") => tools.extractCitationResult("pemba.ai", answer, citations, tools.brandRegex(brand));

  test("a single-word brand name counts as named on its own", () => {
    expect(ex("For this, Pemba is a good pick.")).toMatchObject({ cited: true, named: true });
    expect(ex("pemba tracks citations")).toMatchObject({ cited: true, named: true });
    expect(ex("Pembaroo and Acme are options.")).toMatchObject({ cited: false, named: false });
  });

  test("the domain written as plain text counts as named, even without brand_name", () => {
    expect(tools.extractCitationResult("pemba.ai", "Try pemba.ai for this.", [], null)).toMatchObject({ cited: true, named: true, sources: [] });
    expect(tools.extractCitationResult("pemba.ai", "Try www.pemba.ai.", [], null)).toMatchObject({ cited: true, named: true });
    expect(tools.extractCitationResult("pemba.ai", "See PEMBA.AI (AI visibility).", [], null)).toMatchObject({ cited: true, named: true });
  });

  test("lookalike domains do not count", () => {
    expect(tools.extractCitationResult("pemba.ai", "Try notpemba.ai or pemba.airline.com.", [], null)).toMatchObject({ cited: false, named: false });
  });

  test("a link (source or URL in the text) is linked, not named", () => {
    expect(ex("Answer text", ["https://pemba.ai/pricing"])).toMatchObject({ cited: true, named: false, sources: ["https://pemba.ai/pricing"] });
    expect(ex("Read https://www.pemba.ai/blog for more.")).toMatchObject({ cited: true, named: false });
  });

  test("brand names shorter than 3 characters are ignored", () => {
    expect(tools.brandRegex("AB")).toBeNull();
  });

  test("end to end: namedSamples counts the plain-text domain", async () => {
    state.answerText = "Pemba (pemba.ai) is worth a look.";
    const r = await tools.checkCitationsRaw("pemba.ai", ["q1"], 2, { brandName: "Pemba" });
    expect(r.chatgpt.results[0]).toMatchObject({ cited: true, citedSamples: 2, namedSamples: 2 });
  });
});

describe("/api/citations response", () => {
  function fakeRes() {
    const res: any = { statusCode: 0, body: undefined, headers: {} };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.end = () => res;
    return res;
  }

  test("keeps every existing field and adds valid, invalidReasons, method and per-engine coverage", async () => {
    state.shown.aio.add("q1");
    state.fail = { claude: { count: 1, kind: "429" } };
    const res = fakeRes();
    await handler(
      { method: "POST", headers: { authorization: `Bearer ${FAKE_ENV.PEMBA_API_KEY}` }, body: { domain: "pemba.ai", queries: ["q1", "q2"], samples: 3, brand_name: "Pemba" } } as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    const b = res.body;
    for (const k of ["domain", "queries", "samples", "brand_name", "location_code", "engines", "unavailable", "competitors", "costs", "cost_usd"]) expect(b).toHaveProperty(k);
    expect(Object.keys(b.engines).sort()).toEqual(["chatgpt", "claude", "gemini", "google_ai", "google_ai_mode", "perplexity"]);
    for (const e of Object.values(b.engines) as any[]) {
      for (const k of ["cited", "total", "citedSamples", "samples", "rate", "results", "expectedSamples", "gotSamples", "errors"]) expect(e).toHaveProperty(k);
    }
    expect(b.engines.claude).toMatchObject({ expectedSamples: 6, gotSamples: 5, errors: [{ reason: "rate limit" }] });
    expect(b.engines.google_ai).toMatchObject({ expectedSamples: 2, gotSamples: 2, aiAnswerShown: 1 });
    expect(b.engines.chatgpt.aiAnswerShown).toBeUndefined();
    expect(b.valid).toBe(true); // 5 of 6 = 83%
    expect(b.invalidReasons).toEqual([]);
    expect(b.method).toEqual({ version: "v3", samples: 3, models: tools.CITATION_MODELS });
    if (process.env.PRINT_EXAMPLE) console.log(JSON.stringify({ ...b, engines: { claude: b.engines.claude, google_ai: b.engines.google_ai } }, null, 2));
  });
});

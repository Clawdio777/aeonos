/**
 * One AEONOS agent run in its own process (17/11/2026), started by test/knowledge-model.test.ts. Its own process
 * because src/agent.ts loads src/tools.ts, which builds its Anthropic client on import, and citations.test.ts must mock
 * that SDK first. The model call is replaced and every HTTP call is faked (an unexpected URL throws), so nothing live
 * or paid runs. The token below is a fake. Prints one JSON line.
 *
 * argv[2] = knowledge feed mode: "404" (default), "ok", "throw" or "notoken".
 */
const mode = process.argv[2] ?? "404";
Object.assign(process.env, { SUPABASE_URL: "http://localhost:1", SUPABASE_SERVICE_KEY: "test-service", ANTHROPIC_API_KEY: "test-anthropic", PEMBA_API_KEY: "test-pemba" });
if (mode === "notoken") delete process.env.PEMBA_KNOWLEDGE_TOKEN;
else process.env.PEMBA_KNOWLEDGE_TOKEN = "fake-knowledge-token";

const warnings: string[] = [];
console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };

const CLINIC_HTML = `<!doctype html><html><head><title>Acme Osteopathy | Springfield</title></head><body>
<h1>Acme Osteopathy</h1><h2>Our services</h2><p>We treat back pain. Call us.</p></body></html>`;
const KNOWLEDGE = { knowledge: [{ category: "geo_strategy", title: "Answer first", insight: "Lead with the answer. Add a 40-60 word answer.", date: "2026-11-01" }] };
const pages: Record<string, { status: number; body?: string }> = {
  "https://acme.example/": { status: 200, body: CLINIC_HTML },
  "https://acme.example/llms.txt": { status: 404 },
  "https://acme.example/robots.txt": { status: 404 },
};
let knowledgeAuth: string | null = null;
let knowledgeCalls = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://pemba.ai/api/aeonos/knowledge") {
    knowledgeCalls++;
    knowledgeAuth = new Headers(init?.headers).get("authorization");
    if (mode === "throw") throw new DOMException("The operation timed out.", "TimeoutError");
    if (mode === "ok") return new Response(JSON.stringify(KNOWLEDGE), { status: 200 });
    return new Response("not found: secret detail", { status: 404 });
  }
  const p = pages[url];
  if (!p) throw new Error(`unexpected live call in test: ${url}`);
  return new Response(p.body ?? "", { status: p.status });
}) as typeof fetch;

const agent = await import("../src/agent.ts");
const models: string[] = [];
let system = "";
let turn = 0;
(agent.anthropic.messages as any).create = async (params: any) => {
  models.push(params.model);
  system = params.system;
  if (turn++ === 0) return { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "t1", name: "inspectSiteStructure", input: { url: "https://acme.example/", caller_id: "" } }] };
  return { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "## P1\n- Add an FAQ page.\n- Create an Acme vs Rival comparison page.\n- Write 1500-2500 words per page.\n- Add patient testimonials." }] };
};
const r = await agent.runAgent({ query: "Audit https://acme.example/", caller_id: "anon" });
console.log(JSON.stringify({
  models, response: r.response, agentModel: agent.AGENT_MODEL, warnings, knowledgeCalls,
  knowledgeAuthIsBearerToken: knowledgeAuth === "Bearer fake-knowledge-token",
  systemHasKnowledge: system.includes("knowledge base notes"), systemHasNote: system.includes("Lead with the answer."),
  systemHasRawRule: system.includes("Add a 40-60 word answer"), systemHasCleanedRule: system.includes("Add a short answer."),
}));

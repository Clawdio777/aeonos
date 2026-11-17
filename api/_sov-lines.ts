/**
 * Share-of-voice report lines that say what was checked, when and where (17/11/2026). Pure; kept apart from
 * share-of-voice.ts so tests can load it without the citation sampler (the "_" prefix keeps it off Vercel's routes).
 */
import type { CitationSnapshot } from "../src/tools.js";

const QUERY_ENGINES = [
  ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["googleAIO", "Google AIO"], ["googleAIMode", "Google AI Mode"], ["perplexity", "Perplexity"], ["claude", "Claude"],
] as const;

/**
 * Pure: one brand's line for one query. An engine with no answer for the query (not sampled, or every call failed) is
 * "not checked", never "not cited" (17/11/2026: a failed engine read as "not cited").
 */
export function queryLine(snap: CitationSnapshot, query: string): string {
  const cited: string[] = [], notCited: string[] = [], notChecked: string[] = [];
  for (const [k, label] of QUERY_ENGINES) {
    const r = snap[k].results.find((x) => x.query === query);
    (r === undefined ? notChecked : r.cited ? cited : notCited).push(label);
  }
  const parts = [cited.length ? `cited by ${cited.join(", ")}` : "", notCited.length ? `not cited by ${notCited.join(", ")}` : "", notChecked.length ? `not checked: ${notChecked.join(", ")}` : ""].filter(Boolean);
  return `${snap.domain}: ${parts.join("; ")}`;
}

/** Pure: when and where the answers were fetched, which engines weren't checked and why, and any invalid run. */
export function checkedLines(snapshots: CitationSnapshot[]): string[] {
  if (!snapshots.length) return [];
  const s0 = snapshots[0];
  const where = s0.method?.locations ? Object.entries(s0.method.locations).map(([k, v]) => `${k} ${v}`).join(", ") : "not recorded";
  const unavailable = new Map<string, string>();
  for (const s of snapshots) for (const [k, v] of Object.entries(s.unavailable ?? {})) unavailable.set(k, v);
  const invalid = snapshots.filter((s) => !s.valid).map((s) => `${s.domain}: ${s.invalidReasons.join("; ")}`);
  return [
    `Checked: ${s0.checkedAt} (answers fetched live this run). Asked from: ${where}.`,
    unavailable.size ? `Not checked: ${[...unavailable].map(([k, v]) => `${k} (${v})`).join(", ")}. These are unknown, not 0%.` : "",
    invalid.length ? `Incomplete run, treat with care: ${invalid.join(" | ")}` : "",
  ].filter(Boolean);
}

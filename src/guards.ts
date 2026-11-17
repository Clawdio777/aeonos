/**
 * guards.ts: code guards on what AEONOS tells a buyer to do (17/11/2026). Pure.
 *
 * Pemba Agent's review of the AEO method (Clawdio777/pemba#223): fixed word-count rules ("500+ words", "40-60 word
 * answers") are folklore, and health, legal and finance businesses were told to publish content their advertising
 * rules forbid (comparison pages for a clinic). These rules are enforced here as well as asked of the model, and match
 * Pemba's lib/fix-guards.ts so the paid audit and the public API say the same thing.
 */

// ── No word-count rules ──────────────────────────────────────────────────────
// No study shows a length that gets a page quoted. The advice under the rule stays ("lead with a direct answer");
// measured counts ("these pages are 199 to 251 words") are facts and stay.

/** A short-answer length rule: "40 to 60 word answer", "40-80 word paragraphs". */
const SHORT_RULE = /\b\d{1,3}\s*(?:to|-|–)\s*\d{1,3}[- ]word\b/gi;
/** A length target: "at least 500 words", "to 800+ words", "around 800 words", "500+ words". Not a measured "199 to 251 words". */
const LENGTH_TARGET = /(?:\s*\b(?:aim(?:ing)? for|at least|around|about|roughly|over|more than|minimum of|a minimum of|expand(?:ed)? to|to|of|with)\s+(?<!\d\s*(?:to|-|–)\s*))\d{3,4}\+?(?:\s*(?:to|-|–)\s*\d{3,4}\+?)?\s+words?\b|\b\d{3,4}\+\s*words?\b/gi;

/**
 * A range of words given as a target: "1500-2500 words", "(40-60 words)". Not when it reports what a page has: "are 199 to
 * 251 words", "is only 210 words" (the verb before it says it was measured). AEONOS addition to Pemba's two rules: its
 * stored knowledge says "(40-60 words)" and "1500-2500 words each" (17/11/2026).
 */
const RANGE_RULE = /(?<!\b(?:is|are|was|were|has|have|had|only|just|currently)\s+(?:only\s+)?)\(?\b\d{2,4}\s*(?:to|-|–)\s*\d{2,4}\+?\s*words?(?: each)?\b\)?/gi;

/** Pure: true when the text sets a word count as a target or rule. */
export const hasWordCountRule = (text: string) => [SHORT_RULE, LENGTH_TARGET, RANGE_RULE].some((r) => new RegExp(r.source, "i").test(text));

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);

/**
 * Pure: the text with word-count rules taken out, keeping the advice: "a 40 to 60 word answer" becomes "a short
 * answer", "Expand each page to 500+ words covering fees" becomes "Expand each page covering fees", and a sentence that
 * is only a length target ("Aim for around 800 words.") goes.
 */
export function withoutWordCountRules(text: string): string {
  if (!text) return text;
  return sentences(text).flatMap((sentence) => {
    if (!hasWordCountRule(sentence)) return [sentence];
    if (/^\s*(?:aim|try|target|write|keep)\b[^.]*\bwords?\b/i.test(sentence) && ![SHORT_RULE, RANGE_RULE].some((r) => new RegExp(r.source, "i").test(sentence))) return [];
    const out = sentence.replace(SHORT_RULE, "short").replace(LENGTH_TARGET, "").replace(RANGE_RULE, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    return out.split(/\s+/).length >= 4 ? [out] : [];
  }).join(" ");
}

// ── No unsourced impact figures ──────────────────────────────────────────────
// "80% AI visibility improvement", "3x more likely to be cited", "AI engines now handle a majority of informational
// queries": a figure about what a change does, or about the market, with no source given. Nobody measured it.

// Measured results this run ("cited in 40% of samples", "+20pp since last check") never match: they don't use these words.
const IMPACT_STAT = /\b\d{1,3}(?:\.\d+)?\s*%\s*(?:(?:ai )?visibility improvement|improvement|boost|lift|uplift|more likely|higher (?:chance|likelihood)|of (?:informational|ai|all) (?:queries|searches))|\b\d{1,2}(?:\.\d+)?\s*[x×]\s*(?:more likely|as likely|likelier|more citations)|\b(?:a )?majority of (?:all )?informational (?:queries|searches)\b/i;

/** Pure: true when the text gives an unsourced figure for what a change achieves (no link or "source:" in the sentence). */
export const hasImpactStat = (text: string) => IMPACT_STAT.test(text) && !/https?:\/\/|\bsource:/i.test(text);

/** Pure: the text without sentences that give an unsourced impact figure. */
export function withoutImpactStats(text: string): string {
  if (!text) return text;
  return sentences(text).filter((s) => !hasImpactStat(s)).join(" ");
}

// ── Regulated businesses: health, legal, financial ───────────────────────────
// Under AHPRA's advertising rules (Health Practitioner Regulation National Law s133) a regulated health service may not
// advertise with testimonials, comparisons that imply it is better than others, or claims about results. Australian
// solicitors' conduct rules (ASCR r36) bar false, misleading or deceptive advertising; ASIC's RG 234 says financial and
// credit advertising must not mislead on returns or risk. So for these businesses no advice suggests comparison or
// superiority content ("best clinic", "vs" pages), testimonials, case results or anything "guaranteed".

const HEALTH_RE = /\b(osteopath\w*|physiotherap\w*|physio|chiropract\w*|myotherap\w*|dentist\w*|dental|orthodont\w*|psycholog\w*|chinese medicine practi\w*|acupunctur\w*|general practi(?:ce|tioners?)|medical (?:centre|center|clinic|practice)|doctors? surgery|podiatr\w*|optometr\w*|occupational therap\w*|nurse practitioner\w*|ahpra)\b/i;
const LEGAL_RE = /\b(law firm|lawyers?|solicitors?|barristers?|attorneys?|legal (?:services|practice|advice)|conveyanc\w*|family law|criminal law|personal injury law|wills and estates|notary)\b/i;
const FINANCE_RE = /\b(financial (?:planners?|planning|advisers?|advisors?|advice|services)|wealth (?:management|advisers?)|mortgage brokers?|mortgage broking|accountants?|accounting|tax agents?|bookkeep\w*|insurance brokers?|investment (?:advisers?|advice|management)|superannuation|credit (?:providers?|advice)|stockbrok\w*|afsl|financial counsell\w*)\b/i;

export type RegulatedIndustry = { kind: "health" | "legal" | "financial"; name: string };

/**
 * Pure: the regulated trade the business practises, read from its page title and headings, or null. The inspected
 * page only: a blog post that mentions osteopathy is not a clinic, so callers pass the homepage when they have it.
 */
export function regulatedIndustry(page: { title: string; headings: string[] } | null | undefined): RegulatedIndustry | null {
  if (!page) return null;
  const text = `${page.title} ${page.headings.slice(0, 12).join(" ")}`;
  const h = text.match(HEALTH_RE);
  if (h) return { kind: "health", name: h[1].toLowerCase() };
  const l = text.match(LEGAL_RE);
  if (l) return { kind: "legal", name: l[1].toLowerCase() };
  const f = text.match(FINANCE_RE);
  return f ? { kind: "financial", name: f[1].toLowerCase() } : null;
}

const SUPERIORITY = /\b(?:best|leading|top[- ]rated|top|number one|no\.? ?1|#1|most trusted|award[- ]winning|better than)\s+(?:\w+\s+){0,2}(?:lawyers?|solicitors?|firms?|advisers?|advisors?|planners?|accountants?|brokers?|clinics?|practices?|practitioners?|doctors?|dentists?|osteopaths?|physios?|physiotherapists?|chiropractors?|therapists?|in (?:town|the city|australia))\b/i;
const AD_RISK = /\bvs\.?\s|\bversus\b|comparison pages?|compar(?:e|es|ing) (?:yourself|your (?:clinic|practice|firm|business|rates|fees))|\bhow (?:you|it) compares?\b|testimonials?|patient stories|client stories|success stories|case results|win rates?|success rates?|cases? won|reviews? on your (?:site|website|page)|before[- ]and[- ]after|guarantee[ds]?\b|\bguaranteeing\b|returns? of \d|risk[- ]free|outcomes? (?:you can expect|guaranteed)|cure[sd]?\b/i;

/** Pure: true when the text suggests content a health, legal or financial business may not advertise with. */
export const regulatedAdRisk = (text: string) => AD_RISK.test(text) || SUPERIORITY.test(text);

/** Pure: the text without any sentence suggesting comparison, superiority, testimonials, outcome claims or guarantees. */
export function withoutRegulatedAdRisk(text: string): string {
  if (!text) return text;
  return sentences(text).filter((s) => !regulatedAdRisk(s)).join(" ");
}

/** The line inspectSiteStructure writes when the page is a regulated business; the agent reads it back. */
export const regulatedLine = (r: RegulatedIndustry) => `**Regulated industry:** ${r.kind} (${r.name})`;
export function regulatedFromToolOutput(text: string): RegulatedIndustry | null {
  const m = text.match(/\*\*Regulated industry:\*\* (health|legal|financial) \(([^)]+)\)/);
  return m ? { kind: m[1] as RegulatedIndustry["kind"], name: m[2] } : null;
}

// ── Applying the guards to a whole answer ────────────────────────────────────

/**
 * Pure: the answer with every guard applied to its prose, line by line. Code blocks (JSON-LD, llms.txt) and table rows
 * are left as written; a list item or line left empty is dropped. `industry` adds the regulated-business guard.
 */
export function guardAnswer(text: string, industry: RegulatedIndustry | null = null): string {
  if (!text) return text;
  let inCode = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; out.push(line); continue; }
    if (inCode || /^\s*\|/.test(line) || !line.trim()) { out.push(line); continue; }
    const m = line.match(/^(\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)?(.*)$/)!;
    const prefix = m[1] ?? "";
    let body = withoutImpactStats(withoutWordCountRules(m[2]));
    if (industry) body = withoutRegulatedAdRisk(body);
    if (body.trim()) out.push(prefix + body);
  }
  return out.join("\n");
}

/** Pure: every string inside a knowledge entry with the word-count and impact-figure guards applied. */
export function guardKnowledge<T>(value: T): T {
  if (typeof value === "string") return withoutImpactStats(withoutWordCountRules(value)) as T;
  if (Array.isArray(value)) return value.map(guardKnowledge).filter((v) => v !== "") as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, guardKnowledge(v)])) as T;
  return value;
}

// ── Knowledge as the model sees it ───────────────────────────────────────────

/**
 * Pure: the knowledge notes as the model sees them: each with the date it was written, word-count rules and unsourced
 * impact figures removed, under a heading that says what they are and when they were fetched.
 */
export function formatKnowledge(entries: Array<{ category: string; title: string; insight: string; date?: string }>, fetchedAt: Date): string {
  if (!entries.length) return ''
  const formatted = entries
    .map(e => `[${e.category.toUpperCase().replace('_', ' ')}] ${e.title} (written ${e.date || 'date unknown'})\n${guardKnowledge(e.insight)}`)
    .join('\n\n')
  return `\n\n## AEO/GEO knowledge base notes (fetched ${fetchedAt.toISOString()})\nBackground notes, each dated. They are not measurements of the caller's site and not live data: never present them as findings, and never turn them into numbers about the site.\n\n${formatted}\n\n`
}

/**
 * Pure: knowledge entries as the model sees them (17/11/2026): background notes with their dates, word-count rules and
 * unsourced impact figures removed (the stored entries still carry some, e.g. "40-60 word answers", "80% AI visibility
 * improvement"), never evidence about the caller's site.
 */
export function formatSharedAEO(rows: Record<string, unknown>[]): string {
  return "AEONOS knowledge base: background notes, each with last_updated. Not evidence about the caller's site, not live data. " +
    "Don't repeat numeric targets from them as rules.\n" + JSON.stringify(guardKnowledge(rows), null, 2);
}

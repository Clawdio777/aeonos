/**
 * inspectSiteStructure — AEONOS Tool 6
 *
 * 10 functions that audit a URL for AI search visibility:
 *  1. HTML crawl + content extraction
 *  2. Schema extraction (JSON-LD, Microdata, RDFa)
 *  3. Schema gap analysis
 *  4. Schema template generation (copy-paste ready)
 *  5. E-E-A-T signals assessment
 *  6. Content freshness analysis
 *  7. PAA / Featured snippet check
 *  8. Conversational query optimisation
 *  9. llms.txt + robots.txt AI crawler rules
 * 10. Entity disambiguation scoring
 *
 * Uses fetch + cheerio. Playwright is not suitable for Vercel serverless —
 * add a headless proxy service if JS-rendered schema support is required.
 */

import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const CRAWLER_UA =
  "Mozilla/5.0 (compatible; AEONOS-SiteInspector/1.0; +https://aeonos.basechainlabs.com/bot)";
const PAGE_TIMEOUT = 15000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface CrawlData {
  url: string;
  domain: string;
  html: string;
  visibleText: string;
  headings: { level: number; text: string }[];
  pageType: "homepage" | "article" | "product" | "landing" | "other";
  first150Words: string;
  internalLinks: string[];
  title: string;
  metaDescription: string;
  wordCount: number;
}

export interface SchemaBlock {
  type: string;
  raw: object;
  source: "json-ld" | "microdata" | "rdfa";
  valid: boolean;
  errors: string[];
}

export interface SchemaGap {
  type: string;
  priority: "P1" | "P2" | "P3";
  reason: string;
}

export interface InspectResult {
  overallScore: number;
  schemaPresent: string[];
  schemaMissing: SchemaGap[];
  schemaTemplates: Record<string, string>;
  eatScore: number;
  eatGaps: { issue: string; priority: string }[];
  entityScore: number;
  entityGaps: string[];
  freshnessScore: number;
  freshnessDate: string | null;
  stalenessRisk: boolean;
  paaScore: number;
  paaGaps: string[];
  conversationalScore: number;
  conversationalIssues: string[];
  llmsTxt: {
    present: boolean;
    aiCrawlersBlocked: string[];
    robotsRules: string[];
    recommendations: string[];
  };
  p1Gaps: string[];
  p2Gaps: string[];
  p3Gaps: string[];
  auditTimestamp: string;
  deltaVsPreviousAudit?: Record<string, any>;
}

// ── Function 1: HTML Crawl + Content Extraction ─────────────────────────────

async function crawlPage(url: string): Promise<CrawlData> {
  const res = await fetch(url, {
    headers: { "User-Agent": CRAWLER_UA, Accept: "text/html" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Remove noise
  $("script, style, noscript, nav, footer, [aria-hidden='true']").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase() ?? "";
    const level = parseInt(tag.replace("h", ""), 10);
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });

  // Collect visible text from the body
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const words = visibleText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const first150Words = words.slice(0, 150).join(" ");

  // Page type inference
  const urlLower = url.toLowerCase();
  const isHomepage =
    /\/$/.test(urlLower) ||
    /^https?:\/\/[^/]+\/?$/.test(urlLower);
  const hasArticleSignal =
    !!$("article").length ||
    /\/(blog|post|article|news)\//i.test(urlLower) ||
    !!$('[class*="article"],[class*="blog"],[class*="post"]').length;
  const hasProductSignal =
    /\/(product|shop|store|buy)\//i.test(urlLower) ||
    !!$('[class*="product"],[itemtype*="Product"]').length;

  const pageType = isHomepage
    ? "homepage"
    : hasArticleSignal
    ? "article"
    : hasProductSignal
    ? "product"
    : headings.filter((h) => h.level === 1).length === 1 &&
      wordCount > 300
    ? "landing"
    : "other";

  // Internal links
  const domain = new URL(url).hostname;
  const internalLinks: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    try {
      const resolved = new URL(href, url);
      if (resolved.hostname === domain) internalLinks.push(resolved.pathname);
    } catch {}
  });

  return {
    url,
    domain,
    html,
    visibleText,
    headings,
    pageType,
    first150Words,
    internalLinks: [...new Set(internalLinks)].slice(0, 50),
    title,
    metaDescription,
    wordCount,
  };
}

// ── Function 2: Schema Extraction + Validation ───────────────────────────────

const REQUIRED_PROPS: Record<string, string[]> = {
  FAQPage: ["mainEntity"],
  Organization: ["name"],
  Person: ["name"],
  Article: ["headline", "author", "datePublished"],
  BlogPosting: ["headline", "author", "datePublished"],
  HowTo: ["name", "step"],
  BreadcrumbList: ["itemListElement"],
  WebSite: ["url"],
  Product: ["name"],
  Speakable: [],
  LocalBusiness: ["name", "address"],
  WebPage: ["name"],
  Event: ["name", "startDate"],
};

function validateSchemaBlock(raw: any, type: string): string[] {
  const required = REQUIRED_PROPS[type] ?? [];
  return required
    .filter((prop) => raw[prop] === undefined || raw[prop] === null || raw[prop] === "")
    .map((prop) => `Missing required property: ${prop}`);
}

function extractSchemas(html: string): SchemaBlock[] {
  const $ = cheerio.load(html);
  const blocks: SchemaBlock[] = [];

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html() || "{}");
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        if (!item["@type"]) continue;
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        for (const type of types) {
          const errors = validateSchemaBlock(item, type);
          blocks.push({ type, raw: item, source: "json-ld", valid: errors.length === 0, errors });
        }
      }
    } catch (e: any) {
      blocks.push({
        type: "Unknown",
        raw: {},
        source: "json-ld",
        valid: false,
        errors: [`JSON parse error: ${e.message}`],
      });
    }
  });

  // Microdata — extract @type from itemtype attribute
  $("[itemtype]").each((_, el) => {
    const itemtype = $(el).attr("itemtype") || "";
    const match = itemtype.match(/schema\.org\/(\w+)/);
    if (!match) return;
    const type = match[1];
    const raw: Record<string, string> = {};
    $(el)
      .find("[itemprop]")
      .each((_, prop) => {
        const name = $(prop).attr("itemprop") || "";
        raw[name] = $(prop).attr("content") || $(prop).text().trim();
      });
    const errors = validateSchemaBlock(raw, type);
    blocks.push({ type, raw, source: "microdata", valid: errors.length === 0, errors });
  });

  // RDFa — look for typeof attribute
  $("[typeof]").each((_, el) => {
    const typeofVal = $(el).attr("typeof") || "";
    const types = typeofVal.split(/\s+/);
    for (const rawType of types) {
      const type = rawType.replace(/^schema:/, "");
      if (!type) continue;
      const raw: Record<string, string> = {};
      $(el)
        .find("[property]")
        .each((_, prop) => {
          const name = ($(prop).attr("property") || "").replace(/^schema:/, "");
          raw[name] = $(prop).attr("content") || $(prop).text().trim();
        });
      const errors = validateSchemaBlock(raw, type);
      blocks.push({ type, raw, source: "rdfa", valid: errors.length === 0, errors });
    }
  });

  return blocks;
}

// ── Function 3: Schema Gap Analysis ─────────────────────────────────────────

function analyzeSchemaGaps(presentTypes: string[], pageType: string): SchemaGap[] {
  const gaps: SchemaGap[] = [];
  const has = (t: string) =>
    presentTypes.some((p) => p.toLowerCase() === t.toLowerCase());

  // P1 gaps — always required
  if (!has("FAQPage"))
    gaps.push({ type: "FAQPage", priority: "P1", reason: "FAQ schema is the single most impactful schema for AI citation. AI engines extract Q&A pairs directly from FAQPage markup." });

  if (pageType === "homepage" && !has("Organization"))
    gaps.push({ type: "Organization", priority: "P1", reason: "Organization schema on homepage establishes entity identity for all AI engines." });

  if ((pageType === "article" || pageType === "landing") && !has("Article") && !has("BlogPosting"))
    gaps.push({ type: "Article", priority: "P1", reason: "Article/BlogPosting schema on content pages signals authoritative content to AI engines." });

  if ((pageType === "article" || pageType === "landing") && !has("Speakable"))
    gaps.push({ type: "Speakable", priority: "P1", reason: "Speakable schema directly marks content for voice search and Google Assistant reading." });

  // P2 gaps
  if (!has("BreadcrumbList"))
    gaps.push({ type: "BreadcrumbList", priority: "P2", reason: "BreadcrumbList improves site hierarchy understanding for AI knowledge graph mapping." });

  if (!has("HowTo") && pageType !== "homepage")
    gaps.push({ type: "HowTo", priority: "P2", reason: "HowTo schema on instructional content significantly boosts PAA and featured snippet capture." });

  if (!has("Person") && (pageType === "article" || pageType === "landing"))
    gaps.push({ type: "Person", priority: "P2", reason: "Person schema for author attribution strengthens E-E-A-T signals." });

  // P3 gaps
  if (!has("WebSite"))
    gaps.push({ type: "WebSite", priority: "P3", reason: "WebSite schema with SearchAction enables sitelinks search box in SERPs." });

  return gaps;
}

// ── Function 4: Schema Template Generation ───────────────────────────────────

function generateSchemaTemplates(
  gaps: SchemaGap[],
  crawl: CrawlData
): Record<string, string> {
  const templates: Record<string, string> = {};
  const baseUrl = `https://${crawl.domain}`;
  const name =
    crawl.title.replace(/ [-|–].+$/, "").trim() ||
    crawl.domain.replace(/^www\./, "");

  for (const gap of gaps) {
    if (gap.priority === "P3") continue; // Only generate P1 + P2 templates

    if (gap.type === "FAQPage") {
      const questions = crawl.headings
        .filter((h) => h.level >= 2 && /^(how|what|why|when|who|is |can |does |will )/i.test(h.text))
        .slice(0, 5);

      const mainEntity =
        questions.length > 0
          ? questions.map((q) => ({
              "@type": "Question",
              name: q.text,
              acceptedAnswer: {
                "@type": "Answer",
                text: `[Add your answer to: ${q.text}]`,
              },
            }))
          : [
              {
                "@type": "Question",
                name: `What is ${name}?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `[Add a 40-60 word direct answer about ${name}]`,
                },
              },
              {
                "@type": "Question",
                name: `How does ${name} work?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "[Add a 40-60 word direct explanation]",
                },
              },
            ];

      templates["FAQPage"] = JSON.stringify(
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity },
        null,
        2
      );
    }

    if (gap.type === "Organization") {
      templates["Organization"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name,
          url: baseUrl,
          logo: `${baseUrl}/logo.png`,
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: `hello@${crawl.domain}`,
          },
          sameAs: ["[Add your LinkedIn URL]", "[Add your Twitter/X URL]"],
        },
        null,
        2
      );
    }

    if (gap.type === "Article" || gap.type === "BlogPosting") {
      templates["Article"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: crawl.title,
          author: { "@type": "Person", name: "[Author Name]" },
          publisher: {
            "@type": "Organization",
            name,
            logo: { "@type": "ImageObject", url: `${baseUrl}/logo.png` },
          },
          datePublished: new Date().toISOString().split("T")[0],
          dateModified: new Date().toISOString().split("T")[0],
          url: crawl.url,
          description: crawl.metaDescription || "[Add meta description]",
        },
        null,
        2
      );
    }

    if (gap.type === "Speakable") {
      templates["Speakable"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "WebPage",
          speakable: {
            "@type": "SpeakableSpecification",
            cssSelector: ["h1", ".speakable-intro", ".key-answer"],
          },
          url: crawl.url,
        },
        null,
        2
      );
    }

    if (gap.type === "HowTo") {
      templates["HowTo"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: crawl.title,
          step: crawl.headings
            .filter((h) => h.level === 2)
            .slice(0, 6)
            .map((h, i) => ({
              "@type": "HowToStep",
              position: i + 1,
              name: h.text,
              text: `[Add 2-3 sentence description for: ${h.text}]`,
            })),
        },
        null,
        2
      );
    }

    if (gap.type === "BreadcrumbList") {
      const parts = new URL(crawl.url).pathname
        .split("/")
        .filter(Boolean);
      const items = [
        { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
        ...parts.map((p, i) => ({
          "@type": "ListItem",
          position: i + 2,
          name: p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          item: `${baseUrl}/${parts.slice(0, i + 1).join("/")}`,
        })),
      ];
      templates["BreadcrumbList"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items,
        },
        null,
        2
      );
    }

    if (gap.type === "Person") {
      templates["Person"] = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Person",
          name: "[Author Full Name]",
          url: `${baseUrl}/about`,
          jobTitle: "[Job Title / Role]",
          worksFor: { "@type": "Organization", name },
          sameAs: ["[LinkedIn URL]", "[Twitter/X URL]"],
        },
        null,
        2
      );
    }
  }

  return templates;
}

// ── Function 5: E-E-A-T Signals Assessment ───────────────────────────────────

function assessEEAT(
  $: cheerio.CheerioAPI,
  crawl: CrawlData,
  schemas: SchemaBlock[]
): { score: number; gaps: { issue: string; priority: string }[] } {
  const gaps: { issue: string; priority: string }[] = [];
  let score = 100;

  const html = crawl.html.toLowerCase();
  const text = crawl.visibleText.toLowerCase();

  // Author attribution
  const hasAuthor =
    schemas.some((s) => s.type === "Article" || s.type === "BlogPosting") &&
    schemas.some((s) => s.raw && (s.raw as any).author) ||
    !!$('[class*="author"],[rel="author"],[itemprop="author"]').length ||
    /written by|by [A-Z][a-z]+ [A-Z]/i.test(crawl.visibleText);

  if (!hasAuthor && crawl.pageType === "article") {
    score -= 15;
    gaps.push({ issue: "No author attribution on content page — AI engines weight authoritative, attributed content higher", priority: "P1" });
  }

  // About page
  const hasAboutLink = crawl.internalLinks.some((l) => /about/i.test(l));
  if (!hasAboutLink) {
    score -= 10;
    gaps.push({ issue: "No /about page linked — About pages are a core E-E-A-T signal for entity authority", priority: "P2" });
  }

  // Contact information
  const hasContact =
    /contact|email|phone|tel:|mailto:/i.test(html) ||
    crawl.internalLinks.some((l) => /contact/i.test(l));
  if (!hasContact) {
    score -= 10;
    gaps.push({ issue: "No visible contact information — AI engines flag sites without contact details as lower trust", priority: "P2" });
  }

  // External authority links
  const externalLinks: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $<typeof el>(el as any).attr("href") || "";
    try {
      const u = new URL(href);
      if (u.hostname !== crawl.domain && u.protocol.startsWith("http")) {
        externalLinks.push(u.hostname);
      }
    } catch {}
  });
  if (externalLinks.length === 0 && crawl.pageType === "article") {
    score -= 10;
    gaps.push({ issue: "No external links to authoritative sources — citing sources is an E-E-A-T requirement for AI citation", priority: "P2" });
  }

  // Privacy + terms
  const hasPrivacy = crawl.internalLinks.some((l) => /privacy|terms/i.test(l));
  if (!hasPrivacy) {
    score -= 5;
    gaps.push({ issue: "No privacy policy or terms linked — required for trustworthy entity classification", priority: "P3" });
  }

  // Last modified visible
  const hasDateVisible = /updated|modified|published|last reviewed/i.test(text);
  if (!hasDateVisible && crawl.pageType === "article") {
    score -= 5;
    gaps.push({ issue: "No visible last-modified date — AI engines prefer content with explicit freshness signals", priority: "P3" });
  }

  return { score: Math.max(0, score), gaps };
}

// ── Function 6: Content Freshness Analysis ───────────────────────────────────

function analyzeContentFreshness(
  $: cheerio.CheerioAPI,
  schemas: SchemaBlock[]
): { score: number; date: string | null; stalenessRisk: boolean } {
  const dateStr =
    $('meta[property="article:modified_time"]').attr("content") ||
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="last-modified"]').attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    (() => {
      for (const s of schemas) {
        const raw = s.raw as any;
        if (raw.dateModified) return raw.dateModified;
        if (raw.datePublished) return raw.datePublished;
      }
      return null;
    })();

  if (!dateStr) return { score: 50, date: null, stalenessRisk: false };

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { score: 50, date: null, stalenessRisk: false };

  const ageMonths =
    (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30);

  let score = 100;
  if (ageMonths > 24) score = 30;
  else if (ageMonths > 12) score = 60;
  else if (ageMonths > 6) score = 80;

  return {
    score,
    date: date.toISOString().split("T")[0],
    stalenessRisk: ageMonths > 12,
  };
}

// ── Function 7: PAA / Featured Snippet Optimisation ─────────────────────────

function analyzePAA(crawl: CrawlData): { score: number; gaps: string[] } {
  const gaps: string[] = [];
  let score = 100;

  const questionHeadings = crawl.headings.filter(
    (h) => h.level >= 2 && /^(how|what|why|when|who|is |can |does |will |are )/i.test(h.text)
  );

  if (questionHeadings.length === 0) {
    score -= 40;
    gaps.push("No question-format headings (How/What/Why/When/Who). These are the primary PAA and featured snippet triggers.");
  } else if (questionHeadings.length < 3) {
    score -= 20;
    gaps.push(`Only ${questionHeadings.length} question heading(s). Aim for 4-6 to maximise PAA coverage.`);
  }

  // Check for direct answer paragraphs — heuristic: short paragraphs after H2s
  const h2Count = crawl.headings.filter((h) => h.level === 2).length;
  if (h2Count === 0) {
    score -= 20;
    gaps.push("No H2 subheadings. H2 structure is required for featured snippet and PAA extraction.");
  }

  // Word count check
  if (crawl.wordCount < 300) {
    score -= 20;
    gaps.push(`Page is only ${crawl.wordCount} words. Thin content is rarely featured. Minimum 600 words recommended.`);
  }

  if (gaps.length === 0) {
    // Check if any question headings could be improved
    const nonQuestionH2s = crawl.headings.filter(
      (h) => h.level === 2 && !/^(how|what|why|when|who|is |can |does |will |are )/i.test(h.text)
    );
    if (nonQuestionH2s.length > 0) {
      gaps.push(`${nonQuestionH2s.length} H2(s) are not question-format. Consider rewriting these as questions to capture more PAA slots.`);
      score -= 10;
    }
  }

  return { score: Math.max(0, score), gaps };
}

// ── Function 8: Conversational Query Optimisation ────────────────────────────

function analyzeConversational(
  crawl: CrawlData,
  targetQuery: string
): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;
  const text150 = crawl.first150Words.toLowerCase();

  // Does the opening define what this is, who it's for, what outcome it delivers?
  const definesWhat =
    /is a |is an |we are |we help |platform that |tool that |service that /i.test(
      crawl.first150Words
    );
  if (!definesWhat) {
    score -= 20;
    issues.push('Opening paragraph doesn\'t clearly define WHAT this is. First sentence should answer: "[Name] is a [category] that helps [ICP] [achieve outcome]."');
  }

  // Natural language vs keyword stuffing — rough check for word repetition
  const words150 = text150.split(/\s+/);
  const wordFreq: Record<string, number> = {};
  for (const w of words150) {
    if (w.length > 4) wordFreq[w] = (wordFreq[w] || 0) + 1;
  }
  const stuffed = Object.entries(wordFreq).filter(([, c]) => c > 4).map(([w]) => w);
  if (stuffed.length > 0) {
    score -= 15;
    issues.push(`Possible keyword stuffing: "${stuffed.slice(0, 3).join('", "')}" repeated heavily. Natural language reads better to AI engines and voice assistants.`);
  }

  // Voice search test — long sentences are hard to parse aloud
  const sentences = crawl.first150Words.split(/[.!?]/).filter((s) => s.trim().length > 0);
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 25);
  if (longSentences.length > 0) {
    score -= 15;
    issues.push("Sentences over 25 words detected in opening copy. Voice search answers must be speakable — break long sentences into shorter ones.");
  }

  // Does content relate to target query?
  if (targetQuery) {
    const queryWords = targetQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const queryMatches = queryWords.filter((w) => text150.includes(w)).length;
    if (queryMatches < Math.ceil(queryWords.length * 0.4)) {
      score -= 20;
      issues.push(`Page opening doesn't address the target query "${targetQuery}" clearly. AI engines match citation relevance based on semantic alignment with the query.`);
    }
  }

  return { score: Math.max(0, score), issues };
}

// ── Function 9: llms.txt + robots.txt ───────────────────────────────────────

const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "PerplexityBot",
  "Applebot",
  "GoogleOther",
  "CCBot",
  "anthropic-ai",
  "cohere-ai",
];

async function checkLlmsTxt(domain: string): Promise<{
  present: boolean;
  aiCrawlersBlocked: string[];
  robotsRules: string[];
  recommendations: string[];
}> {
  const base = `https://${domain}`;
  const recommendations: string[] = [];
  let present = false;
  const aiCrawlersBlocked: string[] = [];
  const robotsRules: string[] = [];

  // Check llms.txt
  try {
    const r = await fetch(`${base}/llms.txt`, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: AbortSignal.timeout(8000),
    });
    present = r.ok && r.status === 200;
  } catch {}

  if (!present) {
    recommendations.push("Create /llms.txt to guide AI crawlers. Without it, AI engines have no structured context about what your site is and who it serves. This is a P1 citation gap.");
  }

  // Check robots.txt for AI bot rules
  try {
    const r = await fetch(`${base}/robots.txt`, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const text = await r.text();
      const lines = text.split("\n");
      let currentAgent = "*";

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^User-agent:/i.test(trimmed)) {
          currentAgent = trimmed.replace(/^User-agent:\s*/i, "").trim();
        } else if (/^Disallow:/i.test(trimmed)) {
          const path = trimmed.replace(/^Disallow:\s*/i, "").trim();
          const matchedBot = AI_BOTS.find(
            (b) => b.toLowerCase() === currentAgent.toLowerCase()
          );
          if (matchedBot && path === "/") {
            aiCrawlersBlocked.push(matchedBot);
            robotsRules.push(`${matchedBot}: Disallow /`);
          } else if (currentAgent === "*" && path === "/") {
            robotsRules.push("All bots: Disallow /");
          }
        }
      }
    }
  } catch {}

  if (aiCrawlersBlocked.length > 0) {
    recommendations.push(
      `CRITICAL: ${aiCrawlersBlocked.join(", ")} blocked in robots.txt. These AI engines cannot crawl or cite your content. Remove these Disallow rules immediately.`
    );
  }

  return { present, aiCrawlersBlocked, robotsRules, recommendations };
}

// ── Function 10: Entity Disambiguation Scoring ───────────────────────────────

function scoreEntityDisambiguation(
  crawl: CrawlData,
  schemas: SchemaBlock[]
): { score: number; gaps: string[] } {
  const gaps: string[] = [];
  let score = 100;

  const text150 = crawl.first150Words.toLowerCase();
  const titleLower = crawl.title.toLowerCase();

  // Business name consistent across title, H1, schema
  const h1 = crawl.headings.find((h) => h.level === 1)?.text.toLowerCase() || "";
  const schemaName = schemas
    .find((s) => s.raw && (s.raw as any).name)
    ?.raw as any;
  const schemaNameVal = schemaName?.name?.toLowerCase() || "";

  const nameInTitle = !!titleLower;
  const nameInH1 = !!h1;
  if (!nameInTitle || !nameInH1) {
    score -= 15;
    gaps.push("Entity name missing from title tag or H1. Consistent entity naming across title, H1, and schema is the foundation of entity disambiguation.");
  }

  // ICP/audience defined in opening
  const hasAudienceSignal =
    /for (solopreneur|entrepreneur|small business|agency|startup|developer|marketer|creator|founder|brand)/i.test(
      crawl.first150Words
    );
  if (!hasAudienceSignal) {
    score -= 20;
    gaps.push('No clear audience definition in first 150 words. Add "for [specific ICP]" to your opening so AI engines can match your content to relevant queries.');
  }

  // Value proposition / outcome
  const hasOutcome =
    /(helps?|enables?|allows?|lets you|makes?|builds?|grows?|increases?|improves?|gets? you|achieve|save|reduce|earn|generate)/i.test(
      crawl.first150Words
    );
  if (!hasOutcome) {
    score -= 20;
    gaps.push("No outcome/benefit stated in first 150 words. AI engines extract entity purpose from this. Add: 'helps [ICP] achieve [specific outcome].'");
  }

  // Industry / category
  const hasCategory =
    /platform|tool|service|software|agency|consultant|app|system|solution/i.test(
      crawl.first150Words
    );
  if (!hasCategory) {
    score -= 15;
    gaps.push("Industry category not established in opening copy. AI knowledge graphs need a category anchor (platform, tool, service, etc.) to classify the entity.");
  }

  // Schema entity consistency
  if (schemaNameVal && h1 && !h1.includes(schemaNameVal) && !schemaNameVal.includes(h1.split(" ")[0])) {
    score -= 10;
    gaps.push("Entity name in schema doesn't match H1. Inconsistent naming confuses AI entity resolution. Align schema name, H1, and title tag.");
  }

  return { score: Math.max(0, score), gaps };
}

// ── Delta Computation ────────────────────────────────────────────────────────

function computeDelta(
  current: Omit<InspectResult, "deltaVsPreviousAudit">,
  previous: any
): Record<string, any> {
  if (!previous) return {};
  const delta: Record<string, any> = {};

  const scoreFields = [
    "overallScore",
    "eatScore",
    "entityScore",
    "freshnessScore",
    "paaScore",
    "conversationalScore",
  ] as const;

  for (const field of scoreFields) {
    const prev = previous[field];
    const curr = current[field as keyof typeof current];
    if (typeof prev === "number" && typeof curr === "number") {
      const diff = (curr as number) - prev;
      if (diff !== 0) delta[field] = { was: prev, now: curr, change: diff > 0 ? `+${diff}` : `${diff}` };
    }
  }

  const prevSchema: string[] = previous.schemaPresent ?? [];
  const newSchema = current.schemaPresent.filter((s) => !prevSchema.includes(s));
  const removedSchema = prevSchema.filter((s) => !current.schemaPresent.includes(s));
  if (newSchema.length) delta.schemaAdded = newSchema;
  if (removedSchema.length) delta.schemaRemoved = removedSchema;

  const prevP1 = (previous.p1Gaps ?? []).length;
  const currP1 = current.p1Gaps.length;
  if (prevP1 !== currP1) delta.p1GapsChange = { was: prevP1, now: currP1, change: currP1 - prevP1 };

  return delta;
}

// ── Main: runInspectSiteStructure ────────────────────────────────────────────

export async function runInspectSiteStructure(input: {
  url: string;
  caller_id: string;
  target_query?: string;
}): Promise<string> {
  const { url, caller_id, target_query = "" } = input;

  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return `Invalid URL: ${url}`;
  }

  // Crawl the page
  let crawl: CrawlData;
  try {
    crawl = await crawlPage(url);
  } catch (e: any) {
    return `Failed to crawl ${url}: ${e.message}`;
  }

  const $ = cheerio.load(crawl.html);

  // Run all 10 functions
  const schemas = extractSchemas(crawl.html);
  const presentTypes = [...new Set(schemas.map((s) => s.type))];
  const malformedSchemas = schemas.filter((s) => !s.valid);

  const gaps = analyzeSchemaGaps(presentTypes, crawl.pageType);
  const templates = generateSchemaTemplates(gaps, crawl);
  const { score: eatScore, gaps: eatGaps } = assessEEAT($, crawl, schemas);
  const {
    score: freshnessScore,
    date: freshnessDate,
    stalenessRisk,
  } = analyzeContentFreshness($, schemas);
  const { score: paaScore, gaps: paaGaps } = analyzePAA(crawl);
  const { score: conversationalScore, issues: conversationalIssues } =
    analyzeConversational(crawl, target_query);
  const llmsTxt = await checkLlmsTxt(domain);
  const { score: entityScore, gaps: entityGaps } =
    scoreEntityDisambiguation(crawl, schemas);

  // Aggregate P1/P2/P3 gaps across all functions
  const p1Gaps: string[] = [];
  const p2Gaps: string[] = [];
  const p3Gaps: string[] = [];

  for (const g of gaps) {
    (g.priority === "P1" ? p1Gaps : g.priority === "P2" ? p2Gaps : p3Gaps).push(
      `Missing ${g.type} schema: ${g.reason}`
    );
  }
  for (const s of malformedSchemas) {
    p1Gaps.push(`Malformed ${s.type} schema (${s.source}): ${s.errors.join("; ")}`);
  }
  for (const g of eatGaps) {
    (g.priority === "P1" ? p1Gaps : g.priority === "P2" ? p2Gaps : p3Gaps).push(g.issue);
  }
  if (entityScore < 60) p1Gaps.push(...entityGaps);
  else if (entityScore < 80) p2Gaps.push(...entityGaps);
  if (!llmsTxt.present) p1Gaps.push("No llms.txt found — AI crawlers lack structured context about your site");
  if (llmsTxt.aiCrawlersBlocked.length > 0)
    p1Gaps.push(...llmsTxt.recommendations);
  if (paaScore < 60) p1Gaps.push(...paaGaps);
  else if (paaScore < 80) p2Gaps.push(...paaGaps);
  if (conversationalScore < 60) p1Gaps.push(...conversationalIssues);
  else if (conversationalScore < 80) p2Gaps.push(...conversationalIssues);
  if (stalenessRisk) p2Gaps.push(`Content last updated ${freshnessDate} — refresh content to maintain AI engine trust`);

  // Overall score — weighted average
  const overallScore = Math.round(
    (eatScore * 0.2 +
      entityScore * 0.25 +
      freshnessScore * 0.1 +
      paaScore * 0.15 +
      conversationalScore * 0.15 +
      (llmsTxt.present ? 100 : 50) * 0.1 +
      (gaps.filter((g) => g.priority === "P1").length === 0 ? 100 : Math.max(0, 100 - gaps.filter((g) => g.priority === "P1").length * 25)) * 0.05)
  );

  const auditTimestamp = new Date().toISOString();

  // Fetch previous audit for delta
  let deltaVsPreviousAudit: Record<string, any> | undefined;
  try {
    const { data: existing } = await db
      .from("caller_memory")
      .select("audit_history, schema_state, entity_score, eat_score")
      .eq("caller_id", caller_id)
      .single();

    if (existing) {
      const history: any[] = existing.audit_history ?? [];
      const lastAudit = history[history.length - 1];
      if (lastAudit) {
        const resultForDelta: Omit<InspectResult, "deltaVsPreviousAudit"> = {
          overallScore,
          schemaPresent: presentTypes,
          schemaMissing: gaps,
          schemaTemplates: templates,
          eatScore,
          eatGaps,
          entityScore,
          entityGaps,
          freshnessScore,
          freshnessDate,
          stalenessRisk,
          paaScore,
          paaGaps,
          conversationalScore,
          conversationalIssues,
          llmsTxt,
          p1Gaps,
          p2Gaps,
          p3Gaps,
          auditTimestamp,
        };
        deltaVsPreviousAudit = computeDelta(resultForDelta, lastAudit);
      }
    }
  } catch {}

  // Build result
  const result: InspectResult = {
    overallScore,
    schemaPresent: presentTypes,
    schemaMissing: gaps,
    schemaTemplates: templates,
    eatScore,
    eatGaps,
    entityScore,
    entityGaps,
    freshnessScore,
    freshnessDate,
    stalenessRisk,
    paaScore,
    paaGaps,
    conversationalScore,
    conversationalIssues,
    llmsTxt,
    p1Gaps,
    p2Gaps,
    p3Gaps,
    auditTimestamp,
    deltaVsPreviousAudit,
  };

  // Persist to Supabase — append to audit_history, update score columns
  try {
    const { data: existing } = await db
      .from("caller_memory")
      .select("audit_history")
      .eq("caller_id", caller_id)
      .single();

    const prevHistory: any[] = (existing as any)?.audit_history ?? [];
    const auditEntry = {
      auditTimestamp,
      overallScore,
      eatScore,
      entityScore,
      freshnessScore,
      paaScore,
      conversationalScore,
      schemaPresent: presentTypes,
      p1Count: p1Gaps.length,
      p2Count: p2Gaps.length,
      url,
    };

    await db.from("caller_memory").upsert(
      {
        caller_id,
        audit_history: [...prevHistory, auditEntry].slice(-20), // keep last 20
        last_audit_timestamp: auditTimestamp,
        schema_state: { types: presentTypes, malformed: malformedSchemas.length },
        entity_score: entityScore,
        eat_score: eatScore,
        llms_txt_present: llmsTxt.present,
        updated_at: auditTimestamp,
      },
      { onConflict: "caller_id" }
    );
  } catch {}

  // Format output for the agent
  const deltaStr =
    deltaVsPreviousAudit && Object.keys(deltaVsPreviousAudit).length > 0
      ? `\n\n## DELTA VS PREVIOUS AUDIT\n${JSON.stringify(deltaVsPreviousAudit, null, 2)}`
      : "\n\n## DELTA VS PREVIOUS AUDIT\nFirst audit — no previous data to compare.";

  const templateStr =
    Object.keys(templates).length > 0
      ? `\n\n## SCHEMA TEMPLATES (copy-paste ready)\n` +
        Object.entries(templates)
          .map(([type, t]) => `### ${type}\n\`\`\`json\n${t}\n\`\`\``)
          .join("\n\n")
      : "";

  return `## inspectSiteStructure — ${url}

**Overall AI Visibility Score: ${overallScore}/100**
- E-E-A-T: ${eatScore}/100
- Entity Clarity: ${entityScore}/100
- Content Freshness: ${freshnessScore}/100 (last updated: ${freshnessDate ?? "unknown"})
- PAA Readiness: ${paaScore}/100
- Conversational: ${conversationalScore}/100
- Schema: ${presentTypes.length} types found (${malformedSchemas.length} malformed)
- llms.txt: ${llmsTxt.present ? "✅ Present" : "❌ Missing"}
- AI crawlers blocked: ${llmsTxt.aiCrawlersBlocked.length > 0 ? llmsTxt.aiCrawlersBlocked.join(", ") : "None"}

**Schema present:** ${presentTypes.join(", ") || "None"}

**P1 — Fix this week (${p1Gaps.length}):**
${p1Gaps.map((g) => `- ${g}`).join("\n") || "None"}

**P2 — Fix this month (${p2Gaps.length}):**
${p2Gaps.map((g) => `- ${g}`).join("\n") || "None"}

**P3 — Ongoing (${p3Gaps.length}):**
${p3Gaps.map((g) => `- ${g}`).join("\n") || "None"}
${templateStr}${deltaStr}`;
}

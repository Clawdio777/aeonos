/**
 * api/_x402-gate.ts — shared x402 v2 payment gate
 * Underscore prefix = Vercel does not expose this as a route.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { x402Version as X402_VERSION } from "@x402/core";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension } from "@x402/extensions";
import { declareBuilderCodeExtension, BUILDER_CODE_PATTERN } from "@x402/extensions/builder-code";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// ── Shared facilitator client (Coinbase CDP, Base mainnet) ────────────────────
// Fails closed: without the CDP keys there is no client and paid routes answer 500 "payments not
// configured". Before 22/10/2026 missing keys silently fell back to the default x402.org facilitator.
// .trim() is critical: Vercel env vars can have trailing newlines.
let facilitator: HTTPFacilitatorClient | undefined;

export function getFacilitatorClient(): HTTPFacilitatorClient | null {
  const name = process.env.CDP_API_KEY_NAME?.trim();
  const key  = process.env.CDP_API_KEY_PRIVATE_KEY?.trim();
  if (!name || !key) return null;
  facilitator ??= new HTTPFacilitatorClient(createFacilitatorConfig(name, key));
  return facilitator;
}

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = "payments not configured";

export function sendPaymentsNotConfigured(res: VercelResponse) {
  console.error("[aeonos] payments not configured: CDP_API_KEY_NAME / CDP_API_KEY_PRIVATE_KEY missing, paid request refused");
  return res.status(500).json({ error: PAYMENTS_NOT_CONFIGURED_MESSAGE });
}

const PAYMENT_ADDRESS = "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc";
const USDC_ASSET      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Build payment requirements for a given USDC price ─────────────────────────
export function buildPaymentReqs(priceUsdc: number): PaymentRequirements {
  return {
    scheme:            "exact",
    network:           "eip155:8453",
    amount:            String(Math.round(priceUsdc * 1_000_000)), // 6 decimals
    payTo:             (process.env.PAYMENT_ADDRESS || PAYMENT_ADDRESS).trim(),
    maxTimeoutSeconds: 600, // room to finish the work (up to 300 s) before settling
    asset:             USDC_ASSET,
    extra:             { name: "USD Coin", version: "2" },
  };
}

// ── Placeholder detection ─────────────────────────────────────────────────────
// Buyers who run the discovery example as-is pay for an answer about a fake site.
// Flag those calls and tell them how to resend with real values.
// Count them in query_log with: caller_id in PLACEHOLDER_CALLER_IDS or query ~* PLACEHOLDER_DOMAIN.
export const DISCOVERY_CALLER_ID_EXAMPLE = "YOUR-AGENT-OR-DOMAIN-ID";
const PLACEHOLDER_CALLER_IDS = new Set(["my-agent-id", DISCOVERY_CALLER_ID_EXAMPLE.toLowerCase()]);
const PLACEHOLDER_DOMAIN     = /\b(?:mysite|yoursite|your-site|example)\.(?:com|org|net)\b/i;

export function isPlaceholderCall(query: string, caller_id: string): boolean {
  return PLACEHOLDER_CALLER_IDS.has(caller_id.toLowerCase()) || PLACEHOLDER_DOMAIN.test(query);
}

export function withPlaceholderNotice(
  text: string, query: string, caller_id: string, endpoint: string,
  /** Override the resend body and real-result sample for routes whose body is not a single query string. */
  opts: { resendBody?: string; sample?: string } = {},
): string {
  if (!isPlaceholderCall(query, caller_id)) return text;
  const why = PLACEHOLDER_DOMAIN.test(query)
    ? "a placeholder site such as mysite.com), so the result below is not about your site."
    : `caller_id \`${caller_id}\`), which is shared by everyone who copies the example, so AEONOS cannot keep your site's history separate.`;
  return [
    `> **Heads up: this request used the example values from our listing** (${why}`,
    `> To get a real result, resend to \`POST ${endpoint}\` with your own URL and a stable caller_id, e.g. \`${opts.resendBody ?? '{"query": "Audit https://yourdomain.com for AI search visibility", "caller_id": "yourdomain.com"}'}\`.`,
    "> Reuse the same caller_id on every call: AEONOS remembers your site, keywords and past audits for that id.",
    `> ${opts.sample ?? "With a real URL you get results for your actual pages, e.g. a 0-100 AI visibility score with a P1/P2/P3 fix list."}`,
    "",
    text,
  ].join("\n");
}

// ── Build a Bazaar extension for a route ─────────────────────────────────────
export function buildBazaarExtension(opts: {
  serviceName: string;
  queryDescription: string;
  queryExample: string;
  outputExample: string;
  /** Replaces the default `query` field for routes whose body is not a single query string. */
  body?: { input: Record<string, unknown>; properties: Record<string, unknown>; required: string[] };
}) {
  const base = declareDiscoveryExtension({
    bodyType: "json",
    input: {
      ...(opts.body?.input ?? { query: opts.queryExample }),
      caller_id: DISCOVERY_CALLER_ID_EXAMPLE,
    },
    inputSchema: {
      properties: {
        ...(opts.body?.properties ?? { query: { type: "string", description: opts.queryDescription } }),
        caller_id: {
          type: "string",
          description: "Stable ID for your agent or the site you are working on (e.g. your domain). Reuse it on every call so AEONOS remembers your site and history. Replace the example value.",
        },
      },
      required: opts.body?.required ?? ["query"],
    },
    output: {
      example: { status: "completed", artifact: { parts: [{ type: "text", text: opts.outputExample }], index: 0 } },
      schema: {
        properties: {
          status:   { type: "string" },
          artifact: { type: "object" },
          tokens:   { type: "number" },
        },
      },
    },
  });

  return {
    bazaar: {
      ...base.bazaar,
      info: {
        ...base.bazaar.info,
        input: { ...base.bazaar.info.input, method: "POST" },
      },
      serviceName: opts.serviceName,
      tags: ["seo", "marketing", "analytics", "aeo", "geo", "ai-search", "seo-audit", "schema-markup", "llms-txt"],
      iconUrl: "https://aeonos.basechainlabs.com/aeonos-logo.jpg",
    },
  };
}

// ── Base Builder Code (ERC-8021) ─────────────────────────────────────────────
// Adds the "builder-code" declaration next to "bazaar" so the Coinbase facilitator writes
// AEONOS's code into each settlement transaction (onchain attribution on Base). Off until
// BUILDER_CODE is set; an invalid code is ignored rather than breaking the 402.
export function withBuilderCode(extensions: Record<string, unknown>): Record<string, unknown> {
  const code = (process.env.BUILDER_CODE || "").trim();
  if (!code || !BUILDER_CODE_PATTERN.test(code)) return extensions;
  return { ...extensions, "builder-code": declareBuilderCodeExtension(code) };
}

// ── send402 ───────────────────────────────────────────────────────────────────
export function send402(
  res: VercelResponse,
  paymentReqs: PaymentRequirements,
  bazaarExtension: Record<string, unknown>,
  resourceUrl: string,
  resourceDesc: string,
  errorReason?: string
) {
  const body: PaymentRequired = {
    x402Version: X402_VERSION,
    error:       errorReason ?? "payment-required",
    resource: { url: resourceUrl, description: resourceDesc, mimeType: "application/json" },
    accepts:    [paymentReqs],
    extensions: withBuilderCode(bazaarExtension),
  };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
  return res.status(402).json(body);
}

// ── Charge only after the work succeeds (22/10/2026) ─────────────────────────
// Before: the payment was settled first and the work ran after, so a failed run (model error, outage)
// left the buyer charged with nothing to show. Now: verifyPayment() checks the signed payment, the
// route does the work, and settlePayment() takes the money only once there is a result to deliver.
// If the work fails, sendNotCharged() tells the buyer nothing was taken and emails Carly.
export interface PendingPayment {
  /** Raw payment header, for query_log ("internal-bypass" for PayGated calls). */
  header: string;
  payload?: PaymentPayload;
  reqs?: PaymentRequirements;
}

// Returns the verified (not yet settled) payment, or null if a 402/500 was already sent.
export async function verifyPayment(
  req: VercelRequest,
  res: VercelResponse,
  priceUsdc: number,
  bazaarExtension: Record<string, unknown>,
  resourceUrl: string,
  resourceDesc: string
): Promise<PendingPayment | null> {
  // PayGated internal bypass — request already authenticated + billed via credit system
  const internalKey = req.headers["x-internal-key"] as string | undefined;
  if (internalKey && process.env.INTERNAL_API_KEY && internalKey === process.env.INTERNAL_API_KEY) {
    return { header: "internal-bypass" };
  }

  const paymentReqs = buildPaymentReqs(priceUsdc);
  const xPaymentHeader = (req.headers["payment-signature"] ?? req.headers["x-payment"]) as string | undefined;

  if (!xPaymentHeader) {
    send402(res, paymentReqs, bazaarExtension, resourceUrl, resourceDesc);
    return null;
  }

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(Buffer.from(xPaymentHeader, "base64").toString("utf8")) as PaymentPayload;
  } catch {
    send402(res, paymentReqs, bazaarExtension, resourceUrl, resourceDesc, "invalid_payment");
    return null;
  }

  const facilitatorClient = getFacilitatorClient();
  if (!facilitatorClient) {
    sendPaymentsNotConfigured(res);
    return null;
  }

  let verifyResult: { isValid: boolean; invalidReason?: string };
  try {
    verifyResult = await facilitatorClient.verify(paymentPayload, paymentReqs);
  } catch (e: any) {
    console.error("[aeonos] verify error:", e.message);
    res.status(500).json({ error: "Payment verification failed", detail: e.message });
    return null;
  }
  if (!verifyResult.isValid) {
    send402(res, paymentReqs, bazaarExtension, resourceUrl, resourceDesc, verifyResult.invalidReason);
    return null;
  }

  const payment = { header: xPaymentHeader, payload: paymentPayload, reqs: paymentReqs };
  if (!(await claimPayment(res, payment))) return null;
  return payment;
}

// ── One signed payment, one run ──────────────────────────────────────────────
// Settling after the work leaves a window where the same signed payment could be sent again (or in
// parallel) and get the work done twice. Each payment is claimed in payment_claims (primary key) before
// any work starts; a second claim is refused. If the claim can't be recorded, the work doesn't start.
// The id is the payer plus the authorisation's nonce (EIP-3009 `authorization` or Permit2
// `permit2Authorization`): the token contract accepts each payer+nonce once, so this is the payment's real
// identity however the JSON is re-encoded or re-signed. A hash of the raw JSON (the earlier version) could be
// dodged by reordering keys. Payloads without a nonce fall back to a key-sorted hash.
export function paymentId(payload: PaymentPayload): string {
  const p = (payload.payload ?? {}) as Record<string, any>;
  const auth = p.authorization ?? p.permit2Authorization;
  const from = typeof auth?.from === "string" ? auth.from.toLowerCase() : "";
  const nonce = auth?.nonce != null ? String(auth.nonce).toLowerCase() : "";
  const key = from && nonce ? `evm|${from}|${nonce}` : `raw|${canonicalJson(p)}`;
  return createHash("sha256").update(key).digest("hex");
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

let claimsDb: SupabaseClient | undefined;

// Returns true if this payment is new and now claimed; otherwise sends 409/503 and returns false.
export async function claimPayment(res: VercelResponse, p: PendingPayment): Promise<boolean> {
  if (!p.payload) return true;
  claimsDb ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { error } = await claimsDb.from("payment_claims").insert({ id: paymentId(p.payload) });
  if (!error) return true;
  if (error.code === "23505") {
    res.status(409).json({ status: "failed", charged: false, error: PAYMENT_ALREADY_USED_MESSAGE });
    return false;
  }
  console.error("[aeonos] payment claim failed:", error.message);
  res.status(503).json({ status: "failed", charged: false, error: NOT_CHARGED_MESSAGE });
  return false;
}

export type SettleOutcome =
  | { ok: true; paymentResponse?: string; pendingTransaction?: string }
  | { ok: false; reason: string };

// The facilitator broadcast the transaction but it isn't confirmed yet. It reports this either as a
// settle result or (on a non-200) as a thrown SettleError carrying the same fields.
export const SETTLEMENT_PENDING_REASON = "settlement_pending";

function pendingTransaction(r: unknown): string | undefined {
  if (typeof r !== "object" || r === null) return undefined;
  const { success, errorReason, transaction } = r as Partial<SettleResponse>;
  return !success && errorReason === SETTLEMENT_PENDING_REASON && transaction ? transaction : undefined;
}

// Takes the money. Call only once the result is ready to send. Internal (PayGated) calls are a no-op.
// If settlement fails the route withholds the result; Carly is told, since the work was done unpaid.
// "settlement_pending" is retried once with the identical payload (as x402ResourceServer's
// settleWithPendingRetry does). Still pending after that: the transaction was broadcast, so the buyer has
// most likely paid. The result is delivered (never "nothing was charged") and Carly gets the tx hash.
export async function settlePayment(p: PendingPayment, route: string, caller_id: string): Promise<SettleOutcome> {
  const { payload, reqs } = p;
  if (!payload || !reqs) return { ok: true };
  const client = getFacilitatorClient();
  let outcome: SettleOutcome;
  if (!client) {
    outcome = { ok: false, reason: "payments_not_configured" };
  } else {
    const attempt = async (): Promise<{ result?: SettleResponse; pendingTx?: string }> => {
      try {
        const result = await client.settle(payload, reqs);
        return { result, pendingTx: pendingTransaction(result) };
      } catch (e) {
        const pendingTx = pendingTransaction(e);
        if (pendingTx) return { pendingTx };
        throw e;
      }
    };
    let pendingTx: string | undefined;
    try {
      let a = await attempt();
      if (a.pendingTx) {
        pendingTx = a.pendingTx;
        a = await attempt();
        pendingTx = a.pendingTx;
      }
      if (pendingTx) outcome = { ok: true, pendingTransaction: pendingTx };
      else if (a.result?.success) outcome = { ok: true, paymentResponse: Buffer.from(JSON.stringify(a.result)).toString("base64") };
      else outcome = { ok: false, reason: a.result?.errorReason || "settlement_failed" };
    } catch (e: any) {
      console.error("[aeonos] settle error:", e.message);
      // A broadcast transaction followed by an error on the retry is still most likely paid.
      outcome = pendingTx ? { ok: true, pendingTransaction: pendingTx } : { ok: false, reason: "settlement_failed" };
    }
  }
  if (outcome.ok && outcome.pendingTransaction) {
    const tx = outcome.pendingTransaction;
    console.error(`[aeonos/${route}] settlement still pending after one retry, result delivered: ${tx}`);
    await alertCarly(
      `AEONOS: payment for a ${route} request is still pending (result delivered, reconcile tx)`,
      `A paying request to /api/${route} finished the work. The facilitator broadcast the payment but reported it as pending twice, so the result was delivered (the buyer has most likely paid).\n\nCaller: ${caller_id}\nTransaction: ${tx}\nCheck: https://basescan.org/tx/${tx}\nTime: ${new Date().toISOString()}\n\nReconcile: confirm the transaction landed and the USDC arrived. If it failed, the work was delivered unpaid.`,
    );
  } else if (!outcome.ok) {
    console.error(`[aeonos/${route}] settlement failed after the work succeeded, result withheld:`, outcome.reason);
    await alertCarly(
      `AEONOS: payment for a ${route} request failed to settle (result withheld)`,
      `A paying request to /api/${route} finished the work, but settling the payment failed, so the result was withheld and nothing was charged.\n\nCaller: ${caller_id}\nReason: ${outcome.reason}\nTime: ${new Date().toISOString()}\n\nIf this repeats, check the CDP facilitator and the Vercel logs for aeonos.`,
    );
  }
  return outcome;
}

export const PAYMENT_ALREADY_USED_MESSAGE =
  "This payment has already been used for a request. Sign a new payment to run another one. Nothing more was charged.";

export const NOT_CHARGED_MESSAGE =
  "AEONOS could not finish this request, so your payment was not taken. Nothing was charged. Please try again in a few minutes.";

// The work failed before settlement: the buyer keeps their money. Sends a clear message (no raw error)
// and alerts Carly so a run of failures is noticed the same day.
export async function sendNotCharged(res: VercelResponse, route: string, caller_id: string, err: unknown) {
  await alertPaidFailure(route, caller_id, err);
  return res.status(503).json({ status: "failed", charged: false, error: NOT_CHARGED_MESSAGE });
}

export async function alertPaidFailure(route: string, caller_id: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[aeonos/${route}] paid run failed, not charged:`, detail);
  await alertCarly(
    `AEONOS: a paid ${route} request failed (buyer not charged)`,
    `A paying request to /api/${route} failed before delivery, so the payment was not taken.\n\nCaller: ${caller_id}\nError: ${detail.slice(0, 500)}\nTime: ${new Date().toISOString()}\n\nIf this repeats, check the Vercel logs for aeonos.`,
  );
}

// Email (Resend) and Telegram, each sent only if its env vars are set. Never throws.
export async function alertCarly(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN, tgChat = process.env.TELEGRAM_CHAT_ID;
  await Promise.all([
    key && to && fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: (process.env.RESEND_FROM || "AEONOS <noreply@resend.dev>").trim(),
        to: to.trim(),
        subject,
        text,
      }),
      signal: AbortSignal.timeout(5_000),
    }).catch((e: any) => console.error("[aeonos] alert email failed:", e.message)),
    tgToken && tgChat && fetch(`https://api.telegram.org/bot${tgToken.trim()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgChat.trim(), text: `⚠️ ${subject}\n\n${text}`.slice(0, 4000) }),
      signal: AbortSignal.timeout(5_000),
    }).catch((e: any) => console.error("[aeonos] alert Telegram failed:", e.name)),
  ]);
}

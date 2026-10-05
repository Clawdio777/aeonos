/**
 * api/_x402-gate.ts — shared x402 v2 payment gate
 * Underscore prefix = Vercel does not expose this as a route.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { x402Version as X402_VERSION } from "@x402/core";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension } from "@x402/extensions";

// ── Shared facilitator client ──────────────────────────────────────────────────
export const facilitatorClient = new HTTPFacilitatorClient(
  process.env.CDP_API_KEY_NAME && process.env.CDP_API_KEY_PRIVATE_KEY
    ? createFacilitatorConfig(
        process.env.CDP_API_KEY_NAME.trim(),
        process.env.CDP_API_KEY_PRIVATE_KEY.trim()
      )
    : {}
);

const PAYMENT_ADDRESS = "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc";
const USDC_ASSET      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Build payment requirements for a given USDC price ─────────────────────────
export function buildPaymentReqs(priceUsdc: number): PaymentRequirements {
  return {
    scheme:            "exact",
    network:           "eip155:8453",
    amount:            String(Math.round(priceUsdc * 1_000_000)), // 6 decimals
    payTo:             (process.env.PAYMENT_ADDRESS || PAYMENT_ADDRESS).trim(),
    maxTimeoutSeconds: 300,
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

export function withPlaceholderNotice(text: string, query: string, caller_id: string, endpoint: string): string {
  if (!isPlaceholderCall(query, caller_id)) return text;
  const why = PLACEHOLDER_DOMAIN.test(query)
    ? "a placeholder site such as mysite.com), so the result below is not about your site."
    : `caller_id \`${caller_id}\`), which is shared by everyone who copies the example, so AEONOS cannot keep your site's history separate.`;
  return [
    `> **Heads up: this request used the example values from our listing** (${why}`,
    `> To get a real result, resend to \`POST ${endpoint}\` with your own URL and a stable caller_id, e.g. \`{"query": "Audit https://yourdomain.com for AI search visibility", "caller_id": "yourdomain.com"}\`.`,
    "> Reuse the same caller_id on every call: AEONOS remembers your site, keywords and past audits for that id.",
    "> With a real URL you get results for your actual pages, e.g. a 0-100 AI visibility score with a P1/P2/P3 fix list.",
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
      tags: ["aeo", "geo", "seo", "ai-search", "llms"],
      iconUrl: "https://aeonos.basechainlabs.com/aeonos-logo.jpg",
    },
  };
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
    extensions: bazaarExtension,
  };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
  return res.status(402).json(body);
}

// ── requirePayment ────────────────────────────────────────────────────────────
// Returns the payment header string if payment succeeded, null if 402 was sent.
export async function requirePayment(
  req: VercelRequest,
  res: VercelResponse,
  priceUsdc: number,
  bazaarExtension: Record<string, unknown>,
  resourceUrl: string,
  resourceDesc: string
): Promise<string | null> {
  // PayGated internal bypass — request already authenticated + billed via credit system
  const internalKey = req.headers["x-internal-key"] as string | undefined;
  if (internalKey && process.env.INTERNAL_API_KEY && internalKey === process.env.INTERNAL_API_KEY) {
    return "internal-bypass";
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

  let settleResult: { success: boolean; errorReason?: string; transaction?: string; network?: string };
  try {
    settleResult = await facilitatorClient.settle(paymentPayload, paymentReqs);
  } catch (e: any) {
    console.error("[aeonos] settle error:", e.message);
    res.status(500).json({ error: "Payment settlement failed", detail: e.message });
    return null;
  }
  if (!settleResult.success) {
    send402(res, paymentReqs, bazaarExtension, resourceUrl, resourceDesc, settleResult.errorReason);
    return null;
  }

  res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(settleResult)).toString("base64"));
  return xPaymentHeader;
}

/**
 * api/daily-summary.ts — AEONOS daily sales summary email
 *
 * Runs via Vercel cron at 11pm UTC (= 9am AEST).
 * Queries yesterday's query_log, sends a Resend email summary.
 *
 * Env vars required:
 *   CRON_SECRET      — Vercel auto-sends as Bearer token; set this on Vercel
 *   RESEND_API_KEY   — Resend API key
 *   NOTIFY_EMAIL     — where to send the summary (your email)
 *   RESEND_FROM      — optional sender (default: AEONOS <noreply@resend.dev>)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth check — Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Yesterday in UTC (the day we're summarising)
  const now = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setUTCDate(now.getUTCDate() - 1);
  yesterdayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(now);
  yesterdayEnd.setUTCHours(0, 0, 0, 0);

  const { data: rows, error } = await db
    .from("query_log")
    .select("caller_id, payment_usdc, payment_tx_hash, created_at")
    .gte("created_at", yesterdayStart.toISOString())
    .lt("created_at", yesterdayEnd.toISOString());

  if (error) {
    console.error("[daily-summary] DB error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  const totalQueries  = rows?.length ?? 0;
  const paidRows      = rows?.filter(r => Number(r.payment_usdc) > 0) ?? [];
  const x402Rows      = paidRows.filter(r => r.payment_tx_hash);
  const acpRows       = paidRows.filter(r => !r.payment_tx_hash);
  const totalUSDC     = paidRows.reduce((sum, r) => sum + Number(r.payment_usdc), 0);
  const uniqueCallers = new Set(rows?.map(r => r.caller_id)).size;

  // Format the date label in Melbourne time (AEST = UTC+10)
  const melbDate = new Date(yesterdayStart.getTime() + 10 * 60 * 60 * 1000);
  const dateLabel = melbDate.toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const subject = totalUSDC > 0
    ? `💰 AEONOS — $${totalUSDC.toFixed(2)} USDC earned ${dateLabel}`
    : `AEONOS — ${totalQueries} quer${totalQueries === 1 ? "y" : "ies"} on ${dateLabel}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin-bottom: 4px;">AEONOS Daily Summary</h2>
      <p style="color: #666; margin-top: 0;">${dateLabel}</p>
      <hr style="border: none; border-top: 1px solid #eee;" />

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Total queries</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${totalQueries}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Unique callers</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${uniqueCallers}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Paid queries</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${paidRows.length}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; padding-left: 16px;">— x402 (direct)</td>
          <td style="padding: 8px 0; text-align: right;">${x402Rows.length}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666; padding-left: 16px;">— ACP marketplace</td>
          <td style="padding: 8px 0; text-align: right;">${acpRows.length}</td>
        </tr>
        <tr style="border-top: 2px solid #111;">
          <td style="padding: 12px 0; font-weight: 700; font-size: 18px;">Total earned</td>
          <td style="padding: 12px 0; text-align: right; font-weight: 700; font-size: 18px; color: #16a34a;">$${totalUSDC.toFixed(2)} USDC</td>
        </tr>
      </table>

      ${totalQueries === 0
        ? `<p style="color: #999; font-size: 14px;">No activity yesterday — AEONOS is live and waiting.</p>`
        : ""}

      <hr style="border: none; border-top: 1px solid #eee;" />
      <p style="color: #aaa; font-size: 12px; margin: 0;">
        AEONOS · <a href="https://aeonos-fawn.vercel.app" style="color: #aaa;">aeonos-fawn.vercel.app</a>
      </p>
    </div>
  `;

  // Send via Resend
  const from    = process.env.RESEND_FROM || "AEONOS <noreply@resend.dev>";
  const to      = process.env.NOTIFY_EMAIL;

  if (!to) {
    console.error("[daily-summary] NOTIFY_EMAIL not set");
    return res.status(500).json({ error: "NOTIFY_EMAIL not set" });
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.text();
    console.error("[daily-summary] Resend error:", err);
    return res.status(500).json({ error: "Email send failed", detail: err });
  }

  console.log(`[daily-summary] Sent: ${subject}`);
  return res.json({ ok: true, subject, totalQueries, paidQueries: paidRows.length, totalUSDC });
}

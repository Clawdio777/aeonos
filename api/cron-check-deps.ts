/**
 * GET /api/cron-check-deps — weekly x402/A2A dependency version check
 *
 * Runs every Sunday 9am AEST (23:00 UTC Saturday).
 * Compares latest npm versions against the pinned versions in package.json.
 * Emails clawdio777@gmail.com if any package has a major or minor bump.
 *
 * Auth: Authorization: Bearer CRON_SECRET
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const CRON_SECRET = process.env.CRON_SECRET || "aeonos-cron-2026";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "clawdio777@gmail.com";

// Pinned versions from package.json at time of last skill update
// Update these when you intentionally upgrade the packages
const PINNED: Record<string, string> = {
  "@x402/core":       "2.14.0",
  "@x402/evm":        "2.14.0",
  "@x402/extensions": "2.14.0",
  "@x402/fetch":      "2.14.0",
  "@coinbase/x402":   "2.1.0",
};

async function getLatestVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json() as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.replace(/^[\^~]/, "").split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function bumpType(pinned: string, latest: string): "major" | "minor" | "patch" | "none" {
  const [pMaj, pMin] = parseSemver(pinned);
  const [lMaj, lMin] = parseSemver(latest);
  if (lMaj > pMaj) return "major";
  if (lMin > pMin) return "minor";
  return "none"; // patch bumps are not worth emailing about
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth check
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results: Array<{ pkg: string; pinned: string; latest: string | null; bump: string }> = [];

  for (const [pkg, pinned] of Object.entries(PINNED)) {
    const latest = await getLatestVersion(pkg);
    const bump   = latest ? bumpType(pinned, latest) : "unknown";
    results.push({ pkg, pinned, latest: latest ?? "fetch failed", bump });
  }

  const needsAttention = results.filter(r => r.bump === "major" || r.bump === "minor");

  if (needsAttention.length === 0) {
    console.log("[check-deps] All packages at expected versions. No email needed.");
    return res.json({ ok: true, checked: results, emailed: false });
  }

  // Build email
  const rows = results.map(r => {
    const icon = r.bump === "major" ? "🔴" : r.bump === "minor" ? "🟡" : "✅";
    return `<tr>
      <td style="padding:8px 12px;font-family:monospace">${r.pkg}</td>
      <td style="padding:8px 12px;text-align:center">${r.pinned}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:bold">${r.latest}</td>
      <td style="padding:8px 12px;text-align:center">${icon} ${r.bump}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#0071e3">⚠️ AEONOS — x402 Protocol Update Detected</h2>
      <p>One or more x402/A2A packages have a new version that may require the <strong>a2a-agent-builder skill</strong> to be reviewed and updated.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f5f5f7;color:#1d1d1f">
            <th style="padding:10px 12px;text-align:left">Package</th>
            <th style="padding:10px 12px">Pinned</th>
            <th style="padding:10px 12px">Latest</th>
            <th style="padding:10px 12px">Change</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:24px"><strong>What to do:</strong></p>
      <ol>
        <li>Check the changelog for any breaking API changes</li>
        <li>Tell Codi: <em>"The x402 packages have updated — review the a2a-agent-builder skill"</em></li>
        <li>Codi will check the latest docs, update the skill, and update the pinned versions in this cron</li>
      </ol>
      <p style="color:#888;font-size:12px;margin-top:32px">Sent by AEONOS weekly dep check · aeonos.basechainlabs.com</p>
    </div>
  `;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM || "AEONOS <noreply@basechainlabs.com>",
      to:      [NOTIFY_EMAIL],
      subject: `⚠️ x402 Protocol Update — ${needsAttention.length} package(s) need review`,
      html,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error("[check-deps] Email failed:", err);
    return res.status(500).json({ error: "Email failed", detail: err, results });
  }

  console.log(`[check-deps] Email sent — ${needsAttention.length} package(s) flagged`);

  return res.json({ ok: true, checked: results, emailed: true, flagged: needsAttention.map(r => r.pkg) });
}

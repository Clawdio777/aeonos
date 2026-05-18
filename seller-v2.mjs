/**
 * seller-v2.mjs — AEONOS ACP v2 event-driven provider runtime
 *
 * Spawns `acp events listen` internally, processes job events, calls the
 * AEONOS Vercel API, and submits deliverables back through the ACP CLI.
 *
 * Run directly:
 *   node ~/Projects/aeonos/seller-v2.mjs
 *
 * Or via launchd (see com.aeonos.seller.plist).
 *
 * Lifecycle:
 *   job.created        → wait for requirement message
 *   requirement msg    → store requirement; set-budget
 *   job.funded         → call AEONOS API → provider submit
 *   job.completed|rejected|expired → clean up state
 */

import { createInterface } from "readline";
import { execFileSync, execSync, spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Config ─────────────────────────────────────────────────────────────────────

const AEONOS_API   = "https://aeonos-fawn.vercel.app/api/agent";
const ACP_API      = "https://api.acp.virtuals.io";
const CHAIN_ID     = 8453;

// Resolve acp binary: env var → global install → nvm fallback
const ACP_BIN = process.env.ACP_BIN
  || (() => { try { return execSync("which acp", { encoding: "utf8" }).trim(); } catch { return null; } })()
  || "/Users/clawdiovandamme/.nvm/versions/node/v20.20.0/bin/acp";
const RESTART_DELAY_MS = 5_000;
const AEONOS_TIMEOUT_MS = 180_000; // 3 min — full audit can take a while
const ACP_TIMEOUT_MS    = 60_000;

// Offering name → USDC fee (must match offering.json jobFee values)
const OFFERING_FEES = {
  aeonos_aeo:       "1.00",
  aeonos_test:      "0.01",
  aeonos_schema:    "0.50",
  aeonos_llms_txt:  "0.50",
  aeonos_progress:  "0.75",
};

// Offering name → query wrapper (ensures correct output regardless of how buyer phrases their request)
const OFFERING_PROMPTS = {
  aeonos_aeo: (q) => q, // full strategy — pass through as-is
  aeonos_test: (q) =>
    `Quick AEO test — give me 3 immediate quick wins for: ${q}. Be brief and specific: just the top 3 actionable fixes, each with the exact change to make. No preamble.`,
  aeonos_schema: (q) =>
    `Generate complete, production-ready JSON-LD schema markup for: ${q}. Include all relevant schema types (Organization, LocalBusiness or Service, FAQPage with 5–7 Q&As, HowTo if applicable). Cross-reference with @id links. Mark all placeholder values clearly. Include a step-by-step implementation checklist.`,
  aeonos_llms_txt: (q) =>
    `Generate a complete llms.txt file for: ${q}. Use the full AEONOS llms.txt format with sections: brand summary, what we make/offer, key facts, target audience, differentiation, FAQs (8–10 Q&As in natural language), and brand voice. File should be under 2,000 words and deploy-ready.`,
  aeonos_progress: (q) =>
    `Generate a structured AEO progress report for: ${q}. Score each of the Four Layers (Technical/SXO, Content/AIO, Authority/GEO, Citation/AEO) from 0–100 with specific reasons. Identify the top 3 things working, the top 3 things broken, and give exactly 3 priority actions ranked by impact. Use the progress report format — not a strategy overview.`,
};

// Sweep: split USDC earnings — top up Pemba buyer wallet first, rest to personal wallet
const SWEEP_DEST      = "0x282d873b3737144b45c507320c12f22edfd51fe3"; // personal/business wallet
const PEMBA_WALLET    = "0x1E45B323B94Bfe39eac03E27431A6866193AcC1B"; // Pemba buyer wallet (pays for AEONOS calls)
const PEMBA_TARGET    = 5.00;  // USDC to keep in Pemba wallet (~5 wks of audits: 4×$0.75 + 1×$1.00)
const SWEEP_THRESHOLD = 10.00; // USDC — only sweep if AEONOS balance ≥ this
const USDC_CONTRACT   = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
const BASE_RPC        = "https://mainnet.base.org";

// Log directory — Railway uses /data/logs, Mac uses ~/Library/Logs/aeonos-seller
const LOG_DIR = process.env.LOG_DIR
  || join(homedir(), "Library", "Logs", "aeonos-seller");
mkdirSync(LOG_DIR, { recursive: true });

// ── Logging ────────────────────────────────────────────────────────────────────

function log(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.join(" ")}`;
  console.log(line);
  try {
    const date = ts.slice(0, 10);
    writeFileSync(join(LOG_DIR, `${date}.log`), line + "\n", { flag: "a" });
  } catch {}
}

function jobLog(jobId, ...args) {
  log(`[Job ${jobId ?? "?"}]`, ...args);
}

// ── Job state ──────────────────────────────────────────────────────────────────

/**
 * @type {Map<string, {
 *   chainId: number,
 *   requirement: {query: string, caller_id?: string} | null,
 *   budgetSet: boolean,
 *   submitted: boolean
 * }>}
 */
const jobs = new Map();

function getJob(jobId, chainId) {
  if (!jobs.has(jobId)) {
    jobs.set(jobId, { chainId: chainId ?? CHAIN_ID, requirement: null, offeringName: null, budgetSet: false, submitted: false });
  }
  return jobs.get(jobId);
}

// ── Event handler ──────────────────────────────────────────────────────────────

async function handleEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return; // not JSON (e.g. human-mode text)
  }

  const { jobId, chainId, availableTools = [], entry, status, roles = [] } = event;
  if (!jobId) return;

  // Only handle events where we're the provider
  if (!roles.includes("provider")) return;

  const job = getJob(jobId, chainId);

  // ── Store incoming requirement message ────────────────────────────────────
  if (entry?.kind === "message" && entry.contentType === "requirement") {
    try {
      job.requirement = typeof entry.content === "string"
        ? JSON.parse(entry.content)
        : entry.content;
    } catch {
      job.requirement = { query: String(entry.content) };
    }
    jobLog(jobId, "Requirement:", JSON.stringify(job.requirement).slice(0, 120));
  }

  // ── Set budget ──────────────────────────────────────────────────────────────
  if (availableTools.includes("set-budget") && !job.budgetSet) {
    job.budgetSet = true; // optimistic — reset on failure
    try {
      const fee = await resolveOfferingFee(jobId, job.chainId);
      jobLog(jobId, `Setting budget: ${fee} USDC`);
      const out = execFileSync(ACP_BIN, [
        "provider", "set-budget",
        "--job-id",   jobId,
        "--amount",   fee,
        "--chain-id", String(job.chainId),
      ], { encoding: "utf8", timeout: ACP_TIMEOUT_MS, env: acpEnv() });
      jobLog(jobId, "Budget set OK:", out.trim().slice(0, 120));
    } catch (e) {
      jobLog(jobId, "set-budget ERROR:", e.message.slice(0, 200));
      job.budgetSet = false; // allow retry on next event
    }
  }

  // ── Submit deliverable ──────────────────────────────────────────────────────
  if (availableTools.includes("submit") && status === "funded" && !job.submitted) {
    job.submitted = true;

    // Fetch requirement if we somehow missed it (e.g. process restarted mid-job)
    if (!job.requirement) {
      job.requirement = await fetchRequirementFallback(jobId, job.chainId);
    }

    const rawQuery  = job.requirement?.query     ?? "Provide an AEO/GEO strategy overview";
    const caller_id = job.requirement?.caller_id ?? `acp_${jobId.slice(0, 16)}`;

    // Apply offering-specific prompt wrapper so the correct output type is always delivered
    const offeringName = job.offeringName ?? "aeonos_aeo";
    const promptFn = OFFERING_PROMPTS[offeringName] ?? OFFERING_PROMPTS.aeonos_aeo;
    const query = promptFn(rawQuery);

    jobLog(jobId, `Offering: ${offeringName} | Calling AEONOS API. Query:`, query.slice(0, 100));
    try {
      const res = await fetch(AEONOS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, caller_id }),
        signal: AbortSignal.timeout(AEONOS_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`AEONOS API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
      }

      const data = await res.json();
      const deliverable = data.artifact?.parts?.[0]?.text
        ?? data.response
        ?? JSON.stringify(data);

      jobLog(jobId, `AEONOS response received (${deliverable.length} chars). Submitting...`);

      execFileSync(ACP_BIN, [
        "provider", "submit",
        "--job-id",     jobId,
        "--deliverable", deliverable,
        "--chain-id",   String(job.chainId),
      ], { encoding: "utf8", timeout: ACP_TIMEOUT_MS, env: acpEnv() });

      jobLog(jobId, "Submitted ✓");
      jobs.delete(jobId);
      sweepIfNeeded().catch(e => log("[Sweep] unhandled:", e.message));

    } catch (e) {
      jobLog(jobId, "Submit ERROR:", e.message.slice(0, 300));
      job.submitted = false; // allow retry
    }
  }

  // ── Clean up completed/rejected/expired jobs ───────────────────────────────
  if (["completed", "rejected", "expired"].includes(status) && !availableTools.length) {
    jobLog(jobId, `Job ${status} — cleaning up`);
    jobs.delete(jobId);
  }
}

// ── Fee resolution ─────────────────────────────────────────────────────────────

async function resolveOfferingFee(jobId, chainId) {
  // Try ACP REST API for the off-chain job description (which is the offering name)
  try {
    const res = await fetch(`${ACP_API}/jobs/${chainId}/${jobId}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = await res.json();
      // description = offering name, set by createJobFromOffering
      const name = data.description ?? data.offeringName;
      if (name && OFFERING_FEES[name]) {
        log(`[Fee] ${jobId} → ${name} = ${OFFERING_FEES[name]} USDC`);
        // Store offering name on the job for prompt injection at submit time
        const job = jobs.get(jobId);
        if (job) job.offeringName = name;
        return OFFERING_FEES[name];
      }
    }
  } catch {}

  // Fallback default
  log(`[Fee] ${jobId} → defaulting to ${OFFERING_FEES.aeonos_aeo} USDC`);
  return OFFERING_FEES.aeonos_aeo;
}

// ── Requirement fallback ───────────────────────────────────────────────────────

async function fetchRequirementFallback(jobId, chainId) {
  try {
    const out = execFileSync(ACP_BIN, [
      "job", "history",
      "--job-id",   jobId,
      "--chain-id", String(chainId),
      "--json",
    ], { encoding: "utf8", timeout: 15_000, env: acpEnv() });

    const data = JSON.parse(out);
    const reqEntry = data.entries?.find(
      (e) => e.kind === "message" && e.contentType === "requirement"
    );
    if (reqEntry) {
      try { return JSON.parse(reqEntry.content); }
      catch { return { query: reqEntry.content }; }
    }
  } catch (e) {
    log(`[Fallback] requirement fetch failed for ${jobId}:`, e.message.slice(0, 120));
  }
  return null;
}

// ── Sweeper ────────────────────────────────────────────────────────────────────

// Read USDC balance of any Base address via public RPC (no auth needed)
async function getUSDCBalance(address) {
  try {
    const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
    const res = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDC_CONTRACT, data }, "latest"] }),
    });
    const json = await res.json();
    if (!json.result || json.result === "0x") return 0;
    return parseInt(json.result, 16) / 1_000_000; // USDC = 6 decimals
  } catch {
    return 0;
  }
}

// Send USDC from the AEONOS ACP wallet to any address
function sendUSDC(toAddress, amount) {
  const units    = BigInt(Math.floor(amount * 1_000_000));
  const dest     = toAddress.slice(2).toLowerCase().padStart(64, "0");
  const amt      = units.toString(16).padStart(64, "0");
  const calldata = `0xa9059cbb${dest}${amt}`;
  const txOut = execFileSync(ACP_BIN, [
    "wallet", "send-transaction",
    "--chain-id", String(CHAIN_ID),
    "--to",   USDC_CONTRACT,
    "--data", calldata,
  ], { encoding: "utf8", timeout: 60_000, env: acpEnv() });
  return txOut.trim().slice(0, 120);
}

async function sweepIfNeeded() {
  try {
    const balOut = execFileSync(ACP_BIN, [
      "wallet", "balance", "--chain-id", String(CHAIN_ID),
    ], { encoding: "utf8", timeout: 30_000, env: acpEnv() });

    // Parse USDC row: "USDC  USD Coin  1.23  $1.23  0x833..."
    const match = balOut.match(/^USDC\s+\S+\s+([\d.]+)/m);
    if (!match) { log("[Sweep] Could not parse USDC balance"); return; }

    const balance = parseFloat(match[1]);
    if (balance < SWEEP_THRESHOLD) {
      log(`[Sweep] ${balance} USDC — below threshold, skipping`);
      return;
    }

    log(`[Sweep] ${balance} USDC ≥ ${SWEEP_THRESHOLD} — calculating split`);

    // Check how much Pemba wallet currently has, top it up to PEMBA_TARGET
    const pembaBalance = await getUSDCBalance(PEMBA_WALLET);
    const pembaTopup   = Math.max(0, parseFloat((PEMBA_TARGET - pembaBalance).toFixed(6)));
    const toPersonal   = parseFloat(Math.max(0, balance - pembaTopup).toFixed(6));

    log(`[Sweep] Pemba wallet has ${pembaBalance} USDC — topup ${pembaTopup}, personal ${toPersonal}`);

    // 1. Top up Pemba wallet if it needs it
    if (pembaTopup >= 0.01) {
      const tx1 = sendUSDC(PEMBA_WALLET, pembaTopup);
      log(`[Sweep] Pemba top-up ${pembaTopup} USDC. TX: ${tx1}`);
    } else {
      log(`[Sweep] Pemba wallet already funded (${pembaBalance} USDC) — skipping top-up`);
    }

    // 2. Send remainder to personal/business wallet
    if (toPersonal >= 0.01) {
      const tx2 = sendUSDC(SWEEP_DEST, toPersonal);
      log(`[Sweep] Personal sweep ${toPersonal} USDC. TX: ${tx2}`);
    } else {
      log(`[Sweep] Nothing left for personal wallet after Pemba top-up`);
    }
  } catch (e) {
    log("[Sweep] ERROR:", e.message.slice(0, 200));
  }
}

// ── ACP environment helper ─────────────────────────────────────────────────────

function acpEnv() {
  // On Railway: XDG dirs point to /data (persistent volume)
  // On Mac: fall back to system defaults
  return {
    ...process.env,
    HOME: process.env.HOME || homedir(),
    PATH: `${ACP_BIN.replace(/\/acp$/, "")}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    ...(process.env.XDG_CONFIG_HOME          && { XDG_CONFIG_HOME:          process.env.XDG_CONFIG_HOME          }),
    ...(process.env.XDG_DATA_HOME            && { XDG_DATA_HOME:            process.env.XDG_DATA_HOME            }),
    ...(process.env.ACP_CONFIG_DIR           && { ACP_CONFIG_DIR:           process.env.ACP_CONFIG_DIR           }),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS && { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }),
  };
}

// ── Event stream (auto-restart) ────────────────────────────────────────────────

function startEventStream() {
  log("Starting `acp events listen`...");

  const proc = spawn(ACP_BIN, ["events", "listen"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: acpEnv(),
  });

  const rl = createInterface({ input: proc.stdout, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) handleEvent(trimmed).catch((e) => log("handleEvent error:", e.message));
  });

  proc.stderr.on("data", (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) log("[acp stderr]", msg.slice(0, 200));
  });

  proc.on("exit", (code, signal) => {
    log(`acp events listen exited (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(startEventStream, RESTART_DELAY_MS);
  });

  proc.on("error", (e) => {
    log("acp events listen spawn error:", e.message);
    setTimeout(startEventStream, RESTART_DELAY_MS);
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

process.on("uncaughtException",  (e) => log("uncaughtException:", e.message, e.stack?.slice(0, 500)));
process.on("unhandledRejection", (e) => log("unhandledRejection:", String(e)));

log("AEONOS seller-v2 started. Logs:", LOG_DIR);
startEventStream();

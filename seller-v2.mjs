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

// Sweep: auto-transfer USDC earnings to personal Base wallet after each job
const SWEEP_DEST      = "0x282d873b3737144b45c507320c12f22edfd51fe3";
const SWEEP_THRESHOLD = 0.50; // USDC — only sweep if balance ≥ this
const USDC_CONTRACT   = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base

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
    jobs.set(jobId, { chainId: chainId ?? CHAIN_ID, requirement: null, budgetSet: false, submitted: false });
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

    const query     = job.requirement?.query     ?? "Provide an AEO/GEO strategy overview";
    const caller_id = job.requirement?.caller_id ?? `acp_${jobId.slice(0, 16)}`;

    jobLog(jobId, "Calling AEONOS API. Query:", query.slice(0, 80));
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

    log(`[Sweep] ${balance} USDC ≥ ${SWEEP_THRESHOLD} — sweeping to ${SWEEP_DEST}`);

    // Encode ERC-20 transfer(address,uint256) calldata
    const units   = BigInt(Math.floor(balance * 1_000_000)); // USDC = 6 decimals
    const dest    = SWEEP_DEST.slice(2).toLowerCase().padStart(64, "0");
    const amt     = units.toString(16).padStart(64, "0");
    const calldata = `0xa9059cbb${dest}${amt}`;

    const txOut = execFileSync(ACP_BIN, [
      "wallet", "send-transaction",
      "--chain-id", String(CHAIN_ID),
      "--to",   USDC_CONTRACT,
      "--data", calldata,
    ], { encoding: "utf8", timeout: 60_000, env: acpEnv() });

    log(`[Sweep] Done. TX: ${txOut.trim().slice(0, 120)}`);
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

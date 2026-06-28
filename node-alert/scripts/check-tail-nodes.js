import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

const DEFAULT_URL = "https://agora.pluralis.ai/";
const DEFAULT_ALERT_TO = "akhil.js33@gmail.com";
const DEFAULT_STATE_FILE = ".alert-state/tail-node-alert.json";
const DEFAULT_INTERVAL_MS = 60_000;
const PLURALIS_TAIL_THRESHOLD = 2;

function uniqueCleanNames(names) {
  const seen = new Set();
  const uniqueNames = [];

  for (const name of names) {
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    if (!cleanName) continue;

    const key = cleanName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(cleanName);
  }

  return uniqueNames;
}

export function filterAlertableNames(names) {
  return uniqueCleanNames(names).filter((name) => !/pluralis/i.test(name));
}

export function filterPluralisNames(names) {
  return uniqueCleanNames(names).filter((name) => /pluralis/i.test(name));
}

export function alertSignature(names) {
  return names
    .map((name) => String(name).replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("\n");
}

export function buildAlertState(rawNames) {
  const nonPluralisNames = filterAlertableNames(rawNames);
  const pluralisNames = filterPluralisNames(rawNames);
  const reasons = [];

  if (nonPluralisNames.length > 0) {
    reasons.push("nonPluralisTail");
  }
  if (pluralisNames.length > PLURALIS_TAIL_THRESHOLD) {
    reasons.push("pluralisTailCount");
  }

  return {
    nonPluralisNames,
    pluralisNames,
    pluralisThreshold: PLURALIS_TAIL_THRESHOLD,
    reasons
  };
}

export function alertStateSignature(alertState) {
  const parts = [];

  if (alertState.nonPluralisNames.length > 0) {
    parts.push(`nonPluralis:\n${alertSignature(alertState.nonPluralisNames)}`);
  }

  if (alertState.pluralisNames.length > alertState.pluralisThreshold) {
    parts.push(`pluralis>${alertState.pluralisThreshold}:\n${alertSignature(alertState.pluralisNames)}`);
  }

  return parts.join("\n\n");
}

export function shouldNotify(alertState, previousSignature) {
  const signature = alertStateSignature(alertState);
  if (!signature) {
    return { notify: false, signature: "" };
  }

  return {
    notify: signature !== previousSignature,
    signature
  };
}

export function machineNameFromCells(cells) {
  const [status, user, nodeId] = cells.map((cell) => String(cell || "").replace(/\s+/g, " ").trim());
  if (!/^online$/i.test(status)) return "";
  if (!/tail/i.test(nodeId)) return "";
  return `${user} ${nodeId}`.trim();
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
}

async function clickFirstVisible(page, candidates, description) {
  for (const candidate of candidates) {
    const locator = candidate();
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        await item.click({ timeout: 5_000 });
        return true;
      }
    }
  }
  throw new Error(`Could not find ${description}`);
}

async function fillFirstVisible(page, candidates, value, description) {
  for (const candidate of candidates) {
    const locator = candidate();
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) {
        await item.fill(value, { timeout: 5_000 });
        return true;
      }
    }
  }
  throw new Error(`Could not find ${description}`);
}

async function openNodesTab(page) {
  await clickFirstVisible(
    page,
    [
      () => page.getByRole("tab", { name: /^nodes$/i }),
      () => page.getByRole("link", { name: /^nodes$/i }),
      () => page.getByRole("button", { name: /^nodes$/i }),
      () => page.getByText(/^nodes$/i)
    ],
    "Nodes tab"
  );
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

async function setStatusOnline(page) {
  const statusButton = page.getByRole("button", { name: /^status:/i });
  await statusButton.waitFor({ state: "visible", timeout: 15_000 });
  await statusButton.click();

  await page.getByRole("button", { name: /^none$/i }).waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: /^none$/i }).click();
  await page.getByText(/^online$/i).last().click();
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll("button"))
      .some((button) => /^Status:\s*Online$/i.test(button.innerText.trim()));
  }, { timeout: 5_000 });
}

async function searchTail(page) {
  await fillFirstVisible(
    page,
    [
      () => page.getByPlaceholder(/filter by user/i),
      () => page.getByPlaceholder(/search|filter/i),
      () => page.getByLabel(/search|filter/i),
      () => page.locator('input[type="search"]'),
      () => page.locator('input[type="text"]')
    ],
    "Tail",
    "Nodes search/filter box"
  );
  await page.waitForTimeout(1_000);
}

async function extractMachineNames(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const names = Array.from(document.querySelectorAll("tbody tr"))
      .filter(isVisible)
      .map((row) => Array.from(row.querySelectorAll("td,th"))
        .map((cell) => cell.innerText.replace(/\s+/g, " ").trim()))
      .map((cells) => {
        const [status, user, nodeId] = cells;
        if (!/^online$/i.test(status || "")) return "";
        if (!/tail/i.test(nodeId || "")) return "";
        return `${user || ""} ${nodeId || ""}`.trim();
      })
      .filter(Boolean);

    return [...new Set(names)];
  });
}

export async function inspectTailNodes(options = {}) {
  const browser = await chromium.launch({
    headless: options.headless ?? true,
    args: ["--no-sandbox"]
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(options.url || DEFAULT_URL, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 30_000
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await openNodesTab(page);
    await setStatusOnline(page);
    await searchTail(page);
    const rawNames = await extractMachineNames(page);
    const alertState = buildAlertState(rawNames);

    return {
      rawNames,
      alertState
    };
  } finally {
    await browser.close();
  }
}

export function formatAlertEmail(alertState, checkedAt = new Date()) {
  const subjectParts = [];
  const bodyParts = [];

  if (alertState.nonPluralisNames.length > 0) {
    subjectParts.push(`${alertState.nonPluralisNames.length} non-Pluralis`);
    bodyParts.push(
      `${alertState.nonPluralisNames.length} Online Tail machine${alertState.nonPluralisNames.length === 1 ? "" : "s"} did not include Pluralis in the displayed name:`,
      "",
      ...alertState.nonPluralisNames.map((name) => `- ${name}`)
    );
  }

  if (alertState.pluralisNames.length > alertState.pluralisThreshold) {
    if (bodyParts.length > 0) bodyParts.push("");
    subjectParts.push(`${alertState.pluralisNames.length} Pluralis`);
    bodyParts.push(
      `${alertState.pluralisNames.length} Online Tail machine${alertState.pluralisNames.length === 1 ? "" : "s"} included Pluralis in the displayed name, above the threshold of ${alertState.pluralisThreshold}:`,
      "",
      ...alertState.pluralisNames.map((name) => `- ${name}`)
    );
  }

  const subject = `Agora Tail node alert: ${subjectParts.join(", ")}`;
  const body = [
    ...bodyParts,
    "",
    `Checked: ${checkedAt.toISOString()}`,
    `URL: ${DEFAULT_URL}`
  ].join("\n");

  return { subject, body };
}

async function sendAlertEmail({ alertState, smtp, dryRun }) {
  const { subject, body } = formatAlertEmail(alertState);

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, wouldEmail: true, subject, body }, null, 2));
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 465),
    secure: Number(smtp.port || 465) === 465,
    auth: {
      user: smtp.user,
      pass: smtp.password
    }
  });

  await transporter.sendMail({
    from: smtp.from || smtp.user,
    to: smtp.to || DEFAULT_ALERT_TO,
    subject,
    text: body
  });
}

function readSmtpFromEnv(env) {
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
    to: env.ALERT_TO || DEFAULT_ALERT_TO
  };
}

function assertSmtpConfig(smtp) {
  const missing = Object.entries({
    SMTP_HOST: smtp.host,
    SMTP_PORT: smtp.port,
    SMTP_USER: smtp.user,
    SMTP_PASSWORD: smtp.password,
    SMTP_FROM: smtp.from
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing SMTP config: ${missing.join(", ")}`);
  }
}

async function runOnce(options) {
  const state = await readJson(options.stateFile);
  const previousSignature = state.lastSignature || "";
  const inspection = await inspectTailNodes(options);
  const decision = shouldNotify(inspection.alertState, previousSignature);

  if (decision.notify) {
    if (!options.dryRun) {
      assertSmtpConfig(options.smtp);
    }
    await sendAlertEmail({
      alertState: inspection.alertState,
      smtp: options.smtp,
      dryRun: options.dryRun
    });
  }

  await writeJson(options.stateFile, {
    lastSignature: decision.signature,
    lastRawNames: inspection.rawNames,
    lastNonPluralisNames: inspection.alertState.nonPluralisNames,
    lastPluralisNames: inspection.alertState.pluralisNames,
    lastReasons: inspection.alertState.reasons,
    lastCheckedAt: new Date().toISOString()
  });

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    rawCount: inspection.rawNames.length,
    nonPluralisCount: inspection.alertState.nonPluralisNames.length,
    nonPluralisNames: inspection.alertState.nonPluralisNames,
    pluralisCount: inspection.alertState.pluralisNames.length,
    pluralisNames: inspection.alertState.pluralisNames,
    alertReasons: inspection.alertState.reasons,
    emailed: decision.notify && !options.dryRun,
    wouldEmail: decision.notify && options.dryRun,
    deduped: inspection.alertState.reasons.length > 0 && !decision.notify
  }, null, 2));
}

async function main() {
  const loopCount = Number(process.env.LOOP_COUNT || 1);
  const intervalMs = Number(process.env.CHECK_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const options = {
    dryRun: process.env.DRY_RUN === "1",
    headless: process.env.HEADLESS !== "0",
    stateFile: process.env.STATE_FILE || DEFAULT_STATE_FILE,
    smtp: readSmtpFromEnv(process.env),
    timeoutMs: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 30_000),
    url: process.env.AGORA_URL || DEFAULT_URL
  };

  for (let index = 0; index < loopCount; index += 1) {
    await runOnce(options);
    if (index < loopCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export const internals = {
  machineNameFromCells,
  PLURALIS_TAIL_THRESHOLD
};

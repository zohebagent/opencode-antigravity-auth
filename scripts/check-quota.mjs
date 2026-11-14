import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const CLOUD_CODE_BASE = "https://daily-cloudcode-pa.googleapis.com";
const USER_AGENT = "antigravity/hub/2.24.0 (aidev_client; os_type=darwin; arch=arm64; cl=1000335682)";
const FALLBACK_PROJECT_ID = "bamboo-precept-lgxtn";

function getDefaultAccountsPath() {
  if (process.env.OPENCODE_CONFIG_DIR) return join(process.env.OPENCODE_CONFIG_DIR, "antigravity-accounts.json");
  const xdgConfig = join(homedir(), ".config", "opencode", "antigravity-accounts.json");
  if (existsSync(xdgConfig)) return xdgConfig;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    const appDataConfig = join(appData, "opencode", "antigravity-accounts.json");
    if (existsSync(appDataConfig)) return appDataConfig;
  }
  return xdgConfig;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let path = getDefaultAccountsPath();
  let accountIndex = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--path" && args[i + 1]) {
      path = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--account" && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed)) {
        accountIndex = parsed - 1;
      }
      i += 1;
    }
  }
  return { path, accountIndex };
}

async function postJson(url, token, body, extraHeaders = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token refresh failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function loadProjectId(accessToken) {
  const body = { metadata: { ideType: "ANTIGRAVITY" } };
  const response = await postJson(`${CLOUD_CODE_BASE}/v1internal:loadCodeAssist`, accessToken, body);
  if (!response.ok) {
    return "";
  }
  const payload = await response.json();
  if (typeof payload.cloudaicompanionProject === "string") {
    return payload.cloudaicompanionProject;
  }
  if (payload.cloudaicompanionProject && typeof payload.cloudaicompanionProject.id === "string") {
    return payload.cloudaicompanionProject.id;
  }
  return "";
}

function classifyGroup(modelName) {
  const lower = modelName.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (!lower.includes("gemini")) return null;
  if (lower.includes("argon")) return "argon";
  if (lower.includes("flash")) return "gemini-flash";
  return "gemini-pro";
}

function updateGroup(groups, group, remainingFraction, resetTime) {
  const entry = groups[group] || { count: 0 };
  entry.count += 1;
  if (typeof remainingFraction === "number") {
    if (entry.remaining === undefined) {
      entry.remaining = remainingFraction;
    } else {
      entry.remaining = Math.min(entry.remaining, remainingFraction);
    }
  }
  if (resetTime) {
    const timestamp = Date.parse(resetTime);
    if (Number.isFinite(timestamp)) {
      if (!entry.resetTime) {
        entry.resetTime = resetTime;
      } else {
        const existing = Date.parse(entry.resetTime);
        if (!Number.isFinite(existing) || timestamp < existing) {
          entry.resetTime = resetTime;
        }
      }
    }
  }
  groups[group] = entry;
}

function createProgressBar(fraction, width = 34) {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    return `[\x1b[2m${"░".repeat(width)}\x1b[0m] ???%`;
  }
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const color = clamped >= 0.6 ? "\x1b[32m" : clamped >= 0.2 ? "\x1b[33m" : "\x1b[31m";
  return `[${color}${"█".repeat(filled)}\x1b[0m\x1b[2m${"░".repeat(empty)}\x1b[0m] ${(clamped * 100).toFixed(2)}%`;
}

function formatCountdown(resetTime, remainingFraction) {
  if (typeof remainingFraction === "number" && remainingFraction >= 1) {
    return "\x1b[32mQuota available\x1b[0m";
  }
  if (!resetTime) {
    return remainingFraction === 0 ? "\x1b[31mExhausted\x1b[0m" : "\x1b[32mQuota available\x1b[0m";
  }
  const target = Date.parse(resetTime);
  if (!Number.isFinite(target)) return "\x1b[32mQuota available\x1b[0m";
  const diff = target - Date.now();
  if (diff <= 0) return "\x1b[33mReset due\x1b[0m";
  const mins = Math.max(1, Math.ceil(diff / 60000));
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  const duration = hours > 0 ? `${hours}h ${m}m` : `${m}m`;
  const color = remainingFraction !== undefined && remainingFraction >= 0.6 ? "\x1b[32m" : remainingFraction !== undefined && remainingFraction < 0.2 ? "\x1b[31m" : "\x1b[33m";
  return `${color}Refreshes in ${duration}\x1b[0m`;
}

const CARD_LABELS = {
  "gemini-pro": { title: "GEMINI MODELS", subtitle: "Models within this group: Gemini Flash, Gemini Pro" },
  "gemini-flash": { title: "GEMINI MODELS", subtitle: "Models within this group: Gemini Flash, Gemini Pro" },
  argon: { title: "GEMINI 4 ARGON", subtitle: "Models within this group: Gemini 4 Argon" },
  claude: { title: "CLAUDE AND GPT MODELS", subtitle: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS" },
};

function windowName(entry, fallback) {
  if (!entry.resetTime) return fallback;
  const target = Date.parse(entry.resetTime);
  if (!Number.isFinite(target)) return fallback;
  return target - Date.now() > 24 * 3600_000 ? "Weekly Limit Remaining" : "Five Hour Limit Remaining";
}

function cardItems(key, entry) {
  if (!entry) return [];
  if (entry.weeklyRemaining !== undefined || entry.fiveHourRemaining !== undefined) {
    const items = [];
    if (entry.weeklyRemaining !== undefined) {
      items.push({ name: "Weekly Limit Remaining", fraction: entry.weeklyRemaining, resetTime: entry.weeklyResetTime });
    }
    if (entry.fiveHourRemaining !== undefined) {
      items.push({ name: "Five Hour Limit Remaining", fraction: entry.fiveHourRemaining, resetTime: entry.fiveHourResetTime });
    }
    return items;
  }
  return [{ name: windowName(entry, key === "claude" ? "Quota Remaining" : "Limit Remaining"), fraction: entry.remaining, resetTime: entry.resetTime }];
}

function printCard(title, subtitle, items) {
  if (items.length === 0) return;
  console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`);
  if (subtitle) console.log(`  \x1b[2m${subtitle}\x1b[0m\n`);
  for (const item of items) {
    console.log(`  ${item.name}`);
    console.log(`    ${createProgressBar(item.fraction)}`);
    console.log(`    ${formatCountdown(item.resetTime, item.fraction)}\n`);
  }
}

function printQuotaCards(groups) {
  const pro = groups["gemini-pro"];
  const flash = groups["gemini-flash"];
  const primary = pro ?? flash;
  if (primary) {
    const shared = primary.weeklyRemaining !== undefined || primary.fiveHourRemaining !== undefined;
    const items = shared
      ? cardItems("gemini-pro", primary)
      : [
          ...cardItems("gemini-flash", flash),
          ...cardItems("gemini-pro", pro),
        ];
    printCard(CARD_LABELS["gemini-pro"].title, CARD_LABELS["gemini-pro"].subtitle, items);
  }
  printCard(CARD_LABELS.argon.title, CARD_LABELS.argon.subtitle, cardItems("argon", groups.argon));
  printCard(CARD_LABELS.claude.title, CARD_LABELS.claude.subtitle, cardItems("claude", groups.claude));
}

async function run() {
  const { path, accountIndex } = parseArgs();
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const accounts = payload.accounts || [];

  if (accounts.length === 0) {
    console.log("No accounts found.");
    return;
  }

  const selected = accountIndex === null
    ? accounts.map((account, index) => ({ account, index }))
    : accounts
      .map((account, index) => ({ account, index }))
      .filter((item) => item.index === accountIndex);

  for (const { account, index } of selected) {
    const label = account.email || `Account ${index + 1}`;
    const disabled = account.enabled === false ? " (disabled)" : "";
    console.log(`\n${index + 1}. ${label}${disabled}`);

    try {
      const accessToken = await refreshAccessToken(account.refreshToken);
      let projectId = await loadProjectId(accessToken);
      if (!projectId) {
        projectId = account.managedProjectId || account.projectId || FALLBACK_PROJECT_ID;
      }
      console.log(`   project: ${projectId}`);

      const body = projectId ? { project: projectId } : {};
      const [modelsResp, userQuotaResp] = await Promise.all([
        postJson(`${CLOUD_CODE_BASE}/v1internal:fetchAvailableModels`, accessToken, body),
        postJson(`${CLOUD_CODE_BASE}/v1internal:retrieveUserQuotaSummary`, accessToken, body).catch(() => null),
      ]);
      console.log(`   fetchAvailableModels: ${modelsResp.status}`);
      if (userQuotaResp) {
        console.log(`   retrieveUserQuotaSummary: ${userQuotaResp.status}`);
      }

      if (!modelsResp.ok) {
        const text = await modelsResp.text().catch(() => "");
        console.log(`   error: ${text.trim().slice(0, 200)}`);
        continue;
      }

      const data = await modelsResp.json();
      const groups = {};
      const models = data.models || {};
      for (const [modelName, info] of Object.entries(models)) {
        const group = classifyGroup(modelName);
        if (!group) continue;
        if (!info || !info.quotaInfo) continue;
        const remaining = info.quotaInfo.remainingFraction ?? 0;
        updateGroup(groups, group, remaining, info.quotaInfo.resetTime);
      }

      if (userQuotaResp && userQuotaResp.ok) {
        const uqData = await userQuotaResp.json().catch(() => null);
        for (const uqGroup of uqData?.groups || []) {
          const buckets = uqGroup.buckets || [];
          let weeklyBucket = buckets.find(b => (b.window || "").toLowerCase() === "weekly" || (b.bucketId || "").toLowerCase().includes("weekly"));
          let fiveHourBucket = buckets.find(b => (b.window || "").toLowerCase() === "5h" || (b.bucketId || "").toLowerCase().includes("5h"));

          const groupName = (uqGroup.displayName || "").toLowerCase();
          const targetGroups = [];
          if (groupName.includes("argon")) targetGroups.push("argon");
          else if (groupName.includes("gemini")) targetGroups.push("gemini-pro", "gemini-flash");
          if (groupName.includes("claude") || groupName.includes("gpt")) targetGroups.push("claude");

          for (const target of targetGroups) {
            const entry = groups[target] || { count: 1 };
            if (weeklyBucket && typeof weeklyBucket.remainingFraction === "number") {
              entry.weeklyRemaining = weeklyBucket.remainingFraction;
              entry.weeklyResetTime = weeklyBucket.resetTime;
            }
            if (fiveHourBucket && typeof fiveHourBucket.remainingFraction === "number") {
              entry.fiveHourRemaining = fiveHourBucket.remainingFraction;
              entry.fiveHourResetTime = fiveHourBucket.resetTime;
            }
            if (entry.weeklyRemaining !== undefined && entry.fiveHourRemaining !== undefined) {
              entry.remaining = Math.min(entry.weeklyRemaining, entry.fiveHourRemaining);
            }
            groups[target] = entry;
          }
        }
      }

      printQuotaCards(groups);
    } catch (error) {
      console.log(`   error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

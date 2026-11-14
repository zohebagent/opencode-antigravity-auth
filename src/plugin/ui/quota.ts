import type { AccountSummary } from "../account-rpc.ts"
import type { AccountQuotaResult, QuotaGroup, QuotaGroupSummary } from "../quota.ts"
import { ANSI } from "./ansi.ts"

/** Format a cached quota and reset countdown for an account menu row. */
export function formatQuotaDescription(quota: AccountSummary["quota"], now = Date.now()): string {
  if (!quota) return "no quota data"
  const percent = Math.round(quota.remainingFraction * 100)
  const description = `${percent}%`
  if (percent >= 100 || !quota.resetTime) return description

  const resetAt = Date.parse(quota.resetTime)
  if (!Number.isFinite(resetAt)) return description
  const minutes = Math.ceil((resetAt - now) / 60_000)
  if (minutes <= 0) return `${description} · reset due`

  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor(minutes / 60) % 24
  const duration = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
  return `${description} · resets in ${duration}`
}

export interface ProgressBarOptions {
  width?: number
  ansi?: boolean
}

/**
 * Creates an Antigravity bracketed progress bar:
 * e.g. [█████████████░░░░░░░░░░░░░░░░░░░░░] 32.86%
 */
export function createProgressBar(fraction: number | undefined, options: ProgressBarOptions = {}): string {
  const width = options.width ?? 34
  const ansi = options.ansi ?? false

  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    const emptyBar = "░".repeat(width)
    return `[${ansi ? ANSI.dim : ""}${emptyBar}${ansi ? ANSI.reset : ""}] ???%`
  }

  const clamped = Math.max(0, Math.min(1, fraction))
  const filled = Math.round(clamped * width)
  const empty = width - filled
  const percentStr = `${(clamped * 100).toFixed(2)}%`

  if (!ansi) {
    return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${percentStr}`
  }

  const color = clamped >= 0.6 ? ANSI.green : clamped >= 0.2 ? ANSI.yellow : ANSI.red
  const filledBar = `${color}${"█".repeat(filled)}${ANSI.reset}`
  const emptyBar = `${ANSI.dim}${"░".repeat(empty)}${ANSI.reset}`
  return `[${filledBar}${emptyBar}] ${percentStr}`
}

/**
 * Formats countdown or availability status under a limit:
 * e.g. "Refreshes in 104h 11m" or "Quota available" or "Reset due"
 */
export function formatResetCountdown(
  resetTime?: string,
  remainingFraction?: number,
  now = Date.now(),
  ansi = false,
): string {
  const isFull = typeof remainingFraction === "number" && remainingFraction >= 1
  if (isFull || (!resetTime && remainingFraction !== 0)) {
    return ansi ? `${ANSI.green}Quota available${ANSI.reset}` : "Quota available"
  }

  if (resetTime) {
    const resetAt = Date.parse(resetTime)
    if (Number.isFinite(resetAt)) {
      const diffMs = resetAt - now
      if (diffMs <= 0) {
        return ansi ? `${ANSI.yellow}Reset due${ANSI.reset}` : "Reset due"
      }
      const totalMinutes = Math.max(1, Math.ceil(diffMs / 60_000))
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
      const text = `Refreshes in ${duration}`
      if (!ansi) return text
      const color = remainingFraction !== undefined && remainingFraction >= 0.6 ? ANSI.green : remainingFraction !== undefined && remainingFraction < 0.2 ? ANSI.red : ANSI.yellow
      return `${color}${text}${ANSI.reset}`
    }
  }

  if (remainingFraction === 0) {
    return ansi ? `${ANSI.red}Exhausted${ANSI.reset}` : "Exhausted"
  }

  return ansi ? `${ANSI.green}Quota available${ANSI.reset}` : "Quota available"
}

export interface QuotaCardItem {
  name: string
  remainingFraction?: number
  resetTime?: string
}

export interface QuotaCardGroup {
  title: string
  subtitle: string
  items: QuotaCardItem[]
}

/**
 * Formats structured quota card groups into the Antigravity /usage visual layout.
 */
export function formatQuotaCards(groups: QuotaCardGroup[], options: { ansi?: boolean; now?: number } = {}): string {
  const ansi = options.ansi ?? false
  const now = options.now ?? Date.now()
  const lines: string[] = []

  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx]!
    if (gIdx > 0) lines.push("")

    const titleLine = ansi ? `${ANSI.bold}${ANSI.cyan}${group.title}${ANSI.reset}` : group.title
    lines.push(titleLine)
    if (group.subtitle) {
      const subtitleLine = ansi ? `  ${ANSI.dim}${group.subtitle}${ANSI.reset}` : `  ${group.subtitle}`
      lines.push(subtitleLine)
    }
    lines.push("")

    for (let iIdx = 0; iIdx < group.items.length; iIdx++) {
      const item = group.items[iIdx]!
      if (iIdx > 0) lines.push("")
      lines.push(`  ${item.name}`)
      lines.push(`    ${createProgressBar(item.remainingFraction, { width: 34, ansi })}`)
      lines.push(`    ${formatResetCountdown(item.resetTime, item.remainingFraction, now, ansi)}`)
    }
  }

  return lines.join("\n")
}

export type QuotaTone = "success" | "warning" | "error" | "muted"

/** Maps a remaining fraction to the same thresholds the CLI report uses. */
export function quotaTone(fraction: number | undefined): QuotaTone {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "muted"
  if (fraction >= 0.6) return "success"
  if (fraction >= 0.2) return "warning"
  return "error"
}

export type QuotaReportLine =
  | { kind: "blank" }
  | { kind: "title"; text: string }
  | { kind: "bar"; indent: number; filled: string; empty: string; percent: string; tone: QuotaTone }
  | { kind: "status"; indent: number; text: string; tone: QuotaTone }
  | { kind: "text"; indent: number; text: string }

const QUOTA_BAR_LINE = /^(\s*)\[([█]*)([░]*)\]\s+(\d+(?:\.\d+)?%|\?\?\?%)$/

/**
 * Parses one line of a formatted quota report so interactive renderers can
 * color it without re-deriving the numbers. Unknown lines fall back to `text`,
 * so a format change degrades to plain output instead of an error.
 */
export function parseQuotaLine(line: string): QuotaReportLine {
  if (line.trim().length === 0) return { kind: "blank" }

  const bar = QUOTA_BAR_LINE.exec(line)
  if (bar) {
    const percent = bar[4]!
    const fraction = percent === "???%" ? undefined : Number.parseFloat(percent) / 100
    return { kind: "bar", indent: bar[1]!.length, filled: bar[2]!, empty: bar[3]!, percent, tone: quotaTone(fraction) }
  }

  const text = line.trim()
  const indent = line.length - line.trimStart().length
  if (text === "Quota available") return { kind: "status", indent, text, tone: "success" }
  if (text === "Exhausted") return { kind: "status", indent, text, tone: "error" }
  if (text === "Reset due") return { kind: "status", indent, text, tone: "warning" }
  if (text.startsWith("Refreshes in ")) return { kind: "status", indent, text, tone: "muted" }
  if (indent === 0 && /[A-Z]/.test(text) && text === text.toUpperCase()) return { kind: "title", text }
  return { kind: "text", indent, text }
}

interface QuotaCardSpec {
  title: string
  subtitle: string
  fallbackName: string
}

const CARD_SPECS: Record<QuotaGroup, QuotaCardSpec> = {
  claude: {
    title: "CLAUDE AND GPT MODELS",
    subtitle: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
    fallbackName: "Quota Remaining",
  },
  "gemini-pro": {
    title: "GEMINI MODELS",
    subtitle: "Models within this group: Gemini Flash, Gemini Pro",
    fallbackName: "Gemini Pro Limit Remaining",
  },
  "gemini-flash": {
    title: "GEMINI MODELS",
    subtitle: "Models within this group: Gemini Flash, Gemini Pro",
    fallbackName: "Gemini Flash Limit Remaining",
  },
  argon: {
    title: "GEMINI 4 ARGON",
    subtitle: "Models within this group: Gemini 4 Argon",
    fallbackName: "Argon Limit Remaining",
  },
}

type LimitWindow = "weekly" | "five_hour" | "unknown"

/** Infers the limiting window from how far away the reset is. */
function classifyWindow(group: QuotaGroupSummary, now: number): LimitWindow {
  if (!group.resetTime) return "unknown"
  const resetAt = Date.parse(group.resetTime)
  if (!Number.isFinite(resetAt)) return "unknown"
  return resetAt - now > 24 * 3600_000 ? "weekly" : "five_hour"
}

function windowLabel(window: LimitWindow, fallback: string): string {
  if (window === "weekly") return "Weekly Limit Remaining"
  if (window === "five_hour") return "Five Hour Limit Remaining"
  return fallback
}

/** Rows for the authoritative weekly/5-hour summary, when available. */
function summaryItems(group: QuotaGroupSummary): QuotaCardItem[] | undefined {
  const hasWindows = group.weeklyRemainingFraction !== undefined || group.fiveHourRemainingFraction !== undefined
  if (!hasWindows) return undefined
  const items: QuotaCardItem[] = []
  if (group.weeklyRemainingFraction !== undefined) {
    items.push({
      name: "Weekly Limit Remaining",
      remainingFraction: group.weeklyRemainingFraction,
      resetTime: group.weeklyResetTime,
    })
  }
  if (group.fiveHourRemainingFraction !== undefined) {
    items.push({
      name: "Five Hour Limit Remaining",
      remainingFraction: group.fiveHourRemainingFraction,
      resetTime: group.fiveHourResetTime,
    })
  }
  return items
}

/** One row for a group that only has an aggregate remaining fraction. */
function aggregateItem(group: QuotaGroupSummary, fallbackName: string, now: number, exactName = false): QuotaCardItem {
  return {
    name: exactName ? fallbackName : windowLabel(classifyWindow(group, now), fallbackName),
    remainingFraction: group.remainingFraction,
    resetTime: group.resetTime,
  }
}

function groupItems(group: QuotaGroupSummary, fallbackName: string, now: number): QuotaCardItem[] {
  return summaryItems(group) ?? [aggregateItem(group, fallbackName, now)]
}

/**
 * Rows for the shared Gemini Pro/Flash card. The summary endpoint reports one
 * pair of windows for both models; without it the per-model aggregates are
 * kept apart so a real difference is never hidden.
 */
function geminiItems(
  pro: QuotaGroupSummary | undefined,
  flash: QuotaGroupSummary | undefined,
  now: number,
): QuotaCardItem[] {
  const withWindows = summaryItems(pro ?? flash ?? { modelCount: 0 })
  if (withWindows) return withWindows
  if (pro && flash) {
    const identical = pro.remainingFraction === flash.remainingFraction && pro.resetTime === flash.resetTime
    if (identical) return [aggregateItem(flash, "Quota Remaining", now)]
    const proWindow = classifyWindow(pro, now)
    const flashWindow = classifyWindow(flash, now)
    if (flashWindow === "weekly" && proWindow !== "weekly") {
      return [aggregateItem(flash, CARD_SPECS["gemini-flash"].fallbackName, now), aggregateItem(pro, CARD_SPECS["gemini-pro"].fallbackName, now)]
    }
    if (proWindow === "weekly" && flashWindow !== "weekly") {
      return [aggregateItem(pro, CARD_SPECS["gemini-pro"].fallbackName, now), aggregateItem(flash, CARD_SPECS["gemini-flash"].fallbackName, now)]
    }
    return [aggregateItem(flash, CARD_SPECS["gemini-flash"].fallbackName, now, true), aggregateItem(pro, CARD_SPECS["gemini-pro"].fallbackName, now, true)]
  }
  const only = pro ?? flash
  return only ? [aggregateItem(only, CARD_SPECS[pro ? "gemini-pro" : "gemini-flash"].fallbackName, now)] : []
}

/**
 * Builds the Antigravity /usage card groups from an AccountQuotaResult and
 * renders the report. Gemini Pro and Flash share the same weekly and 5-hour
 * buckets, so they collapse into one card unless only per-model aggregates
 * exist. Argon has its own weekly bucket and is kept separate.
 */
export function formatAccountQuotaReport(
  result: AccountQuotaResult,
  options: { ansi?: boolean; now?: number } = {},
): string {
  const now = options.now ?? Date.now()
  const accountHeader = `${result.email ?? `Account ${result.index + 1}`}${result.disabled ? " [disabled]" : ""}`
  if (result.status === "disabled") {
    return `${accountHeader}\n  Skipped (disabled)`
  }
  if (result.status === "error" || result.error) {
    return `${accountHeader}\n  Error: ${result.error ?? "Unknown error"}`
  }

  const groups: QuotaCardGroup[] = []
  const antigravity = result.quota?.groups ?? {}

  const gemini = geminiItems(antigravity["gemini-pro"], antigravity["gemini-flash"], now)
  if (gemini.length > 0) {
    groups.push({ title: CARD_SPECS["gemini-pro"].title, subtitle: CARD_SPECS["gemini-pro"].subtitle, items: gemini })
  }

  const argon = antigravity.argon
  if (argon) {
    const items = groupItems(argon, CARD_SPECS.argon.fallbackName, now)
    if (items.length > 0) {
      groups.push({ title: CARD_SPECS.argon.title, subtitle: CARD_SPECS.argon.subtitle, items })
    }
  }

  const claude = antigravity.claude
  if (claude) {
    const items = groupItems(claude, CARD_SPECS.claude.fallbackName, now)
    if (items.length > 0) {
      groups.push({ title: CARD_SPECS.claude.title, subtitle: CARD_SPECS.claude.subtitle, items })
    }
  }

  const cliModels = result.geminiCliQuota?.models ?? []
  if (cliModels.length > 0) {
    groups.push({
      title: "GEMINI CLI MODELS",
      subtitle: `Models within this group: ${cliModels.map(m => m.modelId).join(", ")}`,
      items: cliModels.map(m => ({
        name: `${m.modelId} Limit Remaining`,
        remainingFraction: m.remainingFraction,
        resetTime: m.resetTime,
      })),
    })
  }

  if (groups.length === 0) {
    return `${accountHeader}\n  No quota information available`
  }

  return formatQuotaCards(groups, options)
}

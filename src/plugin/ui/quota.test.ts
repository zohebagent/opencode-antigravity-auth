import { describe, expect, it } from "vitest"
import {
  createProgressBar,
  formatQuotaDescription,
  formatResetCountdown,
  formatAccountQuotaReport,
  parseQuotaLine,
} from "./quota.ts"
import type { AccountQuotaResult, QuotaGroupSummary } from "../quota.ts"

const NOW = Date.parse("2026-10-27T12:00:00Z")

function summary(partial: Partial<QuotaGroupSummary> = {}): QuotaGroupSummary {
  return { modelCount: 1, ...partial }
}

function resultWith(groups: Partial<Record<"claude" | "gemini-pro" | "gemini-flash" | "argon", QuotaGroupSummary>>): AccountQuotaResult {
  return {
    index: 0,
    email: "user@example.com",
    status: "ok",
    quota: { groups, modelCount: Object.keys(groups).length },
  }
}

describe("cached quota descriptions", () => {
  it("shows when no cached quota is available", () => {
    expect(formatQuotaDescription(undefined, NOW)).toBe("no quota data")
  })

  it.each([
    ["2026-10-27T14:54:00Z", "81% · resets in 2h 54m"],
    ["2026-11-03T09:00:00Z", "81% · resets in 6d 21h"],
    ["2026-10-28T12:00:00Z", "81% · resets in 1d 0h"],
    ["2026-10-27T13:00:00Z", "81% · resets in 1h 0m"],
    ["2026-10-27T12:05:00Z", "81% · resets in 5m"],
    ["2026-10-27T12:00:01Z", "81% · resets in 1m"],
    ["2026-10-27T12:00:00Z", "81% · reset due"],
    ["2026-10-27T11:59:00Z", "81% · reset due"],
  ])("formats reset time %s", (resetTime, expected) => {
    expect(formatQuotaDescription({ remainingFraction: 0.81, resetTime }, NOW)).toBe(expected)
  })

  it("omits reset times when the displayed quota is full", () => {
    const resetTime = "2026-10-27T14:54:00Z"
    expect(formatQuotaDescription({ remainingFraction: 1, resetTime }, NOW)).toBe("100%")
    expect(formatQuotaDescription({ remainingFraction: 0.999, resetTime }, NOW)).toBe("100%")
  })

  it("keeps the percentage when reset time is absent or invalid", () => {
    expect(formatQuotaDescription({ remainingFraction: 0.794 }, NOW)).toBe("79%")
    expect(formatQuotaDescription({ remainingFraction: 0.81, resetTime: "invalid" }, NOW)).toBe("81%")
  })

  it("shows an exhausted quota and its reset time", () => {
    expect(formatQuotaDescription({ remainingFraction: 0, resetTime: "2026-10-27T14:54:00Z" }, NOW)).toBe("0% · resets in 2h 54m")
  })
})

describe("Antigravity progress bar", () => {
  it("renders a 100% full progress bar with default 34 width", () => {
    expect(createProgressBar(1, { width: 34, ansi: false })).toBe("[██████████████████████████████████] 100.00%")
  })

  it("renders a 32.86% partial progress bar", () => {
    expect(createProgressBar(0.3286, { width: 34, ansi: false })).toBe("[███████████░░░░░░░░░░░░░░░░░░░░░░░] 32.86%")
  })

  it("renders a 93.74% progress bar", () => {
    expect(createProgressBar(0.9374, { width: 34, ansi: false })).toBe("[████████████████████████████████░░] 93.74%")
  })

  it("renders undefined quota with unknown state", () => {
    expect(createProgressBar(undefined, { width: 34, ansi: false })).toBe("[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ???%")
  })
})

describe("formatResetCountdown", () => {
  it("formats multi-day and multi-hour countdown in hours and minutes", () => {
    const target = new Date(NOW + 375060000).toISOString()
    expect(formatResetCountdown(target, 0.3286, NOW, false)).toBe("Refreshes in 104h 11m")
  })

  it("formats sub-day countdown in hours and minutes", () => {
    const target = new Date(NOW + 16500000).toISOString()
    expect(formatResetCountdown(target, 0.9374, NOW, false)).toBe("Refreshes in 4h 35m")
  })

  it("returns 'Quota available' when fraction is 1 or no resetTime", () => {
    expect(formatResetCountdown(undefined, 1, NOW, false)).toBe("Quota available")
    expect(formatResetCountdown(undefined, undefined, NOW, false)).toBe("Quota available")
  })

  it("returns 'Reset due' when resetTime is in the past", () => {
    const past = new Date(NOW - 60000).toISOString()
    expect(formatResetCountdown(past, 0.5, NOW, false)).toBe("Reset due")
  })
})

describe("formatAccountQuotaReport", () => {
  it("renders one Gemini card with weekly and five-hour windows from the summary", () => {
    const weeklyReset = new Date(NOW + 104 * 3600_000 + 11 * 60_000).toISOString()
    const fiveHourReset = new Date(NOW + 4 * 3600_000 + 35 * 60_000).toISOString()
    const report = formatAccountQuotaReport(resultWith({
      "gemini-pro": summary({
        remainingFraction: 0.3286,
        resetTime: weeklyReset,
        weeklyRemainingFraction: 0.3286,
        weeklyResetTime: weeklyReset,
        fiveHourRemainingFraction: 0.9374,
        fiveHourResetTime: fiveHourReset,
      }),
      "gemini-flash": summary({
        remainingFraction: 0.3286,
        resetTime: weeklyReset,
        weeklyRemainingFraction: 0.3286,
        weeklyResetTime: weeklyReset,
        fiveHourRemainingFraction: 0.9374,
        fiveHourResetTime: fiveHourReset,
      }),
      claude: summary({
        remainingFraction: 1,
        weeklyRemainingFraction: 1,
        fiveHourRemainingFraction: 1,
      }),
    }), { ansi: false, now: NOW })

    expect(report.match(/GEMINI MODELS/g)).toHaveLength(1)
    expect(report).toContain("Models within this group: Gemini Flash, Gemini Pro")
    expect(report).toContain("Weekly Limit Remaining")
    expect(report).toContain("[███████████░░░░░░░░░░░░░░░░░░░░░░░] 32.86%")
    expect(report).toContain("Refreshes in 104h 11m")
    expect(report).toContain("Five Hour Limit Remaining")
    expect(report).toContain("[████████████████████████████████░░] 93.74%")
    expect(report).toContain("Refreshes in 4h 35m")
    expect(report).toContain("CLAUDE AND GPT MODELS")
    expect(report).toContain("Models within this group: Claude Opus, Claude Sonnet, GPT-OSS")
    expect(report).toContain("[██████████████████████████████████] 100.00%")
    expect(report).toContain("Quota available")
  })

  it("renders a separate Argon card with its own weekly bucket", () => {
    const report = formatAccountQuotaReport(resultWith({
      "gemini-pro": summary({ remainingFraction: 0.9, weeklyRemainingFraction: 0.9, fiveHourRemainingFraction: 0.9 }),
      argon: summary({
        remainingFraction: 0.5,
        weeklyRemainingFraction: 0.5,
        weeklyResetTime: new Date(NOW + 72 * 3600_000).toISOString(),
      }),
    }), { ansi: false, now: NOW })

    expect(report).toContain("GEMINI 4 ARGON")
    expect(report).toContain("Models within this group: Gemini 4 Argon")
    expect(report).toContain("[█████████████████░░░░░░░░░░░░░░░░░] 50.00%")
    expect(report).toContain("Refreshes in 72h 0m")
  })

  it("collapses identical Flash and Pro aggregates into one inferred window", () => {
    const weeklyReset = new Date(NOW + 166 * 3600_000 + 55 * 60_000).toISOString()
    const report = formatAccountQuotaReport(resultWith({
      "gemini-flash": summary({ remainingFraction: 0.0015, resetTime: weeklyReset }),
      "gemini-pro": summary({ remainingFraction: 0.0015, resetTime: weeklyReset }),
      claude: summary({ remainingFraction: 1 }),
    }), { ansi: false, now: NOW })

    expect(report).toContain("Weekly Limit Remaining")
    expect(report).toContain("Refreshes in 166h 55m")
    expect(report).not.toContain("Five Hour Limit Remaining")
  })

  it("labels a shared sub-day limit as the five-hour window", () => {
    const shortReset = new Date(NOW + 3 * 3600_000 + 56 * 60_000).toISOString()
    const report = formatAccountQuotaReport(resultWith({
      "gemini-flash": summary({ remainingFraction: 0.831, resetTime: shortReset }),
      "gemini-pro": summary({ remainingFraction: 0.831, resetTime: shortReset }),
    }), { ansi: false, now: NOW })

    expect(report).toContain("Five Hour Limit Remaining")
    expect(report).toContain("Refreshes in 3h 56m")
    expect(report).not.toContain("Weekly Limit Remaining")
  })

  it("keeps distinct Flash and Pro entries when their aggregates differ", () => {
    const report = formatAccountQuotaReport(resultWith({
      "gemini-flash": summary({ remainingFraction: 0.6, resetTime: new Date(NOW + 2 * 3600_000).toISOString() }),
      "gemini-pro": summary({ remainingFraction: 0.9, resetTime: new Date(NOW + 4 * 3600_000).toISOString() }),
    }), { ansi: false, now: NOW })

    expect(report).toContain("Gemini Flash Limit Remaining")
    expect(report).toContain("Gemini Pro Limit Remaining")
    expect(report).toContain("60.00%")
    expect(report).toContain("90.00%")
  })

  it("orders a weekly Flash aggregate before a five-hour Pro aggregate", () => {
    const report = formatAccountQuotaReport(resultWith({
      "gemini-flash": summary({ remainingFraction: 0.3286, resetTime: new Date(NOW + 104 * 3600_000).toISOString() }),
      "gemini-pro": summary({ remainingFraction: 0.9374, resetTime: new Date(NOW + 4 * 3600_000).toISOString() }),
    }), { ansi: false, now: NOW })

    expect(report.indexOf("Weekly Limit Remaining")).toBeLessThan(report.indexOf("Five Hour Limit Remaining"))
  })

  it("renders Gemini CLI models in their own card", () => {
    const report = formatAccountQuotaReport({
      ...resultWith({ claude: summary({ remainingFraction: 1 }) }),
      geminiCliQuota: {
        models: [{ modelId: "gemini-3-flash", remainingFraction: 0.25 }],
      },
    }, { ansi: false, now: NOW })

    expect(report).toContain("GEMINI CLI MODELS")
    expect(report).toContain("gemini-3-flash Limit Remaining")
  })

  it("reports disabled and failed accounts without cards", () => {
    expect(formatAccountQuotaReport({ index: 1, status: "disabled", disabled: true })).toBe("Account 2 [disabled]\n  Skipped (disabled)")
    expect(formatAccountQuotaReport({ index: 0, email: "a@b.test", status: "error", error: "boom" })).toBe("a@b.test\n  Error: boom")
  })

  it("explains when nothing is known about quota", () => {
    expect(formatAccountQuotaReport(resultWith({}))).toBe("user@example.com\n  No quota information available")
  })
})

describe("interactive quota line parsing", () => {
  it.each([
    ["    [██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 18.00%", "error"],
    ["    [███████████░░░░░░░░░░░░░░░░░░░░░░░] 32.86%", "warning"],
    ["    [██████████████████████████████████] 100.00%", "success"],
    ["    [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ???%", "muted"],
  ])("tones a progress bar by its limit: %s", (line, tone) => {
    expect(parseQuotaLine(line)).toMatchObject({ kind: "bar", indent: 4, tone })
  })

  it("keeps the bar segments and percentage available to the renderer", () => {
    expect(parseQuotaLine("    [███░░░] 50.00%")).toEqual({
      kind: "bar", indent: 4, filled: "███", empty: "░░░", percent: "50.00%", tone: "warning",
    })
  })

  it.each([
    ["    Quota available", "success"],
    ["    Exhausted", "error"],
    ["    Reset due", "warning"],
    ["    Refreshes in 101h 37m", "muted"],
  ])("classifies the status line %s", (line, tone) => {
    expect(parseQuotaLine(line)).toEqual({ kind: "status", indent: 4, text: line.trim(), tone })
  })

  it("recognizes group titles and keeps unknown lines as plain text", () => {
    expect(parseQuotaLine("CLAUDE AND GPT MODELS")).toEqual({ kind: "title", text: "CLAUDE AND GPT MODELS" })
    expect(parseQuotaLine("  Models within this group: Gemini Flash, Gemini Pro")).toEqual({
      kind: "text", indent: 2, text: "Models within this group: Gemini Flash, Gemini Pro",
    })
    expect(parseQuotaLine("  Error: boom")).toEqual({ kind: "text", indent: 2, text: "Error: boom" })
    expect(parseQuotaLine("")).toEqual({ kind: "blank" })
  })
})

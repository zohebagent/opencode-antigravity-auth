import { describe, expect, it, vi } from "vitest"
import {
  deriveDebugPolicy,
  formatAccountContextLabel,
  formatAccountLabel,
  formatBodyPreviewForLog,
  formatErrorForLog,
  redactSensitiveText,
  sanitizeLogData,
  sanitizeUrlForLog,
  truncateTextForLog,
  writeConsoleLog,
} from "./logging-utils"

describe("deriveDebugPolicy", () => {
  it("keeps debug_tui disabled when debug is disabled", () => {
    const policy = deriveDebugPolicy({
      configDebug: false,
      configDebugTui: true,
      envDebugFlag: "",
      envDebugTuiFlag: "1",
    })

    expect(policy.debugEnabled).toBe(false)
    expect(policy.debugTuiEnabled).toBe(false)
    expect(policy.verboseEnabled).toBe(false)
    expect(policy.debugLevel).toBe(0)
  })

  it("supports verbose mode override when debug config is enabled", () => {
    const policy = deriveDebugPolicy({
      configDebug: true,
      configDebugTui: false,
      envDebugFlag: "verbose",
      envDebugTuiFlag: "",
    })

    expect(policy.debugEnabled).toBe(true)
    expect(policy.debugTuiEnabled).toBe(false)
    expect(policy.verboseEnabled).toBe(true)
    expect(policy.debugLevel).toBe(2)
  })
})

describe("format helpers", () => {
  it("formats account labels consistently", () => {
    expect(formatAccountLabel("person@example.com", 4)).toBe("person@example.com")
    expect(formatAccountLabel(undefined, 1)).toBe("Account 2")
    expect(formatAccountContextLabel(undefined, -1)).toBe("All accounts")
    expect(formatAccountContextLabel(undefined, 0)).toBe("Account 1")
  })

  it("formats errors defensively", () => {
    expect(formatErrorForLog(new Error("boom"))).toContain("boom")
    expect(formatErrorForLog({ code: 401 })).toBe('{"code":401}')

    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(formatErrorForLog(circular)).toContain("[object Object]")
  })

  it("truncates long text with metadata", () => {
    const longText = "x".repeat(12)
    expect(truncateTextForLog(longText, 5)).toBe("xxxxx... (truncated 7 chars)")
    expect(truncateTextForLog("short", 10)).toBe("short")
  })

  it("formats body previews safely", () => {
    expect(formatBodyPreviewForLog("abcdef", 3)).toBe("abc... (truncated 3 chars)")
    expect(formatBodyPreviewForLog(new URLSearchParams({ q: "value" }), 100)).toBe("q=value")
    expect(formatBodyPreviewForLog(new Uint8Array([1, 2]), 100)).toBe("[Uint8Array payload omitted]")
  })

  it("redacts sensitive tokens in text", () => {
    expect(redactSensitiveText("token is ya29.a0AfH6SMD_secret_token_123")).toBe("token is ya29.[redacted]")
    expect(redactSensitiveText("refresh 1//0gXYZ_secret_refresh_token")).toBe("refresh 1//[redacted]")
    expect(redactSensitiveText("key AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe("key AIza[redacted]")
    expect(redactSensitiveText("Bearer ya29.secret")).toBe("Bearer [redacted]")
    expect(redactSensitiveText('{"refreshToken":"secret123"}')).toBe('{"refreshToken":"[redacted]"}')
    expect(redactSensitiveText("grant_type=refresh_token&refresh_token=secret_val&client_id=123")).toBe("grant_type=refresh_token&refresh_token=[redacted]&client_id=123")
  })

  it("sanitizes URLs by redacting sensitive query params", () => {
    expect(sanitizeUrlForLog("https://example.com/api?key=AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&model=gemini"))
      .toBe("https://example.com/api?key=%5Bredacted%5D&model=gemini")
    expect(sanitizeUrlForLog("https://oauth.example.com/callback?code=4/0Abc_secret&state=xyz"))
      .toBe("https://oauth.example.com/callback?code=%5Bredacted%5D&state=xyz")
  })

  it("sanitizes log data objects recursively and prevents prototype pollution", () => {
    const raw = {
      email: "user@example.com",
      refreshToken: "secret_refresh",
      client_secret: "secret_client",
      nested: {
        authorization: "Bearer secret_bearer",
        apiKey: "AIzaSecretKey",
        safeVal: 42,
      },
      tokens: ["ya29.secret1", "safe"],
      __proto__: { polluted: true },
    }
    const clean = sanitizeLogData(raw) as Record<string, unknown>
    expect(clean.email).toBe("user@example.com")
    expect(clean.refreshToken).toBe("[redacted]")
    expect(clean.client_secret).toBe("[redacted]")
    expect((clean.nested as any).authorization).toBe("[redacted]")
    expect((clean.nested as any).apiKey).toBe("[redacted]")
    expect((clean.nested as any).safeVal).toBe(42)
    expect((clean.tokens as any)[0]).toBe("ya29.[redacted]")
    expect((clean.tokens as any)[1]).toBe("safe")
    expect(Object.prototype.hasOwnProperty.call(clean, "__proto__")).toBe(false)
  })
})

describe("writeConsoleLog", () => {
  it("routes to the level-specific console method", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    writeConsoleLog("debug", "dbg")
    writeConsoleLog("info", "inf")
    writeConsoleLog("warn", "wrn")
    writeConsoleLog("error", "err")

    expect(debugSpy).toHaveBeenCalledWith("dbg")
    expect(infoSpy).toHaveBeenCalledWith("inf")
    expect(warnSpy).toHaveBeenCalledWith("wrn")
    expect(errorSpy).toHaveBeenCalledWith("err")

    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

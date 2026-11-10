export type LogLevel = "debug" | "info" | "warn" | "error"

export interface DebugPolicyInput {
  configDebug: boolean
  configDebugTui: boolean
  envDebugFlag?: string
  envDebugTuiFlag?: string
}

export interface DebugPolicy {
  debugLevel: number
  debugEnabled: boolean
  debugTuiEnabled: boolean
  verboseEnabled: boolean
}

export function isTruthyFlag(flag?: string): boolean {
  return flag === "1" || flag?.toLowerCase() === "true"
}

export function parseDebugLevel(flag: string): number {
  const trimmed = flag.trim()
  if (trimmed === "2" || trimmed === "verbose") return 2
  if (trimmed === "1" || trimmed === "true") return 1
  return 0
}

export function deriveDebugPolicy(input: DebugPolicyInput): DebugPolicy {
  const envDebugFlag = input.envDebugFlag ?? ""
  const debugLevel = input.configDebug
    ? envDebugFlag === "2" || envDebugFlag === "verbose"
      ? 2
      : 1
    : parseDebugLevel(envDebugFlag)
  const debugEnabled = debugLevel >= 1
  const verboseEnabled = debugLevel >= 2
  const debugTuiEnabled = debugEnabled && (input.configDebugTui || isTruthyFlag(input.envDebugTuiFlag))

  return {
    debugLevel,
    debugEnabled,
    debugTuiEnabled,
    verboseEnabled,
  }
}

const SENSITIVE_KEY_REGEX =
  /^(authorization|cookie|set-cookie|password|secret|clientsecret|client_secret|refreshtoken|refresh_token|accesstoken|access_token|apikey|api_key|x-goog-api-key|session-token|x-session-token|token)$/i;

const URL_SENSITIVE_PARAM_REGEX =
  /^(key|token|access_token|refresh_token|client_secret|secret|code|verifier)$/i;

/**
 * Redacts known tokens, secrets, and credentials from a text string.
 */
export function redactSensitiveText(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/Bearer\s+[^\s"'`,]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[a-zA-Z0-9_\-]+/g, "ya29.[redacted]")
    .replace(/1\/\/[a-zA-Z0-9_\-]+/g, "1//[redacted]")
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza[redacted]")
    .replace(
      /"(refreshToken|accessToken|clientSecret|client_secret|access_token|refresh_token|api_key|apiKey)":\s*"[^"]+"/gi,
      '"$1":"[redacted]"'
    )
    .replace(
      /\b(refresh_token|access_token|client_secret|code)=([^&\s"']*)/gi,
      "$1=[redacted]"
    );
}

/**
 * Sanitizes URLs for logging by redacting sensitive query parameters.
 */
export function sanitizeUrlForLog(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") return urlStr;
  try {
    const url = new URL(urlStr);
    let modified = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (URL_SENSITIVE_PARAM_REGEX.test(key)) {
        url.searchParams.set(key, "[redacted]");
        modified = true;
      }
    }
    return modified ? url.toString() : redactSensitiveText(urlStr);
  } catch {
    return redactSensitiveText(urlStr);
  }
}

/**
 * Recursively sanitizes objects and values to prevent accidental credential leakage in logs.
 */
export function sanitizeLogData(
  data: unknown,
  maxDepth = 6,
  seen = new WeakSet<object>()
): unknown {
  if (data == null || typeof data !== "object") {
    if (typeof data === "string") {
      return redactSensitiveText(data);
    }
    return data;
  }

  if (seen.has(data as object)) {
    return "[Circular]";
  }
  seen.add(data as object);

  if (maxDepth <= 0) {
    return "[DepthLimit]";
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, maxDepth - 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      continue;
    }
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeLogData(value, maxDepth - 1, seen);
    }
  }
  return sanitized;
}

export function formatAccountLabel(email: string | undefined, accountIndex: number): string {
  return email || `Account ${accountIndex + 1}`
}

export function formatAccountContextLabel(email: string | undefined, accountIndex: number): string {
  if (email) {
    return email
  }
  if (accountIndex >= 0) {
    return `Account ${accountIndex + 1}`
  }
  return "All accounts"
}

export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.stack ?? error.message)
  }
  try {
    return redactSensitiveText(JSON.stringify(error))
  } catch {
    return redactSensitiveText(String(error))
  }
}

export function truncateTextForLog(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}... (truncated ${text.length - maxChars} chars)`
}

export function formatBodyPreviewForLog(
  body: BodyInit | null | undefined,
  maxChars: number,
): string | undefined {
  if (body == null) {
    return undefined
  }

  if (typeof body === "string") {
    return truncateTextForLog(redactSensitiveText(body), maxChars)
  }

  if (body instanceof URLSearchParams) {
    return truncateTextForLog(redactSensitiveText(body.toString()), maxChars)
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `[Blob size=${body.size}]`
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return "[FormData payload omitted]"
  }

  return `[${body.constructor?.name ?? typeof body} payload omitted]`
}

export function writeConsoleLog(level: LogLevel, ...args: unknown[]): void {
  switch (level) {
    case "debug":
      console.debug(...args)
      break
    case "info":
      console.info(...args)
      break
    case "warn":
      console.warn(...args)
      break
    case "error":
      console.error(...args)
      break
  }
}

# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

OpenCode plugin for Google Antigravity OAuth. Intercepts `fetch()` calls to `generativelanguage.googleapis.com`, transforms them to Antigravity format, and handles auth, quota, recovery, and multi-account rotation.

## Build & Test Commands

```bash
pnpm install                         # Install dependencies
pnpm run build                       # Compile (tsc -p tsconfig.build.json)
pnpm run typecheck                   # Type-check only (tsc --noEmit)
pnpm test                            # Run all tests (vitest run)
pnpm exec vitest run src/plugin/auth.test.ts   # Single test file
pnpm exec vitest run -t "test name here"       # Single test by name
pnpm exec vitest --watch src/plugin/auth.test.ts # Watch mode, single file
pnpm run test:coverage               # Coverage report
pnpm run test:e2e:models             # E2E: model availability check
pnpm run test:e2e:regression         # E2E: regression suite
```

> **IMPORTANT — In-Flight Build Hazard:**
> Never run `pnpm run build` while OpenCode is actively running a turn on an Antigravity model. Overwriting `dist/` triggers OpenCode Desktop's file watcher to reload the plugin, disposing the active router instance and throwing `Antigravity plugin has been disposed`. Furthermore, OpenCode Desktop's Electron/Node process caches loaded plugin modules in memory — after rebuilding `dist/` outside an active turn, fully restart OpenCode Desktop so the freshly compiled bundle takes effect.

No linter or formatter is configured. Style is enforced by convention (see below).

## TypeScript Configuration

- `strict: true` with extra strictness: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `target: ESNext`, `module: Preserve`, `moduleResolution: bundler`
- `allowImportingTsExtensions: true` — use `.ts` extensions in imports
- No path aliases — all imports are relative

## Code Style

### Imports
- Use `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`)
- Named imports only — no default imports in src/
- Relative paths with `.ts` extensions: `import { foo } from "./bar.ts"`
- Order: node builtins > external packages > local modules

### Exports
- Named exports only in src/ — no default exports
- Barrel files (index.ts) for module surfaces

### Naming
- `camelCase` for functions, variables, parameters
- `PascalCase` for types, interfaces, classes, enums
- `UPPER_SNAKE_CASE` for constants
- `kebab-case` for file names (e.g., `request-helpers.ts`, `thinking-recovery.ts`)
- Test files: `*.test.ts` colocated with source

### Types
- No `I` prefix on interfaces, no `Type` suffix
- Use `z.infer<typeof Schema>` for Zod-derived types
- Extract to `types.ts` when shared, inline when local
- Discriminated unions preferred over boolean flags
- Never use `as any`, `@ts-ignore`, or `@ts-expect-error`

### Functions
- `export function` for public APIs
- Arrow functions for callbacks, factories, and inline closures
- Async functions with targeted try/catch (not blanket)

### Error Handling
- Defensive try/catch with graceful degradation (fallback values, not crashes)
- Custom error classes with metadata when domain-specific
- Catch `unknown`, log, and convert to domain errors — never empty catch blocks
- Rate limit / quota errors trigger account rotation, not failure

### Formatting
- 2-space indentation
- Double quotes for strings
- Trailing commas in multiline constructs
- No semicolons (project convention)

### Logging
- `createLogger("module-name")` for structured logging
- `console.log` only for CLI/user-facing output

## Module Structure

```
index.ts                     # Package entrypoint (OpenCode V2 default export + V1 server export)
src/
├── v2.ts                    # OpenCode V2 plugin adapter, catalog registration, AI SDK 3 bridge
├── tui.ts                   # /antigravity (/ag) TUI menu entrypoint
├── quota-dialog.tsx         # Interactive scrollable quota dialog UI
├── plugin.ts                # Core fetch interceptor, retry & multi-account loop
├── constants.ts             # Endpoints, Hub headers, API config, system prompts
├── antigravity/oauth.ts     # OAuth token exchange
└── plugin/
    ├── auth.ts              # Token validation & refresh
    ├── request.ts           # Request & response transformation (core logic)
    ├── request-helpers.ts   # Schema cleaning, thinking config, response part normalization
    ├── thinking-recovery.ts # Turn boundary detection
    ├── recovery.ts          # Legacy V1 session recovery (tool_result_missing)
    ├── quota.ts             # Quota checking (fetchAvailableModels + retrieveUserQuotaSummary)
    ├── cache.ts             # Auth & signature caching
    ├── accounts.ts          # Multi-account management & storage
    ├── storage.ts           # Persistent storage schemas (Zod, V1-V4 migration)
    ├── fingerprint.ts       # Per-account device fingerprint persistence
    ├── project.ts           # Managed project context resolution
    ├── config/              # Config schema, loader (machine/user/project), V2 model definitions
    │   └── models-v2.ts     # Collapsed V2 model catalog & variant synthesis
    ├── core/streaming/      # Real-time SSE TransformStream & delta deduplication
    │   └── transformer.ts   # SSE line transform, signature capture, thought delta extraction
    ├── stores/
    │   └── signature-store.ts # Session signature & thought buffer stores
    ├── transform/           # Prompt signature, cross-model & model transformers
    │   ├── prompt-signature.ts # Neutralizes OpenCode Code Mode signatures (#622)
    │   ├── gemini.ts        # Gemini payload transformation
    │   ├── claude.ts        # Claude payload transformation & thinking detection
    │   └── model-resolver.ts# Model tier, collapsed family & variant resolution
    └── debug.ts             # Debug file & TUI logging utilities
```

## Key Design Patterns

### 1. Request Interception
Plugin intercepts `fetch()` for `generativelanguage.googleapis.com`, transforms to Antigravity format. Two header styles: `antigravity` (Hub `User-Agent` on `daily-cloudcode-pa.googleapis.com`) and `gemini-cli` (Code Assist headers on `cloudcode-pa.googleapis.com`).

### 2. Thinking & Reasoning Pipeline (OpenCode V2)
- **Outbound `includeThoughts` Defaulting**: OpenCode V2 variants pass `thinkingConfig: { thinkingLevel }` or `{ thinkingBudget }` without an explicit `includeThoughts` boolean. `extractThinkingConfig()` in `src/plugin/request-helpers.ts` MUST default `includeThoughts` to `true` when omitted, while respecting explicit `includeThoughts: false` / `include_thoughts: false`.
- **Model Family Coverage**: `isThinkingCapableModel()`, `isClaudeThinkingModel()`, and `resolveModelWithTier()` recognize Gemini 3/4 (`gemini-3-*`, `gemini-4-*`, including `xhigh` / `"Extra"`), Claude `-thinking`, and tiered Claude 5.5 (`claude-opus-5-5-*`, `claude-sonnet-5-5-*`). Non-standard Gemini 3/4 effort labels (such as `extra`) omit `thinkingLevel` while keeping `{ includeThoughts: true }`.
- **Gemini Native SSE vs Claude Conversion**: `transformResponseParts()` runs `functionCall.args` JSON normalization and `inlineData` image saving for ALL models (streaming and non-streaming), while thought conversion (`convertThoughts: true` -> `type: "reasoning"` + `providerMetadata.anthropic.signature`) runs ONLY for Claude. Gemini streams MUST keep native `{ thought: true, text, thoughtSignature }` parts untouched for `@ai-sdk/google`.
- **Delta Deduplication**: `deduplicateThinkingText()` in `src/plugin/core/streaming/transformer.ts` preserves `thoughtSignature`-carrying chunks even when text delta is empty, and never injects Claude's `thinking` field onto Gemini parts. Cross-turn thought hash dropping was removed and must not be reintroduced.
- **Claude Outbound Thinking Strip**: By default (`keep_thinking: false`), all historical thinking blocks are stripped from outgoing Claude requests so Claude generates fresh thinking each turn without signature errors.
- **Desktop UI Display**: OpenCode Desktop's **Settings → General → Timeline** (`Thinking` → `Collapse` toggle) controls whether reasoning blocks render expanded or collapsed in the UI. The plugin must not interfere with native transcript grouping.

### 3. Session Recovery
In V2, OpenCode owns session repair. In legacy V1, when tool execution is interrupted (ESC/timeout), `recovery.ts` injects synthetic `tool_result` blocks to recover the session without starting over.

### 4. Schema Sanitization
Tool schemas are cleaned via allowlist. Unsupported fields (`const`, `$ref`, `$defs`) are removed or converted to Antigravity-compatible format.

### 5. Multi-Account Load Balancing
Accounts rotate on rate limits. Gemini has dual quota pools (Antigravity + Gemini CLI). Both 5-hour (`fetchAvailableModels`) and weekly (`retrieveUserQuotaSummary`) quota buckets are evaluated.

### 6. Fingerprint & Hub Identity
Antigravity content requests send only the current Hub `User-Agent` (`getAntigravityUserAgent()`), omitting `X-Goog-Api-Client`, `Client-Metadata`, and `x-goog-user-project`. Per-account fingerprints remain stored in `antigravity-accounts.json` (max 5 history entries) for compatibility.

### 7. Prompt Signature Neutralization
Google's daily host rejects requests containing the exact `tools["opencode"].session_move` Code Mode signature with a bare 429. The plugin neutralizes this signature to bracket property access (`tools["opencode"].`) in `systemInstruction` and `contents` before serialization, bypassing the filter while maintaining tool invocation capability.

## Dependencies

- `zod ^4` — schema validation (NOT zod v3)
- `@opencode-ai/plugin` — OpenCode plugin interface
- `@openauthjs/openauth` — OAuth client
- `proper-lockfile` — file locking for concurrent access
- `xdg-basedir` — XDG directory resolution

## Testing

- Framework: **Vitest 3** with native ESM
- Config: `vitest.config.ts`
- Tests colocated: `src/plugin/foo.test.ts` next to `src/plugin/foo.ts`
- Use `describe`/`it`/`expect` — standard Vitest API
- Mock with `vi.fn()`, `vi.spyOn()`, `vi.mock()`

## Documentation

- [README.md](README.md) — Installation & usage
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Detailed architecture guide
- [docs/ANTIGRAVITY_API_SPEC.md](docs/ANTIGRAVITY_API_SPEC.md) — API reference
- [CHANGELOG.md](CHANGELOG.md) — Version history

import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "index.ts",
    "src/tui": "src/tui.ts",
  },
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  external: [
    "@ai-sdk/google",
    "@opencode/client",
    "@opencode/plugin",
    "@opencode-ai/plugin",
    "@openauthjs/openauth",
    "proper-lockfile",
    "xdg-basedir",
    "zod",
    "solid-js",
    "@opentui/core",
    "@opentui/solid",
  ],
});

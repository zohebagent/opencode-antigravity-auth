import { describe, expect, it } from "vitest";
import { startOAuthListener } from "./server";
import { ANTIGRAVITY_REDIRECT_URI } from "../constants";

describe("startOAuthListener", () => {
  it("starts server and handles valid OAuth callback with security headers", async () => {
    let listener;
    try {
      listener = await startOAuthListener({ timeoutMs: 5000 });
      const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI);
      const testUrl = `http://127.0.0.1:${redirectUri.port || 80}${redirectUri.pathname}?code=test_auth_code&state=test_state`;

      // Trigger callback request
      const response = await fetch(testUrl);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");

      const capturedUrl = await listener.waitForCallback();
      expect(capturedUrl.searchParams.get("code")).toBe("test_auth_code");
      expect(capturedUrl.searchParams.get("state")).toBe("test_state");
    } finally {
      if (listener) {
        await listener.close();
      }
    }
  });

  it("rejects non-GET/HEAD methods with 405", async () => {
    let listener;
    try {
      listener = await startOAuthListener({ timeoutMs: 5000 });
      // Attach catch handler so closing without callback is handled cleanly
      listener.waitForCallback().catch(() => {});
      const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI);
      const testUrl = `http://127.0.0.1:${redirectUri.port || 80}${redirectUri.pathname}`;

      const response = await fetch(testUrl, { method: "POST" });
      expect(response.status).toBe(405);
    } finally {
      if (listener) {
        await listener.close();
      }
    }
  });

  it("ignores requests missing code or error without resolving callback", async () => {
    let listener;
    try {
      listener = await startOAuthListener({ timeoutMs: 5000 });
      const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI);
      // Probe without code or error
      const probeUrl = `http://127.0.0.1:${redirectUri.port || 80}${redirectUri.pathname}`;
      const probeResponse = await fetch(probeUrl);
      expect(probeResponse.status).toBe(400);

      // Now send the genuine callback
      const validUrl = `http://127.0.0.1:${redirectUri.port || 80}${redirectUri.pathname}?code=valid_code&state=valid_state`;
      const validResponse = await fetch(validUrl);
      expect(validResponse.status).toBe(200);

      const capturedUrl = await listener.waitForCallback();
      expect(capturedUrl.searchParams.get("code")).toBe("valid_code");
    } finally {
      if (listener) {
        await listener.close();
      }
    }
  });
});

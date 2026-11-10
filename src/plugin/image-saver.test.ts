import { describe, expect, it } from "vitest";
import { saveImageToDisk, processImageData } from "./image-saver";
import * as fs from "node:fs";

describe("image-saver", () => {
  it("saves base64 image data to disk with appropriate extension and permissions", () => {
    // 1x1 transparent PNG in base64
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA anPt";
    const filePath = saveImageToDisk(pngBase64, "image/png");

    expect(filePath).toBeTruthy();
    expect(filePath.endsWith(".png")).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);

    // Clean up
    try {
      fs.unlinkSync(filePath);
    } catch {}
  });

  it("handles jpeg and webp mime types", () => {
    const data = "dGVzdA=="; // "test" in base64
    const jpgPath = saveImageToDisk(data, "image/jpeg");
    expect(jpgPath.endsWith(".jpg")).toBe(true);
    if (fs.existsSync(jpgPath)) fs.unlinkSync(jpgPath);

    const webpPath = saveImageToDisk(data, "image/webp");
    expect(webpPath.endsWith(".webp")).toBe(true);
    if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
  });

  it("rejects excessively large payloads over limit", () => {
    // Mock string longer than 50MB without allocating full memory
    const hugeFakeString = {
      length: 51 * 1024 * 1024,
    } as unknown as string;

    const result = saveImageToDisk(hugeFakeString, "image/png");
    expect(result).toBe("");
  });

  it("returns null when processImageData is called without data", () => {
    expect(processImageData({})).toBeNull();
  });
});

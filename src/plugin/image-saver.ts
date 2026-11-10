/**
 * Image Saving Utility
 * 
 * Handles saving generated images to disk and returning file paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

const MAX_IMAGE_BASE64_LENGTH = 50 * 1024 * 1024; // 50MB max base64 size

/**
 * Default directory for saving generated images.
 * Uses ~/.opencode/generated-images/
 */
function getImageOutputDir(): string {
  const homeDir = os.homedir();
  const outputDir = path.join(homeDir, '.opencode', 'generated-images');
  
  // Create directory with restricted permissions if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  }
  
  return outputDir;
}

/**
 * Generate a unique filename for the image using cryptographic randomness.
 */
function generateImageFilename(mimeType: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = randomBytes(4).toString('hex');
  
  const lower = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  let ext = 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) {
    ext = 'jpg';
  } else if (lower.includes('gif')) {
    ext = 'gif';
  } else if (lower.includes('webp')) {
    ext = 'webp';
  }
  
  return `image-${timestamp}-${random}.${ext}`;
}

/**
 * Save base64 image data to disk and return the file path.
 * 
 * @param base64Data - The base64-encoded image data
 * @param mimeType - The MIME type of the image (e.g., "image/jpeg")
 * @returns The absolute path to the saved image file
 */
export function saveImageToDisk(base64Data: string, mimeType: string): string {
  try {
    if (!base64Data || typeof base64Data !== "string" || base64Data.length > MAX_IMAGE_BASE64_LENGTH) {
      return '';
    }
    const outputDir = getImageOutputDir();
    const filename = generateImageFilename(mimeType);
    const filePath = path.join(outputDir, filename);
    
    // Decode base64 and write to file with secure 0600 mode
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer, { mode: 0o600 });
    
    return filePath;
  } catch (error) {
    // If saving fails, return empty string (caller will fall back to base64)
    console.error('[image-saver] Failed to save image:', error);
    return '';
  }
}

/**
 * Process inlineData and return either a file path or base64 data URL.
 * Attempts to save to disk first, falls back to base64 if saving fails.
 * 
 * @param inlineData - Object containing mimeType and base64 data
 * @returns Markdown image string with either file path or data URL
 */
export function processImageData(inlineData: { mimeType?: string; data?: string }): string | null {
  const mimeType = inlineData.mimeType || 'image/png';
  const data = inlineData.data;
  
  if (!data) {
    return null;
  }
  
  // Try to save to disk first
  const filePath = saveImageToDisk(data, mimeType);
  
  if (filePath) {
    // Successfully saved - return file path with open command hint
    return `![Generated Image](${filePath})\n\nImage saved to: \`${filePath}\`\n\nTo view: \`open "${filePath}"\``;
  }
  
  // Fall back to base64 data URL
  return `![Generated Image](data:${mimeType};base64,${data})`;
}

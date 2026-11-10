declare module "@openauthjs/openauth/pkce" {
  interface PkcePair {
    challenge: string;
    verifier: string;
  }

  export function generatePKCE(): Promise<PkcePair>;
}

declare module "@ai-sdk/provider" {
  export type LanguageModelV3StreamPart = any;
}

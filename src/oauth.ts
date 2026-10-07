const callbackKeys = ["code", "state", "error", "error_description"] as const;

// Evaluate before importing IdentityManager, which may consume the return URL.
export const initialOAuthUrl = typeof window === "undefined" ? null : new URL(window.location.href);

export function readOAuthCallback(url: URL) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const value = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  return {
    code: value("code"),
    error: value("error"),
    description: value("error_description"),
  };
}

export function withoutOAuthCallback(url: URL): string {
  const clean = new URL(url);
  const hash = new URLSearchParams(clean.hash.replace(/^#/, ""));
  const hasCallbackHash = callbackKeys.some((key) => hash.has(key));
  for (const key of callbackKeys) {
    clean.searchParams.delete(key);
    hash.delete(key);
  }
  if (hasCallbackHash) clean.hash = hash.toString();
  return clean.pathname + clean.search + clean.hash;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

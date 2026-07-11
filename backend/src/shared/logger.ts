const REDACTED_KEYS = new Set([
  "authorization",
  "clientSecret",
  "refreshToken",
  "accessToken",
  "token",
  "password",
  "secret"
]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        REDACTED_KEYS.has(key) ? "[REDACTED]" : sanitize(item)
      ])
    );
  }
  return value;
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown> = {}
): void {
  const safeContext = sanitize(context) as Record<string, unknown>;
  const entry = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...safeContext
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

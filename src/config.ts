// Env-var access with explicit "missing" semantics.
// Each adapter calls requireEnv() at use-time, not at module-load time, so the server
// can boot even when some adapters are unconfigured (the corresponding tools will just
// return a config_missing error per call).

export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function requireEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function decodeJsonEnv<T = Record<string, unknown>>(name: string): T {
  const raw = requireEnv(name);
  let text = raw;
  if (!raw.trim().startsWith("{")) {
    try {
      text = Buffer.from(raw, "base64").toString("utf-8");
    } catch {
      throw new Error(`${name} is neither JSON nor base64-encoded JSON`);
    }
  }
  return JSON.parse(text) as T;
}

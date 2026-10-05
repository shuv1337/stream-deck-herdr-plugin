import net from "node:net";
import os from "node:os";
import path from "node:path";

// Mirrors herdr's own socket resolution: an explicit HERDR_SOCKET_PATH wins,
// then a named session (HERDR_SESSION) under <config>/herdr/sessions/<name>/,
// else the default session socket under <config>/herdr/.
export function herdrSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  const appDir = path.join(configHome, "herdr");
  const session = env.HERDR_SESSION?.trim();
  return session
    ? path.join(appDir, "sessions", session, "herdr.sock")
    : path.join(appDir, "herdr.sock");
}

// Pure: split an accumulated buffer + new chunk into complete lines and the
// remaining partial line. Keeps multi-chunk JSON lines intact.
export function feedLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}

export type ApiError = { code: string; message: string };

export class HerdrApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
    message: string,
  ) {
    super(`${method}: ${code}: ${message}`);
  }
}

type Envelope = { id?: string; result?: unknown; error?: ApiError };

// Pure: interpret one response line for a request id. Returns the result, or
// throws for an error envelope / malformed line.
export function parseResponse(method: string, line: string): unknown {
  let env: Envelope;
  try {
    env = JSON.parse(line) as Envelope;
  } catch {
    throw new HerdrApiError(method, "invalid_response", `not JSON: ${line.slice(0, 120)}`);
  }
  if (env.error) throw new HerdrApiError(method, env.error.code, env.error.message);
  if (!("result" in env)) throw new HerdrApiError(method, "invalid_response", "missing result");
  return env.result;
}

export type RequestFn = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

let seq = 0;

// herdr's API socket serves exactly one JSON request per connection (only
// events.subscribe streams), so every call opens a fresh connection, writes a
// single line and reads back a single line.
export function createSocketRequest(opts: { socketPath?: string; timeoutMs?: number } = {}): RequestFn {
  const timeoutMs = opts.timeoutMs ?? 4000;
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const sockPath = opts.socketPath ?? herdrSocketPath();
      const id = `sd:${method}:${++seq}`;
      const conn = net.createConnection(sockPath);
      let buffer = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.destroy();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new HerdrApiError(method, "timeout", `no response in ${timeoutMs}ms`))),
        timeoutMs,
      );
      conn.setEncoding("utf8");
      conn.on("connect", () => {
        conn.write(`${JSON.stringify({ id, method, params })}\n`);
      });
      conn.on("data", (chunk: string) => {
        const fed = feedLines(buffer, chunk);
        buffer = fed.rest;
        const line = fed.lines[0];
        if (line === undefined) return;
        finish(() => {
          try {
            resolve(parseResponse(method, line));
          } catch (e) {
            reject(e);
          }
        });
      });
      conn.on("error", (err) =>
        finish(() => reject(new HerdrApiError(method, "socket_error", err.message))),
      );
      conn.on("close", () =>
        finish(() => reject(new HerdrApiError(method, "closed", "connection closed before a response"))),
      );
    });
}

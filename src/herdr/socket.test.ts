import { test, expect } from "bun:test";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  feedLines,
  herdrSocketPath,
  parseResponse,
  createSocketRequest,
  HerdrApiError,
} from "./socket";

test("feedLines returns complete lines and keeps the partial remainder", () => {
  const a = feedLines("", '{"a":1}\n{"b":2}\n{"c"');
  expect(a.lines).toEqual(['{"a":1}', '{"b":2}']);
  expect(a.rest).toBe('{"c"');
  const b = feedLines(a.rest, ":3}\n");
  expect(b.lines).toEqual(['{"c":3}']);
  expect(b.rest).toBe("");
});

test("feedLines drops blank lines", () => {
  expect(feedLines("", "\n\n").lines).toEqual([]);
});

test("herdrSocketPath mirrors herdr: override, named session, default", () => {
  expect(herdrSocketPath({ HERDR_SOCKET_PATH: "/tmp/x.sock" })).toBe("/tmp/x.sock");
  expect(herdrSocketPath({ XDG_CONFIG_HOME: "/cfg", HERDR_SESSION: "work" })).toBe(
    "/cfg/herdr/sessions/work/herdr.sock",
  );
  expect(herdrSocketPath({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/herdr/herdr.sock");
  expect(herdrSocketPath({})).toBe(path.join(os.homedir(), ".config", "herdr", "herdr.sock"));
});

test("parseResponse unwraps result and surfaces herdr error envelopes", () => {
  expect(parseResponse("ping", '{"id":"1","result":{"type":"pong"}}')).toEqual({ type: "pong" });
  expect(() => parseResponse("agent.focus", '{"id":"1","error":{"code":"agent_not_found","message":"nope"}}'))
    .toThrow(HerdrApiError);
  try {
    parseResponse("agent.focus", '{"id":"1","error":{"code":"agent_not_found","message":"nope"}}');
  } catch (e) {
    expect((e as HerdrApiError).code).toBe("agent_not_found");
  }
  expect(() => parseResponse("x", "garbage")).toThrow("invalid_response");
  expect(() => parseResponse("x", '{"id":"1"}')).toThrow("missing result");
});

// Fake herdr: one JSON request per connection, one JSON line back.
function fakeServer(handle: (req: { id: string; method: string; params: unknown }) => unknown): Promise<{
  path: string;
  close(): void;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-herdr-"));
  const sockPath = path.join(dir, "herdr.sock");
  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const req = JSON.parse(buf.slice(0, nl));
      const result = handle(req);
      const envelope =
        result instanceof Error
          ? { id: req.id, error: { code: result.name, message: result.message } }
          : { id: req.id, result };
      conn.end(`${JSON.stringify(envelope)}\n`);
    });
  });
  return new Promise((resolve) =>
    server.listen(sockPath, () =>
      resolve({
        path: sockPath,
        close: () => {
          server.close();
          fs.rmSync(dir, { recursive: true, force: true });
        },
      }),
    ),
  );
}

test("createSocketRequest round-trips one request per connection", async () => {
  const seen: string[] = [];
  const srv = await fakeServer((req) => {
    seen.push(req.method);
    if (req.method === "boom") {
      const e = new Error("bad target");
      e.name = "agent_not_found";
      return e;
    }
    return { type: "pong", echo: req.params };
  });
  try {
    const request = createSocketRequest({ socketPath: srv.path, timeoutMs: 2000 });
    const [a, b] = await Promise.all([request("ping"), request("agent.focus", { target: "w1:p1" })]);
    expect(a).toEqual({ type: "pong", echo: {} });
    expect(b).toEqual({ type: "pong", echo: { target: "w1:p1" } });
    await expect(request("boom")).rejects.toThrow("agent_not_found");
    expect(seen.sort()).toEqual(["agent.focus", "boom", "ping"]);
  } finally {
    srv.close();
  }
});

test("createSocketRequest rejects when the socket is missing", async () => {
  const request = createSocketRequest({ socketPath: "/nonexistent/herdr.sock", timeoutMs: 500 });
  await expect(request("ping")).rejects.toThrow(HerdrApiError);
});

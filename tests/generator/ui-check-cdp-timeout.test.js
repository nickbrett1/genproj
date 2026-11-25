import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/**
 * Regression for the ui-check.mjs hang (found on the first real devcontainer
 * run, Phase 5 ui-registry).
 *
 * `CdpSession.send()` used to settle only on a response or a synchronous send
 * error. `Page.navigate` to a container-loopback URL in a host browser never
 * answers, so the promise never settled and the process never wrote a verdict —
 * `--timeout`, documented as the "overall budget", did not bound the run.
 *
 * These assertions are behavioural, not string matches: the unit test drives a
 * real `CdpSession` against a socket that stays silent, and the integration
 * test runs the emitted script against a fake CDP endpoint that stalls
 * `Page.navigate` and asserts on the verdict JSON it prints.
 *
 * `UI_CHECK_TEMPLATE` exists so this same file can be run against a previous
 * revision of the template to prove it is load-bearing (old → fail,
 * new → pass). It defaults to the checked-in template.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath =
  process.env.UI_CHECK_TEMPLATE ||
  path.resolve(here, "../../src/generator/templates/ui-check-mjs.template");
const repoRoot = path.resolve(here, "../..");

const templateSource = readFileSync(templatePath, "utf8");

// Node will not run a `.template` file (unknown extension), so materialise it
// once as a real .mjs for the child-process tests.
const runnablePath = path.join(
  mkdtempSync(path.join(os.tmpdir(), "ui-check-")),
  "ui-check.mjs",
);
writeFileSync(runnablePath, templateSource);

/** Load the template's top-level classes/functions without running main(). */
function loadTemplateExports() {
  const withoutRunner = templateSource.replace(
    /\nmain\(\)\s*\n\s*\.then\([\s\S]*$/,
    "\n",
  );
  expect(withoutRunner).not.toMatch(/\nmain\(\)/);
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Buffer,
    WebSocket: class {},
  });
  // eslint-disable-next-line sonarjs/code-eval -- deliberate: execute the template's own source in an isolated vm context to reach CdpSession without running main().
  vm.runInContext(
    `${withoutRunner}\n;globalThis.__exports = {
      CdpSession,
      DEFAULT_CDP_COMMAND_TIMEOUT_MS: typeof DEFAULT_CDP_COMMAND_TIMEOUT_MS === "undefined" ? undefined : DEFAULT_CDP_COMMAND_TIMEOUT_MS,
      LOOPBACK_NAVIGATION_TIMEOUT_MS: typeof LOOPBACK_NAVIGATION_TIMEOUT_MS === "undefined" ? undefined : LOOPBACK_NAVIGATION_TIMEOUT_MS,
    };`,
    context,
  );
  return context.__exports;
}

// --- minimal WebSocket server: no dependency beyond node:http/node:crypto ---

function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([header, payload]);
}

/** Drain complete client frames from `buffer`; client frames are masked. */
function drainFrames(buffer, onText, onClose) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (buffer.length < cursor + 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buffer.length < cursor + length) break;
    const data = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    if (opcode === 0x1) onText(data.toString("utf8"));
    if (opcode === 0x8) onClose();
    offset = cursor + length;
  }
  return buffer.subarray(offset);
}

/**
 * A fake CDP endpoint. Answers /json/version, completes the WS handshake, and
 * replies to every command except the ones in `stall`, which are swallowed.
 */
async function startFakeCdp(options = {}) {
  const stall = new Set(options.stall ?? []);
  const emitAfterNavigate = options.emitAfterNavigate ?? [];
  const received = [];
  const sockets = new Set();
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          Browser: "FakeChrome/1.0",
          "Protocol-Version": "1.3",
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake`,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // eslint-disable-next-line sonarjs/hashing -- SHA-1 is mandated by RFC 6455 for the WebSocket handshake; it is not a security boundary.
    const accept = createHash("sha1")
      .update(
        `${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
        `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = drainFrames(
        Buffer.concat([buffer, chunk]),
        (text) => {
          const msg = JSON.parse(text);
          received.push(msg.method);
          if (stall.has(msg.method)) return;
          let result = {};
          if (msg.method === "Target.createTarget")
            result = { targetId: "FAKE-TARGET" };
          if (msg.method === "Target.attachToTarget")
            result = { sessionId: "FAKE-SESSION" };
          if (msg.method === "Target.closeTarget") result = { success: true };
          if (msg.method === "Runtime.evaluate") {
            result = {
              result: {
                value: {
                  title: "Fake",
                  url: "http://fake/",
                  selectors: [],
                  scrollWidth: 800,
                  clientWidth: 800,
                },
              },
            };
          }
          socket.write(encodeTextFrame(JSON.stringify({ id: msg.id, result })));
          if (msg.method === "Page.navigate") {
            for (const event of emitAfterNavigate) {
              socket.write(encodeTextFrame(JSON.stringify(event)));
            }
          }
        },
        () => socket.end(),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    received,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Static page that tier 1 will fetch successfully. */
async function startPageServer(html) {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runUiCheck(args, waitMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runnablePath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, waitMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

const PAGE_HTML =
  "<!doctype html><html><head><title>Local App</title></head><body>" +
  "<h1>Hello local app</h1><p>Loopback-bound dev server page with enough text to " +
  "avoid the empty-shell warning.</p></body></html>";

describe("CdpSession bounds every command (unit)", () => {
  it("rejects a command the browser never answers instead of hanging", async () => {
    const { CdpSession } = loadTemplateExports();
    class SilentWebSocket {
      addEventListener() {}
      send() {}
      close() {}
    }
    // The deadline is the only thing that can settle this send.
    const session = new CdpSession(new SilentWebSocket(), Date.now() + 80);
    const outcome = await Promise.race([
      session.send("Page.navigate", { url: "http://127.0.0.1:1/" }).then(
        () => "resolved",
        (err) => `rejected: ${err.message}`,
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve("still-pending"), 1500),
      ),
    ]);
    expect(outcome).toMatch(
      /^rejected: CDP command Page\.navigate did not respond within \d+ms$/,
    );
  });

  it("closes its target even when the deadline is already spent", async () => {
    // The path this guards: a command (Page.navigate / Runtime.evaluate) runs the
    // deadline out, then finally tries Target.closeTarget. send() clamps to the
    // 1ms floor there, so the close rejected and the swallowed error leaked the
    // tab. sendCleanup() must ignore the deadline and still complete.
    const { CdpSession } = loadTemplateExports();
    class SlowWebSocket {
      constructor() {
        this.listeners = [];
      }
      addEventListener(type, fn) {
        if (type === "message") this.listeners.push(fn);
      }
      send(raw) {
        const { id } = JSON.parse(raw);
        setTimeout(
          () =>
            this.listeners.forEach((fn) =>
              fn({ data: JSON.stringify({ id, result: { success: true } }) }),
            ),
          20,
        );
      }
      close() {}
    }
    const expired = () => new CdpSession(new SlowWebSocket(), Date.now() - 1);

    await expect(
      expired().send("Target.closeTarget", { targetId: "T" }),
    ).rejects.toThrow(/did not respond within 1ms/);
    await expect(
      expired().sendCleanup("Target.closeTarget", { targetId: "T" }),
    ).resolves.toEqual({ success: true });
  });

  it("still resolves a command the browser answers", async () => {
    const { CdpSession } = loadTemplateExports();
    class EchoWebSocket {
      constructor() {
        this.listeners = [];
      }
      addEventListener(type, fn) {
        if (type === "message") this.listeners.push(fn);
      }
      send(raw) {
        const { id } = JSON.parse(raw);
        setImmediate(() =>
          this.listeners.forEach((fn) =>
            fn({ data: JSON.stringify({ id, result: { ok: true } }) }),
          ),
        );
      }
      close() {}
    }
    const session = new CdpSession(new EchoWebSocket(), Date.now() + 5000);
    await expect(session.send("Runtime.enable")).resolves.toEqual({ ok: true });
  });
});

describe("a stalled Page.navigate degrades to tier 1, it does not hang", () => {
  it("prints a tier-1 verdict with a tier2SkipReason and exits 0", async () => {
    const page = await startPageServer(PAGE_HTML);
    const cdp = await startFakeCdp({ stall: ["Page.navigate"] });
    try {
      const result = await runUiCheck(
        ["--json", "--url", page.url, "--cdp", cdp.base, "--timeout", "5000"],
        20000,
      );

      expect(
        result.timedOut,
        `ui-check hung; stdout=${result.stdout} stderr=${result.stderr}`,
      ).toBe(false);
      expect(
        result.code,
        `stdout=${result.stdout} stderr=${result.stderr}`,
      ).toBe(0);

      const verdict = JSON.parse(result.stdout.trim());
      expect(verdict.tier).toBe(1);
      expect(verdict.tiersAttempted).toEqual([1, 2]);
      expect(verdict.ok).toBe(true);
      expect(verdict.tier2SkipReason).toMatch(/did not complete/);
      expect(verdict.evidence.tier2StoppedEarly).toBe(true);
      expect(verdict.durationMs).toBeLessThan(5000);
      // A shared estate browser must not be left with a tab behind: the
      // timeout path still reaches the finally block and closes its target.
      expect(cdp.received).toContain("Target.closeTarget");
    } finally {
      await page.close();
      await cdp.close();
    }
  }, 30000);

  it("does not turn a real page exception into a skip", async () => {
    const page = await startPageServer(PAGE_HTML);
    const cdp = await startFakeCdp({
      emitAfterNavigate: [
        { method: "Page.loadEventFired", params: {} },
        {
          method: "Runtime.exceptionThrown",
          params: {
            exceptionDetails: {
              exception: { description: "Error: boom-should-fail" },
            },
          },
        },
      ],
    });
    try {
      const result = await runUiCheck(
        ["--json", "--url", page.url, "--cdp", cdp.base, "--timeout", "5000"],
        20000,
      );

      expect(result.timedOut).toBe(false);
      expect(
        result.code,
        `stdout=${result.stdout} stderr=${result.stderr}`,
      ).toBe(1);
      const verdict = JSON.parse(result.stdout.trim());
      expect(verdict.tier).toBe(2);
      expect(verdict.tier2SkipReason).toBeNull();
      expect(verdict.errors.map((e) => e.code)).toContain("uncaught-exception");
    } finally {
      await page.close();
      await cdp.close();
    }
  }, 30000);
});

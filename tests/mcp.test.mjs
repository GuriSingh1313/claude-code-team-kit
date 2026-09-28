import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ROOT, makeProject, cleanup } from "./helpers.mjs";

const SERVER = join(ROOT, ".claude", "mcp", "repo-tools-server.mjs");

/** Minimal JSON-RPC client over the server's stdio. */
function startServer(projectDir) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

test("MCP handshake, tool listing and tool calls", async () => {
  const dir = makeProject({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "vitest", lint: "eslint ." } }),
    "src/a.js": "// TODO: handle retries\nexport const a = 1;\n",
  });
  const s = startServer(dir);
  try {
    const init = await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "repo-tools");
    assert.ok(init.result.capabilities.tools);
    s.notify("notifications/initialized");

    const list = await s.request("tools/list");
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ["find_todos", "project_commands", "readiness_audit"]);
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");

    const cmds = await s.request("tools/call", { name: "project_commands", arguments: {} });
    assert.equal(cmds.result.isError, false);
    assert.equal(JSON.parse(cmds.result.content[0].text).commands.test, "npm test");

    const todos = await s.request("tools/call", { name: "find_todos", arguments: { limit: 5 } });
    assert.match(todos.result.content[0].text, /src\/a\.js:1: TODO handle retries/);

    const auditRes = await s.request("tools/call", { name: "readiness_audit", arguments: {} });
    assert.match(auditRes.result.content[0].text, /Claude Code Readiness Report/);

    const unknown = await s.request("tools/call", { name: "nope", arguments: {} });
    assert.equal(unknown.error.code, -32602);
    const badMethod = await s.request("resources/list");
    assert.equal(badMethod.error.code, -32601);
    const ping = await s.request("ping");
    assert.deepEqual(ping.result, {});
  } finally {
    s.close();
    cleanup(dir);
  }
});

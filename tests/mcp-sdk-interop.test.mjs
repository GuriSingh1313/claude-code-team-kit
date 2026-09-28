// Proves the zero-dependency server interoperates with the official MCP TypeScript SDK client.
// The SDK is a devDependency only; this test is skipped if it isn't installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ROOT, makeProject, cleanup } from "./helpers.mjs";

let sdk = null;
try {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  sdk = { Client, StdioClientTransport };
} catch {
  sdk = null;
}

test("official MCP SDK client can connect, list and call tools", { skip: !sdk && "MCP SDK not installed" }, async () => {
  const dir = makeProject({ "go.mod": "module example.com/x\n", "main.go": "package main\n// FIXME: config loading\n" });
  const transport = new sdk.StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, ".claude", "mcp", "repo-tools-server.mjs")],
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  const client = new sdk.Client({ name: "interop-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["find_todos", "project_commands", "readiness_audit"]);

    const cmds = await client.callTool({ name: "project_commands", arguments: {} });
    assert.equal(JSON.parse(cmds.content[0].text).commands.test, "go test ./...");

    const todos = await client.callTool({ name: "find_todos", arguments: { limit: 10 } });
    assert.match(todos.content[0].text, /main\.go:2: FIXME config loading/);
  } finally {
    await client.close();
    cleanup(dir);
  }
});

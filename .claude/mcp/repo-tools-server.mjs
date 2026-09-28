#!/usr/bin/env node
// repo-tools: a zero-dependency MCP server (stdio, JSON-RPC 2.0, newline-delimited).
// Gives Claude three project tools without adding anything to the project's dependencies:
//   readiness_audit   - score the repo for AI-agent readiness and list fixes
//   project_commands  - detected stack and the exact build/test/lint/dev commands
//   find_todos        - TODO/FIXME/HACK markers with file:line
import { createInterface } from "node:readline";
import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { audit, renderMarkdown } from "../tools/claude-ready.mjs";
import { detectProject, walkFiles } from "../tools/project-info.mjs";

const SERVER_INFO = { name: "repo-tools", version: "1.0.0" };
const FALLBACK_PROTOCOL = "2025-06-18";
const BASE_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const pathProp = { type: "string", description: "Directory to inspect, relative to the project root. Defaults to the project root." };

const TOOLS = [
  {
    name: "readiness_audit",
    description: "Score the repository 0-100 for Claude Code readiness (context, safety, verification, hygiene) and list fixes in priority order.",
    inputSchema: { type: "object", properties: { path: pathProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: ({ path }) => renderMarkdown(audit(resolveDir(path))),
  },
  {
    name: "project_commands",
    description: "Detect the project's stack, package manager and the exact commands to build, test, lint, format, type-check and run it.",
    inputSchema: { type: "object", properties: { path: pathProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: ({ path }) => JSON.stringify(detectProject(resolveDir(path)), null, 2),
  },
  {
    name: "find_todos",
    description: "List TODO, FIXME, HACK and XXX markers in source files as file:line: text.",
    inputSchema: {
      type: "object",
      properties: { path: pathProp, limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum results (default 50)." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: ({ path, limit = 50 }) => findTodos(resolveDir(path), limit),
  },
];

function resolveDir(path) {
  return path ? resolve(BASE_DIR, path) : BASE_DIR;
}

export function findTodos(dir, limit = 50) {
  const out = [];
  for (const rel of walkFiles(dir)) {
    if (!/\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte|c|cc|cpp|h|hpp|sh|sql|ya?ml|md)$/i.test(rel)) continue;
    let text;
    try {
      if (statSync(join(dir, rel)).size > 512 * 1024) continue;
      text = readFileSync(join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\b(TODO|FIXME|HACK|XXX)\b[:\s(]?(.*)$/);
      if (m) out.push(`${rel}:${i + 1}: ${m[1]} ${m[2].trim().slice(0, 160)}`.trimEnd());
      if (out.length >= limit) return out.join("\n");
    }
  }
  return out.length ? out.join("\n") : "No TODO/FIXME/HACK/XXX markers found.";
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

export function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) return; // notifications (e.g. notifications/initialized) need no reply

  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      reply(id, {
        protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(requested || "") ? requested : FALLBACK_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Use project_commands before running build/test commands, and readiness_audit when asked how AI-ready the repo is.",
      });
      return;
    }
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
      return;
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) {
        replyError(id, -32602, `Unknown tool: ${params.name}`);
        return;
      }
      try {
        const text = tool.run(params.arguments || {});
        reply(id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        reply(id, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
      }
      return;
    }
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    replyError(null, -32700, "Parse error");
    return;
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
});
rl.on("close", () => process.exit(0));

#!/usr/bin/env node
// PostToolUse hook for Edit, Write and MultiEdit.
// Formats the edited file with the formatter the project already uses. It never
// introduces a formatter the team hasn't chosen, and it never fails the tool call.
import { existsSync, readFileSync } from "node:fs";
import { join, extname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readHookInput, projectDir, isMain } from "./lib.mjs";

const PRETTIER_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json", ".css", ".scss", ".less",
  ".html", ".vue", ".svelte", ".md", ".mdx", ".yml", ".yaml", ".graphql",
]);

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Pick formatter invocations for a file, in preference order. Exported for tests. */
export function formatterCandidates(dir, file) {
  const ext = extname(file).toLowerCase();
  const out = [];
  if (PRETTIER_EXT.has(ext)) {
    const biomeBin = join(dir, "node_modules", "@biomejs", "biome", "bin", "biome");
    if (existsSync(join(dir, "biome.json")) && existsSync(biomeBin)) {
      out.push([process.execPath, [biomeBin, "format", "--write", file]]);
    }
    const prettierBin = join(dir, "node_modules", "prettier", "bin", "prettier.cjs");
    if (existsSync(prettierBin)) out.push([process.execPath, [prettierBin, "--write", "--log-level", "warn", file]]);
  }
  if (ext === ".py" || ext === ".pyi") {
    const pyproject = readText(join(dir, "pyproject.toml"));
    if (/\[tool\.ruff/.test(pyproject) || existsSync(join(dir, "ruff.toml"))) out.push(["ruff", ["format", file]]);
    if (/\[tool\.black/.test(pyproject)) out.push(["black", ["-q", file]]);
  }
  if (ext === ".go") out.push(["gofmt", ["-w", file]]);
  if (ext === ".rs") out.push(["rustfmt", ["--edition", "2021", file]]);
  return out;
}

if (isMain(import.meta.url)) {
  const input = readHookInput();
  const dir = projectDir(input);
  const raw = input.tool_input?.file_path;
  if (raw && process.env.CLAUDE_FORMAT_ON_SAVE !== "0") {
    const file = isAbsolute(raw) ? raw : resolve(dir, raw);
    if (existsSync(file)) {
      for (const [cmd, args] of formatterCandidates(dir, file)) {
        const r = spawnSync(cmd, args, { cwd: dir, timeout: 20000, stdio: "ignore" });
        if (!r.error && r.status === 0) break;
      }
    }
  }
  process.exit(0);
}

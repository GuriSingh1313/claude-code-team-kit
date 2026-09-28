#!/usr/bin/env node
// SessionStart hook: gives Claude a short, current snapshot of the repo so the first
// answer is grounded (branch, uncommitted work, recent commits, how to test).
import { spawnSync } from "node:child_process";
import { readHookInput, emitAdditionalContext, projectDir, isMain } from "./lib.mjs";
import { detectProject } from "../tools/project-info.mjs";

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : "";
}

export function buildContext(dir) {
  const lines = [];
  const branch = git(dir, ["branch", "--show-current"]);
  if (branch) {
    const status = git(dir, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
    const log = git(dir, ["log", "--oneline", "-5"]);
    lines.push(`Git branch: ${branch}${/^(main|master)$/.test(branch) ? " (default branch: create a feature branch before committing)" : ""}`);
    lines.push(`Uncommitted files: ${status.length}${status.length ? ` (${status.slice(0, 8).map((l) => l.slice(3)).join(", ")}${status.length > 8 ? ", ..." : ""})` : ""}`);
    if (log) lines.push(`Recent commits:\n${log}`);
  }
  const { stacks, commands } = detectProject(dir);
  if (stacks.length) lines.push(`Stack: ${stacks.join(", ")}`);
  const cmds = Object.entries(commands).filter(([, v]) => v).map(([k, v]) => `${k}: \`${v}\``);
  if (cmds.length) lines.push(`Commands: ${cmds.join(" | ")}`);
  if (!commands.test) lines.push("No test command detected: say so before claiming a change works.");
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  const input = readHookInput();
  const context = buildContext(projectDir(input));
  if (context) emitAdditionalContext("SessionStart", context);
  process.exit(0);
}

#!/usr/bin/env node
// Stop hook: Claude may not declare a task finished while the project's tests fail.
//
// When Claude stops after changing code, this runs the test command. If it fails,
// the hook exits 2 and sends the failure tail back so Claude keeps working.
// A per-session attempt counter stops endless loops (default: 3 retries).
//
// Optional .claude/verify.json:
//   { "command": "npm test", "timeoutSeconds": 240, "maxAttempts": 3, "onlyWhenChanged": true }
// Disable for one session with CLAUDE_VERIFY_ON_STOP=0.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readHookInput, projectDir, readKitConfig, isMain } from "./lib.mjs";
import { detectProject } from "../tools/project-info.mjs";

const CODE_FILE = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|kt|kts|rb|php|cs|swift|c|cc|cpp|h|hpp|vue|svelte|sql|scala|ex|exs|dart)$/i;

/** Files changed in the working tree (null when not a git repo). */
export function changedCodeFiles(dir) {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((f) => CODE_FILE.test(f));
}

function stateFile(sessionId) {
  const safe = String(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  return join(tmpdir(), `claude-verify-on-stop-${safe}.json`);
}

function readAttempts(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).attempts || 0;
  } catch {
    return 0;
  }
}

/** Core logic, separated for tests. Returns { exitCode, message }. */
export function verify(input, env = process.env) {
  if (env.CLAUDE_VERIFY_ON_STOP === "0") return { exitCode: 0 };
  const dir = env.CLAUDE_PROJECT_DIR || projectDir(input);
  const cfg = readKitConfig(dir, "verify.json");
  const maxAttempts = cfg.maxAttempts ?? 3;
  const state = stateFile(input.session_id);

  if (!input.stop_hook_active && existsSync(state)) rmSync(state, { force: true });
  const attempts = readAttempts(state);
  if (input.stop_hook_active && attempts >= maxAttempts) {
    rmSync(state, { force: true });
    return { exitCode: 1, message: `verify-on-stop: tests still failing after ${attempts} attempts; handing back to you.` };
  }

  if (cfg.onlyWhenChanged !== false) {
    const changed = changedCodeFiles(dir);
    if (changed && changed.length === 0) return { exitCode: 0 };
  }

  const command = cfg.command || detectProject(dir).commands.test;
  if (!command) return { exitCode: 0 };

  const timeoutMs = (cfg.timeoutSeconds ?? 240) * 1000;
  const r = spawnSync(command, {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...env, CI: "1", FORCE_COLOR: "0" },
  });

  if (r.error && r.error.code === "ETIMEDOUT") {
    return { exitCode: 1, message: `verify-on-stop: \`${command}\` timed out after ${timeoutMs / 1000}s; not blocking.` };
  }
  if (r.status === 0) {
    rmSync(state, { force: true });
    return { exitCode: 0 };
  }

  writeFileSync(state, JSON.stringify({ attempts: attempts + 1 }));
  const output = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split(/\r?\n/);
  const tail = output.slice(-80).join("\n");
  return {
    exitCode: 2,
    message:
      `The tests are failing (\`${command}\`, exit ${r.status}). The task is not done yet.\n` +
      `Fix the cause (do not skip, delete or weaken tests), re-run \`${command}\`, then finish.\n\n` +
      `--- last ${Math.min(80, output.length)} lines ---\n${tail}`,
  };
}

if (isMain(import.meta.url)) {
  const { exitCode, message } = verify(readHookInput());
  if (message) process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

// Shared helpers for the kit's hooks. Zero dependencies, Node 18+.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Read the JSON payload Claude Code sends to a hook on stdin. Never throws. */
export function readHookInput() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Emit a PreToolUse decision ("allow" | "deny" | "ask") on stdout. */
export function emitPreToolDecision(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
}

/** Emit extra context for SessionStart / PostToolUse style events. */
export function emitAdditionalContext(hookEventName, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }));
}

/** The project root Claude Code was started in. */
export function projectDir(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/** Read an optional JSON config file from .claude/, returning {} when absent or invalid. */
export function readKitConfig(dir, fileName) {
  const file = join(dir, ".claude", fileName);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** True when this module is the entry point (so tests can import without side effects). */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(fileURLToPath(importMetaUrl)) === norm(process.argv[1]);
}

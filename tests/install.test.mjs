import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installKit, mergeSettings } from "../scripts/install.mjs";
import { makeProject, cleanup } from "./helpers.mjs";

test("installs into a bare repo, raises the score, and is idempotent", () => {
  const dir = makeProject({ "package.json": JSON.stringify({ name: "shop", scripts: { test: "vitest run" } }) });
  try {
    const log = installKit(dir);
    assert.ok(log.after.value > log.before.value, `${log.before.value} -> ${log.after.value}`);
    for (const f of [".claude/hooks/guard-bash.mjs", ".claude/tools/claude-ready.mjs", ".claude/mcp/repo-tools-server.mjs", ".claude/agents/code-reviewer.md", ".claude/skills/ship/SKILL.md", ".mcp.json", "CLAUDE.md"]) {
      assert.ok(existsSync(join(dir, f)), f);
    }
    const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /^# shop/);
    assert.match(claudeMd, /Test: `npm test`/);

    const second = installKit(dir);
    assert.equal(second.copied.length, 0);
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.PreToolUse.length, 2, "hooks must not be duplicated on re-install");
  } finally {
    cleanup(dir);
  }
});

test("merges with existing team settings instead of overwriting them", () => {
  const existing = {
    model: "opus",
    permissions: { allow: ["Bash(make *)"], deny: ["Read(.env)"] },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./team-hook.sh" }] }] },
  };
  const kit = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
  const merged = mergeSettings(existing, kit);
  assert.equal(merged.model, "opus");
  assert.ok(merged.permissions.allow.includes("Bash(make *)"));
  assert.equal(merged.permissions.deny.filter((r) => r === "Read(.env)").length, 1);
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].command, "./team-hook.sh");
  assert.ok(merged.hooks.Stop.length >= 1);
});

test("dry run touches nothing", () => {
  const dir = makeProject({ "README.md": "x" });
  try {
    const log = installKit(dir, { dryRun: true });
    assert.ok(log.copied.length > 0);
    assert.ok(!existsSync(join(dir, ".claude")));
    assert.ok(!existsSync(join(dir, "CLAUDE.md")));
  } finally {
    cleanup(dir);
  }
});

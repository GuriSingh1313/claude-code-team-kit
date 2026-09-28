import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verify } from "../.claude/hooks/verify-on-stop.mjs";
import { makeProject, cleanup, runHook, git } from "./helpers.mjs";

const failingPkg = JSON.stringify({ scripts: { test: 'node -e "console.error(\'expected 2 got 3\'); process.exit(1)"' } });
const passingPkg = JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } });
const always = JSON.stringify({ onlyWhenChanged: false });

test("blocks the stop and feeds back failures while tests are red", () => {
  const dir = makeProject({ "package.json": failingPkg, ".claude/verify.json": always });
  try {
    const r = runHook("verify-on-stop.mjs", { session_id: randomUUID(), stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /tests are failing/i);
    assert.match(r.stderr, /expected 2 got 3/);
  } finally {
    cleanup(dir);
  }
});

test("lets Claude stop when tests pass", () => {
  const dir = makeProject({ "package.json": passingPkg, ".claude/verify.json": always });
  try {
    const r = runHook("verify-on-stop.mjs", { session_id: randomUUID() }, { CLAUDE_PROJECT_DIR: dir });
    assert.equal(r.code, 0);
  } finally {
    cleanup(dir);
  }
});

test("gives up after maxAttempts instead of looping forever", () => {
  const dir = makeProject({ "package.json": failingPkg, ".claude/verify.json": JSON.stringify({ onlyWhenChanged: false, maxAttempts: 2 }) });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const session_id = randomUUID();
  try {
    assert.equal(verify({ session_id, stop_hook_active: false }, env).exitCode, 2);
    assert.equal(verify({ session_id, stop_hook_active: true }, env).exitCode, 2);
    const last = verify({ session_id, stop_hook_active: true }, env);
    assert.equal(last.exitCode, 1);
    assert.match(last.message, /still failing after 2 attempts/);
  } finally {
    cleanup(dir);
  }
});

test("skips when no code changed, or when disabled, or when there is no test command", () => {
  const dir = makeProject({ "package.json": failingPkg, "README.md": "x" });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  try {
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    assert.equal(verify({ session_id: randomUUID() }, env).exitCode, 0, "clean tree");
    assert.equal(verify({ session_id: randomUUID() }, { ...env, CLAUDE_VERIFY_ON_STOP: "0" }).exitCode, 0, "disabled");
  } finally {
    cleanup(dir);
  }
  const none = makeProject({ "notes.txt": "x", ".claude/verify.json": always });
  try {
    assert.equal(verify({ session_id: randomUUID() }, { ...process.env, CLAUDE_PROJECT_DIR: none }).exitCode, 0);
  } finally {
    cleanup(none);
  }
});

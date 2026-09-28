import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const HOOKS = join(ROOT, ".claude", "hooks");

/** Create a temp project from a { "relative/path": "content" } map. */
export function makeProject(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cctk-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Run a hook script with a JSON payload on stdin. */
export function runHook(script, payload, env = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    json = null;
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

export function git(dir, ...args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

// Secret-shaped strings are assembled at runtime so the repo itself never contains them.
export const FAKE = {
  awsKey: ["AKIA", "Z7QXW3RT5YU8PL2K"].join(""),
  genericSecret: ["9f2c", "4e7a1b8d", "63f0c5a2", "e91d7b44"].join(""),
};

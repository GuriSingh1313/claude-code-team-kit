#!/usr/bin/env node
// Dependency-free lint: syntax-checks every script and validates every JSON and
// frontmatter file the kit ships, so a broken hook never reaches a team.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walkFiles } from "../.claude/tools/project-info.mjs";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const problems = [];

for (const rel of walkFiles(ROOT, { ignore: ["examples"] })) {
  const abs = join(ROOT, rel);
  if (/\.(mjs|js)$/.test(rel)) {
    const r = spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" });
    if (r.status !== 0) problems.push(`${rel}: ${r.stderr.trim().split("\n")[0]}`);
  } else if (/\.json$/.test(rel) && !rel.endsWith("package-lock.json")) {
    try {
      JSON.parse(readFileSync(abs, "utf8"));
    } catch (e) {
      problems.push(`${rel}: invalid JSON (${e.message})`);
    }
  } else if (/^\.claude\/(agents\/.+|skills\/.+\/SKILL)\.md$/.test(rel)) {
    const text = readFileSync(abs, "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) problems.push(`${rel}: missing YAML frontmatter`);
    else {
      if (!/^name:\s*\S/m.test(fm[1])) problems.push(`${rel}: frontmatter needs a name`);
      if (!/^description:\s*\S/m.test(fm[1])) problems.push(`${rel}: frontmatter needs a description`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("lint: ok");

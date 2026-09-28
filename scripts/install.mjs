#!/usr/bin/env node
// Install the kit into another repository.
//
//   node scripts/install.mjs <target-repo> [--dry-run] [--force] [--no-claude-md] [--no-mcp]
//
// Copies hooks, tools, the MCP server, subagents and skills into <target>/.claude,
// merges (never overwrites) .claude/settings.json and .mcp.json, writes a starter
// CLAUDE.md when none exists, and prints the readiness score before and after.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../.claude/tools/claude-ready.mjs";
import { detectProject } from "../.claude/tools/project-info.mjs";
import { isMain } from "../.claude/hooks/lib.mjs";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY_DIRS = [".claude/hooks", ".claude/tools", ".claude/mcp", ".claude/agents", ".claude/skills"];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function* filesUnder(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) yield* filesUnder(abs);
    else yield abs;
  }
}

/** Merge kit settings into existing settings without dropping or duplicating anything. */
export function mergeSettings(existing, kit) {
  const out = JSON.parse(JSON.stringify(existing || {}));
  if (!out.$schema && kit.$schema) out.$schema = kit.$schema;
  out.permissions ||= {};
  for (const key of ["allow", "ask", "deny"]) {
    const rules = [...(out.permissions[key] || [])];
    for (const rule of kit.permissions?.[key] || []) if (!rules.includes(rule)) rules.push(rule);
    if (rules.length) out.permissions[key] = rules;
  }
  out.hooks ||= {};
  for (const [event, groups] of Object.entries(kit.hooks || {})) {
    const current = (out.hooks[event] ||= []);
    const known = new Set(current.flatMap((g) => (g.hooks || []).map((h) => h.command)));
    for (const group of groups) {
      if ((group.hooks || []).every((h) => known.has(h.command))) continue;
      current.push(group);
    }
  }
  return out;
}

export function renderClaudeMd(targetDir) {
  const template = readFileSync(join(KIT, "templates", "CLAUDE.md.template"), "utf8");
  const { name, stacks, commands } = detectProject(targetDir);
  const label = { test: "Test", lint: "Lint", format: "Format", typecheck: "Type-check", build: "Build", dev: "Run locally" };
  const cmdLines = Object.entries(label).map(([k, l]) => (commands[k] ? `- ${l}: \`${commands[k]}\`` : k === "test" ? `- ${l}: TODO (no test command detected)` : null)).filter(Boolean);
  return template
    .replaceAll("{{PROJECT_NAME}}", name || "Project")
    .replaceAll("{{COMMANDS}}", cmdLines.join("\n"))
    .replaceAll("{{STACK}}", stacks.length ? stacks.join(", ") : "TODO")
    .replaceAll("{{TEST_COMMAND}}", commands.test ? `\`${commands.test}\`` : "TODO: add a test command");
}

export function installKit(target, { dryRun = false, force = false, claudeMd = true, mcp = true } = {}) {
  const dest = resolve(target);
  if (!existsSync(dest) || !statSync(dest).isDirectory()) throw new Error(`Target is not a directory: ${dest}`);
  if (dest === KIT) throw new Error("Refusing to install the kit into itself.");

  const before = audit(dest).score;
  const log = { copied: [], skipped: [], merged: [], created: [], before, after: null };
  const write = (file, content) => {
    if (dryRun) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  for (const d of COPY_DIRS) {
    if (!mcp && d === ".claude/mcp") continue;
    for (const src of filesUnder(join(KIT, d))) {
      const rel = relative(KIT, src).replace(/\\/g, "/");
      const out = join(dest, rel);
      if (existsSync(out) && !force) {
        log.skipped.push(rel);
        continue;
      }
      if (!dryRun) {
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(src, out);
      }
      log.copied.push(rel);
    }
  }

  const kitSettings = readJson(join(KIT, ".claude", "settings.json"));
  const settingsPath = join(dest, ".claude", "settings.json");
  const existingSettings = readJson(settingsPath);
  write(settingsPath, `${JSON.stringify(mergeSettings(existingSettings, kitSettings), null, 2)}\n`);
  (existingSettings ? log.merged : log.created).push(".claude/settings.json");

  if (mcp) {
    const mcpPath = join(dest, ".mcp.json");
    const hadMcp = existsSync(mcpPath);
    const existingMcp = readJson(mcpPath) || {};
    const kitMcp = readJson(join(KIT, ".mcp.json"));
    existingMcp.mcpServers ||= {};
    if (!existingMcp.mcpServers["repo-tools"]) {
      existingMcp.mcpServers["repo-tools"] = kitMcp.mcpServers["repo-tools"];
      write(mcpPath, `${JSON.stringify(existingMcp, null, 2)}\n`);
      (hadMcp ? log.merged : log.created).push(".mcp.json");
    }
  }

  if (claudeMd && !existsSync(join(dest, "CLAUDE.md")) && !existsSync(join(dest, ".claude", "CLAUDE.md"))) {
    write(join(dest, "CLAUDE.md"), renderClaudeMd(dest));
    log.created.push("CLAUDE.md");
  }

  log.after = dryRun ? null : audit(dest).score;
  return log;
}

function parseArgs(argv) {
  const opts = { target: null, dryRun: false, force: false, claudeMd: true, mcp: true };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--no-claude-md") opts.claudeMd = false;
    else if (a === "--no-mcp") opts.mcp = false;
    else if (!a.startsWith("-")) opts.target = a;
  }
  return opts;
}

if (isMain(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    console.log("Usage: node scripts/install.mjs <target-repo> [--dry-run] [--force] [--no-claude-md] [--no-mcp]");
    process.exit(1);
  }
  try {
    const log = installKit(opts.target, opts);
    console.log(`${opts.dryRun ? "[dry run] " : ""}Installed claude-code-team-kit into ${resolve(opts.target)}`);
    console.log(`  copied:  ${log.copied.length} files`);
    if (log.skipped.length) console.log(`  kept existing (use --force to overwrite): ${log.skipped.join(", ")}`);
    if (log.merged.length) console.log(`  merged:  ${log.merged.join(", ")}`);
    if (log.created.length) console.log(`  created: ${log.created.join(", ")}`);
    if (log.after) console.log(`\nReadiness score: ${log.before.value} (${log.before.grade}) → ${log.after.value} (${log.after.grade})`);
    console.log("\nNext steps:");
    console.log("  1. Fill in the TODOs in CLAUDE.md (or run /onboard to draft the architecture section).");
    console.log("  2. Run: node .claude/tools/claude-ready.mjs .   to see the remaining fixes.");
    console.log("  3. Commit .claude/, .mcp.json and CLAUDE.md so the whole team gets the same setup.");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

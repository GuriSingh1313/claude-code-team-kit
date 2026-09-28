#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell.
// Denies catastrophic commands outright and asks before risky ones.
// Everything else falls through to Claude Code's normal permission flow.
//
// Extra team rules can live in .claude/guard-rules.json:
//   { "deny": [{ "pattern": "regex", "reason": "why" }], "ask": [{ "pattern": "...", "reason": "..." }] }
import { readHookInput, emitPreToolDecision, projectDir, readKitConfig, isMain } from "./lib.mjs";
import { secretFileVerdict } from "./protect-secrets.mjs";

const DANGEROUS_RM_TARGETS = new Set([
  "/", "/*", "~", "~/", "~/*", "$HOME", "${HOME}", "$HOME/", "${HOME}/", "$HOME/*", "${HOME}/*",
  ".", "./", "./*", "..", "../", "../*", "*", ".*",
]);

// Directories that are routinely regenerated; deleting them needs no confirmation.
const DISPOSABLE_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage",
  "target", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "tmp", ".tmp", ".parcel-cache",
]);

const PROTECTED_BRANCHES = /^(\+)?(refs\/heads\/)?(main|master|prod|production|release(\/.*)?|trunk|develop)$/;

const WRAPPERS = new Set(["command", "builtin", "nohup", "nice", "time", "exec", "stdbuf", "noglob"]);

/** Split a shell command into simple segments on ; && || | and newlines. */
export function splitSegments(command) {
  return command
    .split(/&&|\|\||;|\||\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(segment) {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((t) => t.replace(/^(["'])(.*)\1$/, "$2"));
}

/** Strip env assignments, sudo and harmless wrappers so we can see the real program. */
function parseSegment(segment) {
  const tokens = tokenize(segment);
  let i = 0;
  let sudo = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
    if (t === "sudo" || t === "doas") {
      sudo = true;
      i++;
      while (i < tokens.length && tokens[i].startsWith("-")) i++;
      continue;
    }
    if (WRAPPERS.has(t)) { i++; continue; }
    if (t === "timeout") { i++; while (i < tokens.length && /^(-|\d)/.test(tokens[i])) i++; continue; }
    if (t === "env" && i + 1 < tokens.length) { i++; continue; }
    break;
  }
  const argv = tokens.slice(i);
  const name = (argv[0] || "").split(/[\\/]/).pop().toLowerCase();
  return { raw: segment, argv, name, sudo };
}

function normalizeTarget(t) {
  if (t.length > 1 && /[\\/]$/.test(t) && !/^[a-z]:[\\/]$/i.test(t)) return t.replace(/[\\/]+$/, "") || "/";
  return t;
}

function isDangerousDeleteTarget(target) {
  const t = normalizeTarget(target);
  if (DANGEROUS_RM_TARGETS.has(t) || DANGEROUS_RM_TARGETS.has(target)) return true;
  if (/^[a-z]:[\\/]?\*?$/i.test(t)) return true; // C:\  C:/  C:
  if (/^\/[a-z]\/?\*?$/i.test(t)) return true; // Git Bash drive roots like /c
  if (/^\/(bin|boot|dev|etc|lib|lib64|opt|proc|root|sbin|srv|sys|usr|var|home|users|system|applications|library)\/?\*?$/i.test(t)) return true;
  return false;
}

function rmInfo(argv) {
  let recursive = false;
  let force = false;
  let noPreserveRoot = false;
  let endOfOptions = false;
  const targets = [];
  for (const a of argv.slice(1)) {
    if (!endOfOptions && a === "--") { endOfOptions = true; continue; }
    if (!endOfOptions && a.startsWith("--")) {
      if (a === "--recursive") recursive = true;
      if (a === "--force") force = true;
      if (a === "--no-preserve-root") noPreserveRoot = true;
      continue;
    }
    if (!endOfOptions && /^-[a-zA-Z]+$/.test(a)) {
      if (/[rR]/.test(a)) recursive = true;
      if (/f/.test(a)) force = true;
      continue;
    }
    targets.push(a);
  }
  return { recursive, force, noPreserveRoot, targets };
}

function psRemoveInfo(argv) {
  const lower = argv.map((a) => a.toLowerCase());
  const recursive = lower.some((a) => a === "-recurse" || a === "-r");
  const force = lower.includes("-force");
  const targets = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      if (/^-(path|literalpath)$/i.test(a) && argv[i + 1]) { targets.push(argv[i + 1]); i++; }
      continue;
    }
    targets.push(a);
  }
  return { recursive, force, targets };
}

const SECRET_READERS = new Set([
  "cat", "less", "more", "head", "tail", "bat", "nl", "strings", "xxd", "od", "base64", "tac",
  "type", "get-content", "gc", "sed", "awk", "grep", "rg", "scp",
]);

const PUBLISH = [
  [/^(npm|pnpm|yarn|bun)$/, (a) => a[1] === "publish", "Publishes a package to a public registry"],
  [/^twine$/, (a) => a[1] === "upload", "Uploads a package to PyPI"],
  [/^cargo$/, (a) => a[1] === "publish", "Publishes a crate to crates.io"],
  [/^gh$/, (a) => a[1] === "release" && a[2] === "create", "Creates a public GitHub release"],
  [/^vercel$/, (a) => a.includes("--prod"), "Deploys to production"],
];

/**
 * Evaluate a command. Returns { decision: "deny" | "ask", reason, rule } or null.
 * Deny wins over ask when several rules match.
 */
export function evaluateCommand(command, extraRules = {}) {
  if (!command || typeof command !== "string") return null;
  const hits = [];
  const hit = (decision, rule, reason) => hits.push({ decision, rule, reason });
  const full = command;

  // Whole-command patterns (these need to see pipes).
  if (/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/i.test(full) ||
      /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(python3?|node|perl|ruby|pwsh|powershell|iex|invoke-expression)\b/i.test(full) ||
      /\b(ba|z)?sh\s+<\(\s*(curl|wget)\b/i.test(full) ||
      /\b(iex|invoke-expression)\b.*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b/i.test(full)) {
    hit("deny", "pipe-to-shell", "Downloads a script and executes it immediately. Download it first, review it, then run it.");
  }
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(full)) {
    hit("deny", "fork-bomb", "Fork bomb.");
  }
  if (/\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i.test(full) ||
      /\b(prisma\s+migrate\s+reset|rails\s+db:(drop|reset)|rake\s+db:(drop|reset)|dropdb)\b/i.test(full)) {
    hit("ask", "db-destructive", "Destroys database data. Confirm this is not a shared or production database.");
  }
  if (/\$\{?[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\}?/.test(full) && /\b(echo|printf|print|write-output|write-host)\b/i.test(full)) {
    hit("ask", "secret-echo", "Prints a secret from the environment into the conversation.");
  }

  for (const segment of splitSegments(full)) {
    const seg = parseSegment(segment);
    const { argv, name } = seg;
    if (!name) continue;

    if (seg.sudo) hit("ask", "sudo", "Runs with root privileges.");

    if (name === "rm" || name === "rmdir" || name === "unlink") {
      const info = rmInfo(argv);
      if (info.noPreserveRoot) hit("deny", "rm-no-preserve-root", "rm --no-preserve-root can wipe the whole filesystem.");
      const dangerous = info.targets.filter(isDangerousDeleteTarget);
      if (info.recursive && dangerous.length) {
        hit("deny", "rm-catastrophic", `Recursive delete of ${dangerous.join(", ")} would wipe the project, home directory or system.`);
      } else if (info.recursive && info.force) {
        const risky = info.targets.filter((t) => !DISPOSABLE_DIRS.has(normalizeTarget(t).split(/[\\/]/).pop()));
        if (risky.length) hit("ask", "rm-recursive", `Recursive force delete of ${risky.join(", ")}.`);
      }
    }

    if (name === "remove-item" || name === "ri" || name === "del" || name === "erase" || name === "rd") {
      const info = psRemoveInfo(argv);
      const dangerous = info.targets.filter(isDangerousDeleteTarget);
      if (info.recursive && dangerous.length) {
        hit("deny", "rm-catastrophic", `Recursive delete of ${dangerous.join(", ")} would wipe the project, home directory or system.`);
      } else if (info.recursive && info.force) {
        const risky = info.targets.filter((t) => !DISPOSABLE_DIRS.has(normalizeTarget(t).split(/[\\/]/).pop()));
        if (risky.length) hit("ask", "rm-recursive", `Recursive force delete of ${risky.join(", ")}.`);
      }
    }

    if (/^mkfs(\.|$)/.test(name) || name === "format-volume" || name === "clear-disk" || name === "diskpart" ||
        (name === "dd" && argv.some((a) => /^of=\/dev\//.test(a))) || (name === "format" && argv.some((a) => /^[a-z]:$/i.test(a)))) {
      hit("deny", "disk-wipe", "Formats or overwrites a disk.");
    }

    if (name === "chmod" && argv.some((a) => /^-[a-zA-Z]*R/.test(a)) && argv.some((a) => /^0?777$/.test(a))) {
      const rootish = argv.slice(1).filter((a) => !a.startsWith("-") && !/^0?777$/.test(a)).some(isDangerousDeleteTarget);
      hit(rootish ? "deny" : "ask", "chmod-777", "Makes files world-writable recursively.");
    }

    if (name === "git") {
      const sub = argv[1];
      const rest = argv.slice(2);
      if (sub === "push") {
        const force = rest.some((a) => a === "--force" || a === "-f" || /^-[a-zA-Z]*f/.test(a) || a.startsWith("--force-with-lease") || a.startsWith("+"));
        const refs = rest.filter((a) => !a.startsWith("-"));
        const branchRefs = refs.slice(1).map((r) => r.split(":").pop());
        const toProtected = branchRefs.some((r) => PROTECTED_BRANCHES.test(r)) || refs.some((r) => /^\+(main|master)$/.test(r));
        if (force && toProtected) hit("deny", "force-push-protected", "Force-push to a protected branch rewrites shared history.");
        else if (force) hit("ask", "force-push", "Force-push rewrites remote history.");
        if (rest.includes("--delete") || rest.includes("-d") || refs.slice(1).some((r) => r.startsWith(":"))) {
          hit("ask", "git-delete-remote", "Deletes a remote branch or tag.");
        }
      }
      if (sub === "reset" && rest.includes("--hard")) hit("ask", "git-reset-hard", "Discards uncommitted work.");
      if (sub === "clean" && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")) hit("ask", "git-clean", "Deletes untracked files permanently.");
      if (sub === "checkout" && rest.includes("--") && rest.includes(".")) hit("ask", "git-discard", "Discards local changes.");
      if (sub === "restore" && rest.includes(".") && !rest.includes("--staged")) hit("ask", "git-discard", "Discards local changes.");
      if (sub === "branch" && rest.some((a) => a === "-D")) hit("ask", "git-branch-delete", "Force-deletes a branch.");
      if (sub === "stash" && (rest[0] === "clear" || rest[0] === "drop")) hit("ask", "git-stash-drop", "Deletes stashed work.");
      if (sub === "filter-branch" || sub === "filter-repo") hit("ask", "git-rewrite", "Rewrites repository history.");
    }

    if ((name === "terraform" || name === "tofu") && (argv[1] === "destroy" || (argv[1] === "apply" && argv.some((a) => /auto-approve/.test(a))))) {
      hit("ask", "infra-destructive", "Changes or destroys real infrastructure.");
    }
    if ((name === "kubectl" && argv[1] === "delete") || (name === "helm" && (argv[1] === "uninstall" || argv[1] === "delete"))) {
      hit("ask", "infra-destructive", "Deletes cluster resources.");
    }
    if (name === "aws" && argv[1] === "s3" && (argv[2] === "rb" || (argv[2] === "rm" && argv.includes("--recursive")))) {
      hit("ask", "infra-destructive", "Deletes S3 data.");
    }
    if (name === "docker" && ((argv[1] === "system" && argv[2] === "prune") || (argv[1] === "volume" && (argv[2] === "rm" || argv[2] === "prune")))) {
      hit("ask", "docker-prune", "Deletes Docker volumes or cached data.");
    }

    for (const [nameRe, test, reason] of PUBLISH) {
      if (nameRe.test(name) && test(argv)) hit("ask", "publish", reason);
    }

    if (SECRET_READERS.has(name)) {
      for (const a of argv.slice(1)) {
        if (a.startsWith("-")) continue;
        const verdict = secretFileVerdict(a);
        if (verdict && verdict.decision === "deny") {
          hit("deny", "secret-read", `Reads ${a} (${verdict.reason}) into the conversation. Reference variable names instead of values.`);
          break;
        }
      }
    }
    if ((name === "printenv" && argv.length === 1) || (name === "env" && argv.length === 1) || (name === "set" && argv.length === 1) ||
        (name === "get-childitem" && /^env:/i.test(argv[1] || "")) || (name === "gci" && /^env:/i.test(argv[1] || ""))) {
      hit("ask", "env-dump", "Dumps every environment variable, including secrets, into the conversation.");
    }
  }

  for (const decision of ["deny", "ask"]) {
    for (const r of extraRules[decision] || []) {
      try {
        if (new RegExp(r.pattern, r.flags || "").test(full)) hit(decision, "team-rule", r.reason || `Matches team rule ${r.pattern}`);
      } catch {
        // Ignore invalid team regexes rather than breaking every Bash call.
      }
    }
  }

  const deny = hits.find((h) => h.decision === "deny");
  if (deny) return deny;
  const ask = hits.find((h) => h.decision === "ask");
  return ask || null;
}

if (isMain(import.meta.url)) {
  const input = readHookInput();
  const command = input.tool_input?.command;
  const extra = readKitConfig(projectDir(input), "guard-rules.json");
  const verdict = evaluateCommand(command, extra);
  if (verdict) {
    emitPreToolDecision(verdict.decision, `[guard-bash:${verdict.rule}] ${verdict.reason}`);
  }
  process.exit(0);
}

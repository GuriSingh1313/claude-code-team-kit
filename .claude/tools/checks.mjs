// The Claude Code readiness checks. Each check returns
// { id, area, title, points, max, status: "pass" | "warn" | "fail" | "na", detail, fix }.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectProject, walkFiles, isTestFile, loadIgnore } from "./project-info.mjs";
import { secretFileVerdict } from "../hooks/protect-secrets.mjs";

export const AREAS = {
  context: "AI context",
  safety: "Safety",
  verify: "Verification loop",
  hygiene: "Codebase hygiene",
};

const SOURCE_EXT = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|kt|kts|rb|php|cs|swift|vue|svelte|scala|dart|ex|exs|c|cc|cpp|h|hpp)$/i;
const SCAN_EXT = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|kt|kts|rb|php|cs|swift|vue|svelte|scala|dart|ex|exs|json|ya?ml|toml|ini|cfg|conf|properties|tf|sh|ps1|xml|gradle|env|txt)$/i;
const SKIP_SCAN = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|uv\.lock)$|\.min\.[jc]ss?$|\.map$/i;

const SECRET_PATTERNS = [
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Stripe live key", /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI API key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  [
    "Hardcoded credential",
    /(api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|db[_-]?pass(word)?|password|passwd)["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i,
  ],
];

const PLACEHOLDER = /(x{4,}|your[_-]?|example|changeme|placeholder|<[^>]+>|\$\{|process\.env|os\.environ|getenv|dummy|redacted|\*{4,})/i;

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Convert one .gitignore pattern to a RegExp tested against a relative POSIX path. */
export function gitignorePatternToRegExp(pattern) {
  let p = pattern.trim();
  const anchored = p.startsWith("/") || (p.includes("/") && !p.endsWith("/")) || p.slice(0, -1).includes("/");
  p = p.replace(/^\//, "").replace(/\/$/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(anchored ? `^${re}(/.*)?$` : `(^|/)${re}(/.*)?$`);
}

/** Minimal .gitignore evaluation (root .gitignore only), including ! negations. */
export function isIgnored(rules, relPath) {
  let ignored = false;
  for (const { negate, re } of rules) {
    if (re.test(relPath)) ignored = !negate;
  }
  return ignored;
}

export function loadGitignore(dir) {
  return readText(join(dir, ".gitignore"))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => ({ negate: l.startsWith("!"), re: gitignorePatternToRegExp(l.replace(/^!/, "")) }));
}

function gitTrackedFiles(dir) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}

function mask(value) {
  return value.length <= 6 ? "***" : `${value.slice(0, 4)}…(${value.length} chars)`;
}

/** Scan text for likely secrets. Returns [{ kind, line, preview }]. */
export function findSecretsInText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.length > 2000) return;
    for (const [kind, re] of SECRET_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      const value = kind === "Hardcoded credential" ? m[m.length - 1] : m[0];
      if (kind === "Hardcoded credential" && PLACEHOLDER.test(value)) continue;
      findings.push({ kind, line: idx + 1, preview: mask(value) });
      break;
    }
  });
  return findings;
}

/** Gather everything the checks need in one pass over the tree. */
export function collectFacts(dir) {
  const ignore = loadIgnore(dir);
  const files = [...walkFiles(dir, { ignore })];
  const tracked = gitTrackedFiles(dir);
  return {
    dir,
    files,
    tracked: tracked ? tracked.filter((f) => !ignore.some((p) => f === p || f.startsWith(`${p}/`))) : null,
    project: detectProject(dir),
    gitignore: loadGitignore(dir),
    settings: readJson(join(dir, ".claude", "settings.json")),
  };
}

function check(id, area, title, max, points, detail, fix) {
  const status = points >= max ? "pass" : points > 0 ? "warn" : "fail";
  return { id, area, title, max, points, status, detail, fix: status === "pass" ? "" : fix };
}

function na(id, area, title, detail) {
  return { id, area, title, max: 0, points: 0, status: "na", detail, fix: "" };
}

export function runChecks(dir) {
  const f = collectFacts(dir);
  const results = [];
  const claudeMdPath = ["CLAUDE.md", ".claude/CLAUDE.md"].map((p) => join(dir, p)).find(existsSync);
  const claudeMd = claudeMdPath ? readText(claudeMdPath) : "";

  // --- AI context (30) ---
  if (claudeMdPath) results.push(check("claude-md", "context", "CLAUDE.md present", 10, 10, "Found CLAUDE.md.", ""));
  else if (existsSync(join(dir, "AGENTS.md")))
    results.push(check("claude-md", "context", "CLAUDE.md present", 10, 5, "Only AGENTS.md found.", "Add a CLAUDE.md that imports it with a line `@AGENTS.md`, plus Claude-specific notes."));
  else results.push(check("claude-md", "context", "CLAUDE.md present", 10, 0, "No CLAUDE.md: every session starts with zero project knowledge.", "Create a concise CLAUDE.md: what the project is, how to run/test it, conventions, and don'ts."));

  if (claudeMd) {
    const lines = claudeMd.split(/\r?\n/).length;
    const testCmd = f.project.commands.test;
    let pts = 4;
    const notes = [`${lines} lines.`];
    if ((testCmd && claudeMd.includes(testCmd)) || /\b(npm|pnpm|yarn|bun) (run )?test\b|pytest|go test|cargo test|mvn|gradle|dotnet test|make test/.test(claudeMd)) {
      pts += 3;
      notes.push("Documents how to run tests.");
    } else notes.push("Does not say how to run tests.");
    if (lines >= 10 && lines <= 300) pts += 3;
    else notes.push(lines < 10 ? "Too thin to be useful." : "Very long: it is loaded into every session and burns context.");
    results.push(check("claude-md-quality", "context", "CLAUDE.md is actionable", 10, pts, notes.join(" "), "Keep it under ~300 lines and include the exact build/test/lint commands."));
  } else {
    results.push(check("claude-md-quality", "context", "CLAUDE.md is actionable", 10, 0, "No CLAUDE.md to evaluate.", "Create CLAUDE.md with the exact build/test/lint commands."));
  }

  if (f.settings && f.settings.permissions && Object.keys(f.settings.permissions).length)
    results.push(check("claude-settings", "context", "Shared .claude/settings.json with permissions", 5, 5, "Team permissions are versioned.", ""));
  else if (f.settings)
    results.push(check("claude-settings", "context", "Shared .claude/settings.json with permissions", 5, 3, "settings.json exists but has no permission rules.", "Add allow/ask/deny rules so every developer gets the same guardrails."));
  else
    results.push(check("claude-settings", "context", "Shared .claude/settings.json with permissions", 5, 0, "No shared Claude Code settings.", "Commit .claude/settings.json with permission rules (e.g. deny Read(.env))."));

  const agents = listDir(join(dir, ".claude", "agents")).filter((x) => x.endsWith(".md"));
  const skills = listDir(join(dir, ".claude", "skills")).filter((x) => existsSync(join(dir, ".claude", "skills", x, "SKILL.md")));
  const commands = listDir(join(dir, ".claude", "commands")).filter((x) => x.endsWith(".md"));
  const kinds = (agents.length ? 1 : 0) + (skills.length + commands.length ? 1 : 0);
  results.push(
    check(
      "agents-skills", "context", "Project subagents and skills", 5, kinds === 2 ? 5 : kinds === 1 ? 3 : 0,
      `${agents.length} subagent(s), ${skills.length} skill(s), ${commands.length} command(s).`,
      "Add reusable subagents (reviewer, test writer) and skills (/ship, /onboard) so the team shares workflows.",
    ),
  );

  // --- Safety (30) ---
  const secretFiles = (f.tracked || f.files).filter((p) => secretFileVerdict(p)?.decision === "deny");
  if (f.tracked) {
    results.push(
      check(
        "secrets-tracked", "safety", "No secret files committed", 10, secretFiles.length ? 0 : 10,
        secretFiles.length ? `Tracked by git: ${secretFiles.slice(0, 5).join(", ")}` : "No .env / key / credential files tracked by git.",
        "Remove them from git (`git rm --cached <file>`), rotate the exposed secrets, and add them to .gitignore.",
      ),
    );
  } else {
    const exposed = secretFiles.filter((p) => !isIgnored(f.gitignore, p));
    results.push(
      check(
        "secrets-tracked", "safety", "No secret files committed", 10, exposed.length ? 0 : 10,
        exposed.length ? `Not a git repo; these would be committed: ${exposed.slice(0, 5).join(", ")}` : "No unignored secret files found.",
        "Add secret files to .gitignore before the first commit and keep a .env.example instead.",
      ),
    );
  }

  const envIgnored = isIgnored(f.gitignore, ".env") && isIgnored(f.gitignore, ".env.local");
  results.push(
    check(
      "gitignore-env", "safety", ".gitignore covers .env files", 5, envIgnored ? 5 : 0,
      existsSync(join(dir, ".gitignore")) ? (envIgnored ? ".env and .env.local are ignored." : ".gitignore does not ignore .env files.") : "No .gitignore.",
      "Add `.env` and `.env.*` (with `!.env.example`) to .gitignore.",
    ),
  );

  const findings = [];
  for (const p of f.tracked || f.files) {
    if (!SCAN_EXT.test(p) || SKIP_SCAN.test(p) || secretFileVerdict(p)) continue;
    const abs = join(dir, p);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > 512 * 1024) continue;
    for (const hit of findSecretsInText(readText(abs))) findings.push({ file: p, ...hit });
    if (findings.length > 50) break;
  }
  results.push(
    check(
      "hardcoded-secrets", "safety", "No hardcoded secrets in source", 10, findings.length === 0 ? 10 : findings.length <= 2 ? 3 : 0,
      findings.length ? findings.slice(0, 6).map((x) => `${x.file}:${x.line} ${x.kind} ${x.preview}`).join("; ") : "No secret patterns found.",
      "Move values to environment variables, rotate anything that was committed, and add a secret scanner to CI.",
    ),
  );
  const hooks = f.settings?.hooks || {};
  const hasPre = Array.isArray(hooks.PreToolUse) && hooks.PreToolUse.length > 0;
  results.push(
    check(
      "guard-hooks", "safety", "Guardrail hooks on tool calls", 5, hasPre ? 5 : 0,
      hasPre ? "PreToolUse hooks configured." : "Nothing stops an agent from running destructive commands or reading .env.",
      "Add PreToolUse hooks that block destructive shell commands and secret-file reads.",
    ),
  );

  // --- Verification loop (25) ---
  const testCmd = f.project.commands.test;
  results.push(
    check("test-command", "verify", "Test command is discoverable", 10, testCmd ? 10 : 0,
      testCmd ? `\`${testCmd}\`` : "No test command found: the agent cannot check its own work.",
      "Add a real `test` script (package.json, Makefile, or pytest config)."),
  );
  const testFiles = f.files.filter(isTestFile).length;
  results.push(
    check("tests-exist", "verify", "Tests exist", 5, testFiles >= 3 ? 5 : testFiles > 0 ? 3 : 0, `${testFiles} test file(s).`,
      "Add tests around the most-changed modules first; agents regress untested code silently."),
  );
  const lintSignals = [
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml",
    ".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", "prettier.config.mjs", "biome.json", "biome.jsonc", "ruff.toml", ".ruff.toml",
    ".golangci.yml", ".golangci.yaml", "rustfmt.toml", ".rubocop.yml", "phpcs.xml", ".editorconfig", "checkstyle.xml", ".swiftlint.yml",
  ].filter((x) => existsSync(join(dir, x)));
  const pkgJson = readJson(join(dir, "package.json"));
  const pyproject = readText(join(dir, "pyproject.toml"));
  if (pkgJson?.prettier || pkgJson?.eslintConfig) lintSignals.push("package.json config");
  if (/\[tool\.(ruff|black|flake8|pylint)/.test(pyproject)) lintSignals.push("pyproject.toml");
  if (f.project.stacks.some((s) => s === "go" || s === "rust")) lintSignals.push("built-in formatter");
  results.push(
    check("lint-format", "verify", "Linter or formatter configured", 5, lintSignals.length ? 5 : 0,
      lintSignals.length ? lintSignals.slice(0, 4).join(", ") : "No lint/format config.",
      "Add a linter/formatter config so style is enforced by tools, not by the prompt."),
  );
  const ci = [".github/workflows", ".gitlab-ci.yml", ".circleci/config.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml", "Jenkinsfile", ".buildkite"].filter((x) =>
    x === ".github/workflows" ? listDir(join(dir, x)).some((w) => /\.ya?ml$/.test(w)) : existsSync(join(dir, x)),
  );
  results.push(
    check("ci", "verify", "CI runs on every change", 5, ci.length ? 5 : 0, ci.length ? ci.join(", ") : "No CI config found.",
      "Add CI that runs lint + tests on every pull request, so agent-written PRs are checked automatically."),
  );

  // --- Codebase hygiene (15) ---
  const readme = listDir(dir).find((x) => /^readme(\.|$)/i.test(x));
  const readmeLines = readme ? readText(join(dir, readme)).split(/\r?\n/).length : 0;
  results.push(
    check("readme", "hygiene", "README explains the project", 5, readmeLines >= 10 ? 5 : readme ? 2 : 0,
      readme ? `${readme}, ${readmeLines} lines.` : "No README.", "Write a README with purpose, setup, and how to run it locally."),
  );

  const needsLock = f.project.stacks.some((s) => ["node", "typescript", "python", "rust", "ruby", "php"].includes(s));
  if (needsLock)
    results.push(check("lockfile", "hygiene", "Dependencies are locked", 3, f.project.lockfile ? 3 : 0,
      f.project.lockfile ? f.project.lockfile : "No lockfile: installs differ between machines and CI.", "Commit the package manager's lockfile."));
  else results.push(na("lockfile", "hygiene", "Dependencies are locked", "No package manager detected."));

  const big = [];
  for (const p of f.files) {
    if (!SOURCE_EXT.test(p)) continue;
    const text = readText(join(dir, p));
    const n = text ? text.split("\n").length : 0;
    if (n > 1000) big.push([p, n]);
  }
  big.sort((a, b) => b[1] - a[1]);
  results.push(
    check("large-files", "hygiene", "No oversized source files", 4, big.length === 0 ? 4 : big.length <= 2 ? 2 : 0,
      big.length ? big.slice(0, 5).map(([p, n]) => `${p} (${n} lines)`).join(", ") : "All source files under 1,000 lines.",
      "Split files over ~1,000 lines; agents read whole files and lose track in giant ones."),
  );

  const stacks = f.project.stacks;
  if (stacks.includes("typescript")) {
    const ts = readText(join(dir, "tsconfig.json"));
    const strict = /"strict"\s*:\s*true/.test(ts);
    results.push(check("type-safety", "hygiene", "Type checking is strict", 3, strict ? 3 : 1, strict ? "tsconfig strict mode on." : "tsconfig without strict mode.", "Enable `\"strict\": true` in tsconfig.json."));
  } else if (stacks.includes("node")) {
    const js = readText(join(dir, "jsconfig.json"));
    const checked = /"checkJs"\s*:\s*true/.test(js);
    results.push(check("type-safety", "hygiene", "Type checking is strict", 3, checked ? 3 : 0, checked ? "jsconfig checkJs on." : "Plain JavaScript without type checking.", "Add jsconfig.json with checkJs (or migrate to TypeScript) so the agent gets type errors as feedback."));
  } else if (stacks.includes("python")) {
    const typed = /\[tool\.(mypy|pyright)/.test(pyproject) || existsSync(join(dir, "mypy.ini")) || existsSync(join(dir, "pyrightconfig.json"));
    results.push(check("type-safety", "hygiene", "Type checking is strict", 3, typed ? 3 : 0, typed ? "mypy/pyright configured." : "No type checker configured.", "Configure mypy or pyright and run it in CI."));
  } else if (stacks.length) {
    results.push(na("type-safety", "hygiene", "Type checking is strict", `${stacks.join(", ")} is statically typed.`));
  } else {
    results.push(na("type-safety", "hygiene", "Type checking is strict", "No stack detected."));
  }

  return { facts: f, results };
}

export function score(results) {
  const scored = results.filter((r) => r.status !== "na");
  const max = scored.reduce((s, r) => s + r.max, 0);
  const got = scored.reduce((s, r) => s + r.points, 0);
  const value = max ? Math.round((got / max) * 100) : 0;
  const grade = value >= 90 ? "A" : value >= 75 ? "B" : value >= 60 ? "C" : value >= 40 ? "D" : "F";
  const byArea = {};
  for (const r of scored) {
    byArea[r.area] ||= { got: 0, max: 0 };
    byArea[r.area].got += r.points;
    byArea[r.area].max += r.max;
  }
  return { value, grade, byArea };
}

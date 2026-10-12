import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { audit, renderMarkdown } from "../.claude/tools/claude-ready.mjs";
import { findSecretsInText, gitignorePatternToRegExp, isIgnored, loadGitignore } from "../.claude/tools/checks.mjs";
import { detectProject } from "../.claude/tools/project-info.mjs";
import { makeProject, cleanup, git, FAKE, ROOT } from "./helpers.mjs";

const byId = (report, id) => report.results.find((r) => r.id === id);

function messyProject() {
  return makeProject({
    "package.json": JSON.stringify({ name: "messy", scripts: { test: 'echo "Error: no test specified" && exit 1', start: "node server.js" } }),
    "server.js": `const API_SECRET = "${FAKE.genericSecret}";\nconst aws = "${FAKE.awsKey}";\n`,
    ".env": "DATABASE_URL=postgres://u:p@localhost/db\n",
    "README.md": "# app\n",
  });
}

function goodProject() {
  const claudeMd = ["# Project", "", "Node service.", "", "## Commands", "- Test: `npm test`", "- Lint: `npm run lint`", "", "## Rules", "- Keep diffs small", "- Never read .env"].join("\n");
  return makeProject({
    "package.json": JSON.stringify({ name: "good", scripts: { test: "node --test", lint: "eslint ." } }),
    "package-lock.json": "{}",
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "CLAUDE.md": claudeMd,
    ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(.env)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } }),
    ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: x\n---\n",
    ".claude/skills/ship/SKILL.md": "---\nname: ship\ndescription: x\n---\n",
    ".gitignore": "node_modules/\n.env\n.env.*\n!.env.example\n",
    ".env.example": "DATABASE_URL=\n",
    "eslint.config.js": "export default [];\n",
    ".github/workflows/ci.yml": "on: push\n",
    "README.md": Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
    "src/index.ts": "export const x = process.env.API_KEY;\n",
    "tests/a.test.ts": "", "tests/b.test.ts": "", "tests/c.test.ts": "",
  });
}

test("a vibe-coded repo scores low and gets concrete fixes", () => {
  const dir = messyProject();
  try {
    const report = audit(dir);
    assert.ok(report.score.value < 25, `score ${report.score.value}`);
    assert.equal(report.score.grade, "F");
    assert.equal(byId(report, "claude-md").status, "fail");
    assert.equal(byId(report, "secrets-tracked").status, "fail");
    assert.equal(byId(report, "hardcoded-secrets").status, "warn");
    assert.match(byId(report, "hardcoded-secrets").detail, /server\.js:1/);
    assert.equal(byId(report, "test-command").status, "fail");
    const md = renderMarkdown(report, { date: "2026-01-01" });
    assert.match(md, /## Fix these first/);
    assert.ok(!md.includes(FAKE.genericSecret), "report must never contain the secret value");
    assert.ok(!md.includes(FAKE.awsKey), "report must never contain the secret value");
  } finally {
    cleanup(dir);
  }
});

test("a well-set-up repo scores an A", () => {
  const dir = goodProject();
  try {
    const report = audit(dir);
    const failing = report.results.filter((r) => r.status === "fail" || r.status === "warn").map((r) => r.id);
    assert.ok(report.score.value >= 90, `score ${report.score.value}, failing: ${failing}`);
    assert.equal(report.score.grade, "A");
  } finally {
    cleanup(dir);
  }
});

test("committed .env is caught through git even when .gitignore is added later", () => {
  const dir = makeProject({ ".env": "A=1\n", "index.js": "console.log(1)\n" });
  try {
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const r = git(dir, "ls-files");
    if (r.status !== 0) return; // git unavailable in this environment
    const report = audit(dir);
    assert.equal(byId(report, "secrets-tracked").status, "fail");
    assert.match(byId(report, "secrets-tracked").detail, /Tracked by git: \.env/);
  } finally {
    cleanup(dir);
  }
});

test("secret scanner ignores placeholders and env lookups", () => {
  assert.equal(findSecretsInText('const apiKey = process.env.API_KEY || "";').length, 0);
  assert.equal(findSecretsInText('password: "your-password-here"').length, 0);
  assert.equal(findSecretsInText(`const key = "${FAKE.awsKey}"`)[0].kind, "AWS access key");
  assert.equal(findSecretsInText(`client_secret = "${FAKE.genericSecret}"`)[0].kind, "Hardcoded credential");
});

test("finds secrets in .NET-style config files without false alarms", () => {
  const appsettings = JSON.stringify({ Jwt: { Key: FAKE.genericSecret, Issuer: "TaskManagementAPI" } }, null, 2);
  assert.deepEqual(findSecretsInText(appsettings).map((f) => f.kind), ["Config secret"]);
  // A "Your...Key" default is still the real signing key at runtime, so it is reported.
  const defaultKey = ["Your", "SuperSecretKey", "ThatIsLongEnough123"].join("");
  assert.equal(findSecretsInText(`{ "Jwt": { "Key": "${defaultKey}" } }`)[0].kind, "Default secret in config");
  // True template markers are not.
  assert.equal(findSecretsInText('{ "Jwt": { "Key": "<set-in-user-secrets>" } }').length, 0);
  assert.equal(findSecretsInText('{ "Jwt": { "Key": "${JWT_SIGNING_KEY}" } }').length, 0);
  const conn = `"DefaultConnection": "Server=db;User Id=sa;Password=${FAKE.genericSecret.slice(0, 12)};"`;
  assert.equal(findSecretsInText(conn)[0].kind, "Connection string password");
  assert.equal(findSecretsInText('"DefaultConnection": "Server=(localdb)\\\\mssql;Database=Tasks;Trusted_Connection=True;"').length, 0);
  assert.equal(findSecretsInText("// inline password value (Password=...)").length, 0);
});

test("detects .NET solutions kept in sub-folders", () => {
  const withProject = makeProject({ "src/Api/Api.csproj": "<Project />", "src/Api/Program.cs": "class P {}" });
  const sourceOnly = makeProject({ "TaskManagementAPI/src/Api/Program.cs": "class P {}" });
  try {
    const a = detectProject(withProject);
    assert.ok(a.stacks.includes("dotnet"));
    assert.equal(a.commands.test, "dotnet test");
    const b = detectProject(sourceOnly);
    assert.ok(b.stacks.includes("dotnet"));
    assert.equal(b.commands.test, null, "no project file means no runnable test command");
  } finally {
    [withProject, sourceOnly].forEach(cleanup);
  }
});

test("gitignore matcher handles globs, anchors and negation", () => {
  assert.ok(gitignorePatternToRegExp(".env").test("config/.env"));
  assert.ok(gitignorePatternToRegExp("/dist").test("dist/app.js"));
  assert.ok(!gitignorePatternToRegExp("/dist").test("pkg/dist/app.js"));
  assert.ok(gitignorePatternToRegExp("**/*.pem").test("a/b/c.pem"));
  const dir = makeProject({ ".gitignore": ".env*\n!.env.example\n" });
  try {
    const rules = loadGitignore(dir);
    assert.ok(isIgnored(rules, ".env.local"));
    assert.ok(!isIgnored(rules, ".env.example"));
  } finally {
    cleanup(dir);
  }
});

test("detects commands across stacks", () => {
  const py = makeProject({ "pyproject.toml": "[tool.ruff]\n[tool.pytest.ini_options]\n", "uv.lock": "" });
  const go = makeProject({ "go.mod": "module x\n" });
  const pnpm = makeProject({ "package.json": JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }), "pnpm-lock.yaml": "" });
  try {
    assert.equal(detectProject(py).commands.test, "uv run pytest");
    assert.equal(detectProject(py).commands.lint, "uv run ruff check .");
    assert.equal(detectProject(go).commands.test, "go test ./...");
    assert.equal(detectProject(pnpm).commands.test, "pnpm test");
    assert.equal(detectProject(pnpm).commands.lint, "pnpm run lint");
  } finally {
    [py, go, pnpm].forEach(cleanup);
  }
});

test("CLI --min-score works as a CI gate", () => {
  const dir = messyProject();
  try {
    const cli = join(ROOT, ".claude", "tools", "claude-ready.mjs");
    const r = spawnSync(process.execPath, [cli, dir, "--min-score", "80"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /below the required 80/);
    const json = spawnSync(process.execPath, [cli, dir, "--json"], { encoding: "utf8" });
    assert.equal(JSON.parse(json.stdout).score.grade, "F");
  } finally {
    cleanup(dir);
  }
});

test("this repository passes its own audit", () => {
  const report = audit(ROOT);
  const failing = report.results.filter((r) => r.status === "fail").map((r) => `${r.id}: ${r.detail}`);
  assert.ok(report.score.value >= 90, `kit scored ${report.score.value}; ${failing.join(" | ")}`);
});

// Detects a project's stack and its build/test/lint commands. Shared by the hooks,
// the readiness audit and the MCP server. Zero dependencies.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  "coverage", "vendor", "target", "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache",
  ".pytest_cache", ".ruff_cache", ".gradle", ".idea", "bin", "obj", ".terraform", ".parcel-cache",
]);

const DEFAULT_NPM_TEST = /no test specified/i;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Load ignore prefixes from .claudereadyignore (one relative path prefix per line). */
export function loadIgnore(dir) {
  const file = join(dir, ".claudereadyignore");
  if (!existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""));
}

/** Walk project files (relative POSIX paths), skipping dependency and build folders. */
export function* walkFiles(dir, { limit = 20000, ignore = loadIgnore(dir) } = {}) {
  let count = 0;
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (ignore.some((p) => childRel === p || childRel.startsWith(`${p}/`))) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        yield childRel;
        if (++count >= limit) return;
      }
    }
  }
}

export function isTestFile(rel) {
  return (
    /(^|\/)(tests?|__tests__|spec|specs)\//i.test(rel) && /\.[a-z0-9]+$/i.test(rel) && !/\.(md|txt|json|snap)$/i.test(rel)
  ) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel) || /(^|\/)test_[^/]+\.py$/.test(rel) || /_test\.(go|py)$/.test(rel) || /Tests?\.(java|kt|cs)$/.test(rel);
}

function nodeRunner(dir) {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  return "npm";
}

/**
 * Returns { stacks: string[], packageManager, commands: { test, lint, format, build, dev, typecheck }, lockfile }.
 * Commands are null when not detected.
 */
export function detectProject(dir) {
  const stacks = [];
  const commands = { test: null, lint: null, format: null, build: null, dev: null, typecheck: null };
  let packageManager = null;
  let lockfile = null;

  const pkg = readJson(join(dir, "package.json"));
  if (pkg) {
    stacks.push(existsSync(join(dir, "tsconfig.json")) ? "typescript" : "node");
    packageManager = nodeRunner(dir);
    const run = (s) => (packageManager === "npm" ? `npm run ${s}` : `${packageManager} run ${s}`);
    const scripts = pkg.scripts || {};
    if (scripts.test && !DEFAULT_NPM_TEST.test(scripts.test)) commands.test = packageManager === "yarn" ? "yarn test" : `${packageManager} test`;
    if (scripts.lint) commands.lint = run("lint");
    if (scripts.format) commands.format = run("format");
    if (scripts.build) commands.build = run("build");
    if (scripts.dev) commands.dev = run("dev");
    else if (scripts.start) commands.dev = run("start");
    if (scripts.typecheck) commands.typecheck = run("typecheck");
    else if (existsSync(join(dir, "tsconfig.json"))) commands.typecheck = "npx tsc --noEmit";
    for (const f of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "npm-shrinkwrap.json"]) {
      if (existsSync(join(dir, f))) lockfile = f;
    }
  }

  const pyproject = readText(join(dir, "pyproject.toml"));
  const requirements = readText(join(dir, "requirements.txt")) + readText(join(dir, "requirements-dev.txt"));
  if (pyproject || requirements || existsSync(join(dir, "setup.py"))) {
    stacks.push("python");
    const usesPytest = /pytest/.test(pyproject + requirements) || existsSync(join(dir, "pytest.ini")) || existsSync(join(dir, "tests"));
    const uv = existsSync(join(dir, "uv.lock"));
    const poetry = existsSync(join(dir, "poetry.lock"));
    const prefix = uv ? "uv run " : poetry ? "poetry run " : "";
    if (!commands.test && usesPytest) commands.test = `${prefix}pytest`;
    if (!commands.lint && (/\[tool\.ruff/.test(pyproject) || existsSync(join(dir, "ruff.toml")))) commands.lint = `${prefix}ruff check .`;
    if (!commands.format && /\[tool\.ruff/.test(pyproject)) commands.format = `${prefix}ruff format .`;
    else if (!commands.format && /\[tool\.black/.test(pyproject)) commands.format = `${prefix}black .`;
    if (!commands.typecheck && (/\[tool\.mypy/.test(pyproject) || existsSync(join(dir, "mypy.ini")))) commands.typecheck = `${prefix}mypy .`;
    else if (!commands.typecheck && (/\[tool\.pyright/.test(pyproject) || existsSync(join(dir, "pyrightconfig.json")))) commands.typecheck = `${prefix}pyright`;
    for (const f of ["uv.lock", "poetry.lock", "Pipfile.lock", "pdm.lock", "requirements.lock"]) {
      if (existsSync(join(dir, f))) lockfile = lockfile || f;
    }
    if (!lockfile && /==/.test(requirements)) lockfile = "requirements.txt (pinned)";
  }

  if (existsSync(join(dir, "go.mod"))) {
    stacks.push("go");
    commands.test ||= "go test ./...";
    commands.build ||= "go build ./...";
    commands.lint ||= "go vet ./...";
    if (existsSync(join(dir, "go.sum"))) lockfile ||= "go.sum";
  }

  if (existsSync(join(dir, "Cargo.toml"))) {
    stacks.push("rust");
    commands.test ||= "cargo test";
    commands.build ||= "cargo build";
    commands.lint ||= "cargo clippy";
    commands.format ||= "cargo fmt";
    if (existsSync(join(dir, "Cargo.lock"))) lockfile ||= "Cargo.lock";
  }

  if (existsSync(join(dir, "pom.xml"))) {
    stacks.push("java");
    commands.test ||= "mvn -q test";
    commands.build ||= "mvn -q package";
  } else if (existsSync(join(dir, "build.gradle")) || existsSync(join(dir, "build.gradle.kts"))) {
    stacks.push(existsSync(join(dir, "build.gradle.kts")) ? "kotlin" : "java");
    const gradle = existsSync(join(dir, "gradlew")) ? "./gradlew" : "gradle";
    commands.test ||= `${gradle} test`;
    commands.build ||= `${gradle} build`;
  }

  if (existsSync(join(dir, "Gemfile"))) {
    stacks.push("ruby");
    commands.test ||= existsSync(join(dir, "spec")) ? "bundle exec rspec" : "bundle exec rake test";
    if (existsSync(join(dir, "Gemfile.lock"))) lockfile ||= "Gemfile.lock";
  }

  const composer = readJson(join(dir, "composer.json"));
  if (composer) {
    stacks.push("php");
    if (composer.scripts?.test) commands.test ||= "composer test";
    else if (existsSync(join(dir, "phpunit.xml")) || existsSync(join(dir, "phpunit.xml.dist"))) commands.test ||= "vendor/bin/phpunit";
    if (existsSync(join(dir, "composer.lock"))) lockfile ||= "composer.lock";
  }

  let csproj = false;
  try {
    csproj = readdirSync(dir).some((f) => /\.(sln|csproj)$/.test(f));
  } catch {
    // unreadable dir
  }
  if (csproj) {
    stacks.push("dotnet");
    commands.test ||= "dotnet test";
    commands.build ||= "dotnet build";
  }

  const makefile = readText(join(dir, "Makefile"));
  if (makefile) {
    if (!commands.test && /^test:/m.test(makefile)) commands.test = "make test";
    if (!commands.lint && /^lint:/m.test(makefile)) commands.lint = "make lint";
    if (!commands.build && /^build:/m.test(makefile)) commands.build = "make build";
  }

  return { stacks, packageManager, commands, lockfile, name: pkg?.name || basename(dir) };
}

/** Count lines of a text file (returns 0 for unreadable files). */
export function lineCount(file) {
  try {
    const s = statSync(file);
    if (s.size > 2_000_000) return 0;
    return readFileSync(file, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

export function rel(dir, file) {
  return relative(dir, file).replace(/\\/g, "/");
}

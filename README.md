# Claude Code Team Kit

**Make Claude Code safe and consistent for a whole engineering team: one command, no new dependencies.**

[![ci](https://github.com/YOUR_GITHUB_USERNAME/claude-code-team-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_USERNAME/claude-code-team-kit/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-informational)
![Claude-Ready](https://img.shields.io/badge/Claude--Ready%20score-97%2F100-success)

When a team adopts Claude Code, the same three problems show up in the first month:

1. **The agent can do real damage.** It runs shell commands: `rm -rf`, force-pushes, `terraform destroy`, `cat .env` straight into a chat log.
2. **"Done" doesn't mean the tests pass.** The agent finishes confidently while the suite is red, and a human finds out in review.
3. **Everyone configures it differently.** No shared CLAUDE.md, permissions, reviewers or workflows, so results vary by who's typing.

This kit fixes all three with files you commit to the repo, so every developer gets the same setup.

## What you get

| Piece | What it does | File |
|---|---|---|
| **Command guard** | Denies catastrophic shell commands (wiping `/` or `~`, piping `curl` into `bash`, force-pushing `main`, disk formats) and **asks** before risky ones (`git reset --hard`, `DROP TABLE`, `terraform destroy`, `npm publish`). Covers Bash **and** PowerShell. | `.claude/hooks/guard-bash.mjs` |
| **Secret shield** | Blocks reads of `.env`, keys, cloud credentials and `tfstate`; asks before writing them. `.env.example` stays readable. | `.claude/hooks/protect-secrets.mjs` |
| **Tests-must-pass Stop hook** | When Claude tries to finish after changing code, it runs your tests. If they fail, Claude gets the failure output and keeps working (max 3 retries, no infinite loops). | `.claude/hooks/verify-on-stop.mjs` |
| **Format on save** | Runs the formatter your project *already* uses (Prettier, Biome, Ruff, Black, gofmt, rustfmt) and never adds a new one. | `.claude/hooks/format-on-save.mjs` |
| **Session context** | Starts every session with the branch, uncommitted files, recent commits and the exact test/lint commands. | `.claude/hooks/session-context.mjs` |
| **Subagents** | `code-reviewer` (bugs and security, not style), `test-writer` (matches your framework and conventions), `security-auditor` (exploitable issues only). | `.claude/agents/` |
| **Skills** | `/ship` (lint, test, review, focused commit), `/onboard` (writes an onboarding guide from the code), `/audit-repo`. | `.claude/skills/` |
| **MCP server** | `repo-tools`: `project_commands`, `readiness_audit`, `find_todos`. Hand-written JSON-RPC over stdio: **zero dependencies**, tested against the official MCP SDK client. | `.claude/mcp/repo-tools-server.mjs` |
| **Readiness audit** | Scores any repo 0–100 on 16 checks across context, safety, verification and hygiene, with fixes in priority order. `--min-score` turns it into a CI gate. | `.claude/tools/claude-ready.mjs` |
| **Shared settings** | Permission allow/ask/deny rules plus the hook wiring, merged into your existing settings, never overwritten. | `.claude/settings.json` |

## Before / after

A typical AI-built prototype ([`examples/vibe-coded-app`](examples/vibe-coded-app)), audited at each stage:

| Stage | Readiness |
|---|---|
| Prototype as delivered: committed `.env`, hardcoded secrets, no tests, no CLAUDE.md | **9/100** (F) |
| After `node scripts/install.mjs` (one command) | **41/100** (D) |
| After the fixes a senior engineer makes ([`examples/fixes`](examples/fixes)) | **100/100** (A) |

Full reports: [`examples/reports/`](examples/reports/SUMMARY.md). Reproduce them with `npm run demo`.

## Quick start

Requires Node 18+ (the only requirement; your project can be in any language).

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/claude-code-team-kit
node claude-code-team-kit/scripts/install.mjs /path/to/your/repo
```

Real output, installing into the demo prototype:

```text
Installed claude-code-team-kit into /tmp/orders-api
  copied:  16 files
  created: .claude/settings.json, .mcp.json, CLAUDE.md

Readiness score: 9 (F) → 41 (D)
```

If the repo already has `.claude/settings.json` or `.mcp.json`, they are merged: your rules and hooks stay, and the kit's are appended.

Then fill in the TODOs in the generated `CLAUDE.md` (or run `/onboard`), and commit `.claude/`, `.mcp.json` and `CLAUDE.md`.
Use `--dry-run` to preview, `--no-mcp` or `--no-claude-md` to skip parts. Re-running is safe: nothing is duplicated.

## The guard, concretely

| Denied | Asks first | Left alone |
|---|---|---|
| `rm -rf /`, `rm -rf ~`, `rm -rf .`, `Remove-Item -Recurse -Force C:\` | `rm -rf src` | `rm -rf node_modules dist .next` |
| `curl … \| bash`, `iwr … \| iex` | `git reset --hard`, `git clean -fdx` | `git status`, `git diff`, `npm test` |
| `git push --force origin main` | `git push --force-with-lease origin feature/x` | `git push origin feature/x` |
| `cat .env`, `grep KEY .env.production` | `printenv`, `echo $STRIPE_SECRET_KEY` | `cat .env.example` |
| `mkfs`, `dd of=/dev/sda`, fork bombs | `DROP TABLE`, `prisma migrate reset`, `terraform destroy`, `kubectl delete`, `npm publish`, `sudo …` | everyday commands |

Add team rules in `.claude/guard-rules.json`:

```json
{ "deny": [{ "pattern": "kubectl .*--context\\s+prod", "reason": "Agents never touch the prod cluster" }] }
```

## Tests-must-pass, concretely

When Claude stops, the hook checks `git status` for changed code files. If there are none, it does nothing. Otherwise it runs the test
command (auto-detected for npm/pnpm/yarn/bun, pytest/uv/poetry, Go, Cargo, Maven/Gradle, Bundler, Composer, .NET and Make), and on failure
exits with code 2 and sends back the last 80 lines, so Claude fixes the cause instead of declaring victory. Configure it in `.claude/verify.json`:

```json
{ "command": "npm run test:unit", "timeoutSeconds": 240, "maxAttempts": 3, "onlyWhenChanged": true }
```

Disable it for one session with `CLAUDE_VERIFY_ON_STOP=0`.

## Readiness audit

```bash
node .claude/tools/claude-ready.mjs .                    # markdown report
node .claude/tools/claude-ready.mjs . --json             # machine-readable
node .claude/tools/claude-ready.mjs . --min-score 80     # exit 1 below 80 (CI gate)
```

Secret findings show only `file:line`, the kind of secret and a 4-character masked preview, never the value. Exclude fixture
folders with a `.claudereadyignore` file (one path per line).

## Quality

- 30 tests (`npm test`) covering every guard rule, the secret classifier, the audit checks, the installer's merge logic, the Stop hook's
  retry limit, and the MCP protocol, including an interop test with the official `@modelcontextprotocol/sdk` client.
- The CI workflow runs lint and tests on macOS, Linux and Windows × Node 22 and 24, then gates on this repo scoring at least 90
  on its own audit.
- Runtime code uses only Node built-ins. Nothing is added to your project's dependencies.

## Limitations

- The guard is a strong heuristic, not a sandbox. A determined workaround (for example, a script that deletes files) isn't a shell
  pattern it can see. Pair it with Claude Code's permission modes and sandboxing for hard guarantees.
- The audit measures setup, not code quality. A 100 means an agent has what it needs to work safely, not that the code is bug-free.

## Need this set up for your team?

I'm [Your Name], a senior engineer with 14 years of experience. I set up Claude Code for teams and harden AI-built apps for production:

- **Readiness audit**: the report above for your repo, plus a 30-minute walkthrough of what to fix first.
- **Team setup**: this kit tailored to your stack, CI, and rules, a CLAUDE.md written from your codebase, plus a training session.
- **AI-built app rescue**: security, tests and deployment for prototypes built with AI tools.

Contact: [Upwork profile link] · [LinkedIn link] · [email]

## License

MIT

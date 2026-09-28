# claude-code-team-kit

A drop-in Claude Code setup for teams: guardrail hooks, a tests-must-pass Stop hook, subagents,
skills, a zero-dependency MCP server and a readiness audit. Everything installable lives in `.claude/`.

## Commands
- Test: `npm test` (node:test, all files in `tests/`)
- Lint: `npm run lint` (syntax-checks scripts, validates JSON and agent/skill frontmatter)
- Self-audit: `npm run audit` (CI requires >= 90)
- Demo reports: `npm run demo` (regenerates `examples/reports/`)
- Install into a repo: `node scripts/install.mjs <path>`

## Layout
| Path | What it is |
|---|---|
| `.claude/hooks/` | Hook scripts. Each exports its pure logic and only does I/O when run as the entry point (`isMain`). |
| `.claude/tools/` | Readiness audit (`claude-ready.mjs`, `checks.mjs`) and stack/command detection (`project-info.mjs`). |
| `.claude/mcp/` | `repo-tools` MCP server: hand-written JSON-RPC over stdio, no SDK at runtime. |
| `.claude/agents/`, `.claude/skills/` | Subagents and skills that get copied into client repos. |
| `scripts/` | Installer, demo, lint. |
| `examples/` | Deliberately insecure demo app plus the fixes; excluded from the audit via `.claudereadyignore`. |

## Rules for changes
- Runtime code must stay dependency-free and run on Node 18+ on macOS, Linux and Windows:
  use `node:` built-ins, `path.join`, no shell-specific syntax, no `jq`.
- Hooks must never crash a tool call: bad input exits 0 with no output. Only `verify-on-stop` uses exit 2, deliberately.
- Every new guard rule or audit check needs a test in `tests/`. Secret-shaped test strings are built at runtime
  (see `FAKE` in `tests/helpers.mjs`) so this repo never contains one.
- The MCP SDK is a devDependency used only by `tests/mcp-sdk-interop.test.mjs`.
- Keep the audit's scoring stable: changing a check's points changes every client's score, so note it in the README.

## Don't
- Don't read or print `.env` files, including the demo one.
- Don't commit `node_modules/` or regenerate `package-lock.json` without a dependency change.

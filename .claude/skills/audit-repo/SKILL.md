---
name: audit-repo
description: Run the Claude Code readiness audit on this repository, explain the score, and fix the top issues with the user's approval. Use when asked how AI-ready or agent-safe the repo is.
argument-hint: "[optional path, defaults to the repo root]"
---

1. Run the audit on `$ARGUMENTS` (or `.` if empty):
   - Prefer the `readiness_audit` tool from the repo-tools MCP server.
   - Otherwise run `node .claude/tools/claude-ready.mjs <path>`.
2. Summarise in plain language: the score, the three biggest risks, and what each one means for a team using AI agents (for example, "an agent can read .env and paste keys into a chat log").
3. Propose fixes for the top three items as a numbered plan with the exact files you would add or change. Ask before changing anything.
4. After approval, apply the fixes one at a time, re-running the audit after each and reporting the new score.
5. Never print secret values you find. Report `path:line` and the kind of secret only, and recommend rotating anything that was ever committed.

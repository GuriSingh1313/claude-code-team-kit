---
name: ship
description: Verify, review and commit the current change - lint, tests, reviewer subagent, focused staging and a Conventional Commit. Use when the user says ship, wrap up, or commit this.
disable-model-invocation: true
argument-hint: "[optional hint for the commit message]"
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git add *) Bash(git commit *)
---

## Current state
- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Diff size: !`git diff HEAD --stat`

## Steps
1. If the branch is `main` or `master`, stop and ask whether to create a feature branch first.
2. Find the lint and test commands (CLAUDE.md, or the `project_commands` tool from the repo-tools MCP server). Run lint, then tests. If either fails, fix the cause and re-run. Do not continue while anything is red, and never skip or weaken tests to get green.
3. Ask the `code-reviewer` subagent to review `git diff HEAD`. Fix every **Must fix** item and re-run the tests.
4. Stage only the files that belong to this change, by name. Never use `git add -A` or `git add .` blindly, and never stage `.env`, keys or credentials.
5. Write a Conventional Commit message: `type(scope): summary` (72 characters max), a blank line, then a body explaining *why* the change was made. User hint: $ARGUMENTS
6. Commit. Do **not** push. Report the commit hash, the test result, and any reviewer items you chose not to fix, with the reason.

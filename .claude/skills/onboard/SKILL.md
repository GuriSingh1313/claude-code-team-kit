---
name: onboard
description: Produce a practical onboarding guide for this codebase (architecture map, how to run and test, request flow, gotchas) in docs/ONBOARDING.md. Use when someone new joins or asks how the project fits together.
argument-hint: "[optional focus area, e.g. billing]"
---

Write `docs/ONBOARDING.md` for a senior engineer joining this project today. Focus area (if any): $ARGUMENTS

## Gather facts first (read, don't guess)
1. Stack and commands: use the `project_commands` tool, then confirm against package manifests and CI config.
2. Structure: list top-level directories and identify entry points (server start, CLI main, app root, workers, cron jobs).
3. Trace one real request or job end to end (e.g. an HTTP route through validation, business logic, database and response). Cite `path:line` for each hop.
4. Configuration: list required environment variables from `.env.example`, config files or code (names only, never values).
5. Tests: where they live, how to run one file, and what is not covered.

## Document
- **What this is**: 3 sentences.
- **Run it locally**: exact commands, in order.
- **Architecture map**: a table of directory → responsibility, plus a short text diagram of the main flow.
- **A request, end to end**: the trace from step 3.
- **Conventions**: patterns the code follows consistently (error handling, naming, data access).
- **Gotchas**: surprising behaviour, flaky tests, slow paths, legacy areas to avoid. Only include items you found evidence for.
- **First tasks**: 3 small, safe changes a newcomer could make to learn the codebase.

Keep it under 250 lines. When done, suggest a 5-line summary to add to CLAUDE.md if it adds knowledge that CLAUDE.md is missing.

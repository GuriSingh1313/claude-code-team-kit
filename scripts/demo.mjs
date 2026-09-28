#!/usr/bin/env node
// Reproducible before/after demo:
//   1. audit examples/vibe-coded-app as-is
//   2. install the kit
//   3. apply the fixes a senior engineer would make (examples/fixes), remove the committed .env
// Writes the three reports and a summary to examples/reports/.
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, renderMarkdown } from "../.claude/tools/claude-ready.mjs";
import { installKit } from "./install.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS = join(KIT, "examples", "reports");
const date = new Date().toISOString().slice(0, 10);

const work = mkdtempSync(join(tmpdir(), "cctk-demo-"));
const app = join(work, "orders-api");
try {
  cpSync(join(KIT, "examples", "vibe-coded-app"), app, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });

  const stages = [];
  const snap = (label, file) => {
    const report = audit(app);
    report.project.name = "orders-api";
    writeFileSync(join(REPORTS, file), `${renderMarkdown(report, { date })}\n`);
    stages.push({ label, file, score: report.score });
  };

  snap("Vibe-coded prototype, as delivered", "1-before.md");
  installKit(app);
  snap("After installing the kit (1 command)", "2-after-kit.md");
  cpSync(join(KIT, "examples", "fixes"), app, { recursive: true });
  rmSync(join(app, ".env"), { force: true });
  snap("After the senior-engineer fixes", "3-after-fixes.md");

  const lines = [
    "# Before / after: orders-api",
    "",
    "Reproduce with `npm run demo`. The prototype is in `examples/vibe-coded-app`, the fixes in `examples/fixes`.",
    "",
    "| Stage | Score | Grade | Report |",
    "|---|---|---|---|",
    ...stages.map((s) => `| ${s.label} | **${s.score.value}/100** | ${s.score.grade} | [${s.file}](${s.file}) |`),
    "",
    "What changed in the last step: secrets moved to environment variables (and the committed `.env` removed),",
    "business logic extracted to `lib/` with tests, input validation and an API-key check on DELETE,",
    "ESLint + `checkJs`, a CI workflow that also gates on this audit, and a CLAUDE.md written from the code.",
  ];
  writeFileSync(join(REPORTS, "SUMMARY.md"), `${lines.join("\n")}\n`);
  for (const s of stages) console.log(`${String(s.score.value).padStart(3)}/100 (${s.score.grade})  ${s.label}`);
  console.log(`\nReports written to ${REPORTS}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

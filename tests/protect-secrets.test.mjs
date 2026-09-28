import { test } from "node:test";
import assert from "node:assert/strict";
import { secretFileVerdict, evaluateToolCall } from "../.claude/hooks/protect-secrets.mjs";
import { runHook } from "./helpers.mjs";

test("classifies secret files", () => {
  const deny = [".env", ".env.local", "config/.env.production", "prod.env", "certs/server.key", "tls.pem", "id_ed25519",
    "/home/a/.ssh/id_rsa", "C:\\Users\\a\\.aws\\credentials", "gcp-service-account.json", "infra/terraform.tfstate", ".git-credentials"];
  for (const p of deny) assert.equal(secretFileVerdict(p)?.decision, "deny", p);

  const ask = [".npmrc", "prod.tfvars", "config/secrets/app.yml"];
  for (const p of ask) assert.equal(secretFileVerdict(p)?.decision, "ask", p);

  const safe = [".env.example", ".env.sample", ".env.template", "src/env.ts", "id_rsa.pub", "/home/a/.ssh/known_hosts", "README.md", "environment.md", "keys.ts"];
  for (const p of safe) assert.equal(secretFileVerdict(p), null, p);
});

test("reads are denied, writes ask", () => {
  assert.equal(evaluateToolCall("Read", { file_path: ".env" }).decision, "deny");
  assert.equal(evaluateToolCall("Grep", { pattern: "KEY", path: ".env.local" }).decision, "deny");
  assert.equal(evaluateToolCall("Write", { file_path: ".env", content: "A=1" }).decision, "ask");
  assert.equal(evaluateToolCall("Edit", { file_path: "src/app.ts" }), null);
  assert.equal(evaluateToolCall("Read", {}), null);
});

test("hook process emits a deny decision for .env reads", () => {
  const r = runHook("protect-secrets.mjs", { tool_name: "Read", tool_input: { file_path: "/repo/.env" } });
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  const ok = runHook("protect-secrets.mjs", { tool_name: "Read", tool_input: { file_path: "/repo/src/index.ts" } });
  assert.equal(ok.stdout, "");
});

#!/usr/bin/env node
// PreToolUse hook for Read, Edit, Write, MultiEdit and Grep.
// Keeps secret files out of the model's context: reads are denied,
// writes ask first (creating a local .env from a template is sometimes legitimate).
import { readHookInput, emitPreToolDecision, isMain } from "./lib.mjs";

const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|defaults?|schema)$/i;

const DENY_NAMES = new Set([
  "credentials.json", "credentials", ".netrc", "_netrc", ".git-credentials", ".pypirc",
  "secrets.json", "secrets.yml", "secrets.yaml", "terraform.tfstate", "terraform.tfstate.backup",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
]);

const ASK_NAMES = new Set([".npmrc", ".yarnrc.yml", ".dockercfg"]);

/**
 * Classify a path. Returns { decision: "deny" | "ask", reason } for secret-looking files, otherwise null.
 * "deny" means reading it would leak secrets; "ask" means it often (not always) holds secrets.
 */
export function secretFileVerdict(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop();
  const lower = base.toLowerCase();

  if (TEMPLATE_SUFFIX.test(lower)) return null;
  if (/^\.env(\..+)?$/.test(lower) || /\.env$/.test(lower)) return { decision: "deny", reason: "environment file with secrets" };
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/.test(lower) && !/\.pub(\.|$)/.test(lower)) return { decision: "deny", reason: "private key or certificate" };
  if (DENY_NAMES.has(lower)) return { decision: "deny", reason: "credentials file" };
  if (/service[-_]?account.*\.json$/.test(lower)) return { decision: "deny", reason: "cloud service-account key" };
  if (/(^|\/)\.aws\/(credentials|config)$/.test(norm)) return { decision: "deny", reason: "AWS credentials" };
  if (/(^|\/)\.ssh\//.test(norm) && !/(\.pub|known_hosts|config)$/.test(lower)) return { decision: "deny", reason: "SSH private material" };
  if (/(^|\/)\.docker\/config\.json$/.test(norm) || /(^|\/)\.kube\/config$/.test(norm)) return { decision: "deny", reason: "registry or cluster credentials" };
  if (ASK_NAMES.has(lower)) return { decision: "ask", reason: "may contain registry tokens" };
  if (/\.tfvars(\.json)?$/.test(lower)) return { decision: "ask", reason: "Terraform variables often hold secrets" };
  if (/(^|\/)secrets?\//i.test(norm)) return { decision: "ask", reason: "inside a secrets directory" };
  return null;
}

/** Decide for a tool call payload. Returns { decision, reason } or null. */
export function evaluateToolCall(toolName, toolInput = {}) {
  const path = toolInput.file_path || toolInput.notebook_path || toolInput.path;
  const verdict = secretFileVerdict(path);
  if (!verdict) return null;
  const isWrite = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(toolName || "");
  if (isWrite) {
    return { decision: "ask", reason: `Writing ${path} (${verdict.reason}). Confirm no real secret values are being written by the agent.` };
  }
  return {
    decision: verdict.decision,
    reason:
      verdict.decision === "deny"
        ? `Reading ${path} would put a ${verdict.reason} into the conversation. Use the variable names from a .env.example instead.`
        : `${path} ${verdict.reason}. Confirm before reading.`,
  };
}

if (isMain(import.meta.url)) {
  const input = readHookInput();
  const verdict = evaluateToolCall(input.tool_name, input.tool_input);
  if (verdict) emitPreToolDecision(verdict.decision, `[protect-secrets] ${verdict.reason}`);
  process.exit(0);
}

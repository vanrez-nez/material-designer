#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));
const require = createRequire(import.meta.url);
const CODEX_CLI_PATH = join(dirname(require.resolve("@openai/codex/package.json")), "bin", "codex.js");
const MATERIAL_MCP_PATH = join(ROOT, "scripts", "material-mcp-server.mjs");
const DEFAULT_LOG_ROOT = join(ROOT, "artifacts", "material-author-review");
const CODEX_PROVIDER_ID = "material_author_review_http";
const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const RUN_LOG_SCHEMA_VERSION = 1;
const MCP_PREFLIGHT_TIMEOUT_MS = 10_000;
const MCP_PREFLIGHT_RETRY_MS = 500;
const DEFAULT_AUTHOR_MODEL = "gpt-5.6-terra";
const DEFAULT_REVIEWER_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high";
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const DOCUMENT_MUTATION_TOOLS = new Set([
  "add_node", "remove_node", "set_param", "set_label", "connect_edge", "disconnect_edge",
  "load_document", "set_output_resolution", "restore_snapshot",
]);
const PARENT_CODEX_ENV_KEYS = new Set([
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "CODEX_CI",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_MANAGED_BY_NPM",
  "CODEX_MANAGED_PACKAGE_ROOT",
  "CODEX_PERMISSION_PROFILE",
  "CODEX_SESSION_ID",
  "CODEX_THREAD_ID",
  "OPENAI_API_KEY",
]);
const SECRET_KEY = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)/i;
const TRANSPORT_ERROR = /\b(?:408|425|429|500|502|503|504)\b|service unavailable|server_is_overloaded|temporarily overloaded|failed to connect|connection (?:reset|termination|closed)|stream disconnected|upstream connect|unexpected eof|socket hang up/i;
const CONTINUE_AFTER_TRANSPORT_FAILURE = `Continue the most recent interrupted instruction after a transport failure.
Do not repeat MCP mutations or saves that already succeeded. Inspect the current live document or prior tool results as needed, finish the requested work, and return only the required structured response.`;
const REVIEWER_CONTINUE_AFTER_TRANSPORT_FAILURE = `Continue the interrupted visual review after a transport failure.
Use only the attached current render.png and reference images. Do not call tools or discuss the graph. Finish and return only the required structured verdict.`;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REVIEW_EVIDENCE_KEYS = [
  "renderInspected",
  "referencesCompared",
];
const AUTHOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["revised", "blocked"] },
    summary: { type: "string" },
    savedVersionId: { type: "string" },
    snapshotId: { type: "string" },
    nodeCount: { type: "integer", minimum: 0, maximum: 59 },
    contributionChecks: { type: "integer", minimum: 0, maximum: 59 },
  },
  required: ["status", "summary", "savedVersionId", "snapshotId", "nodeCount", "contributionChecks"],
};
const SAVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["saved", "blocked"] },
    summary: { type: "string" },
    savedVersionId: { type: "string" },
  },
  required: ["status", "summary", "savedVersionId"],
};
const REVIEWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    accepted: { type: "boolean" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        renderInspected: { type: "boolean" },
        referencesCompared: { type: "boolean" },
      },
      required: REVIEW_EVIDENCE_KEYS,
    },
    strengths: { type: "array", items: { type: "string" } },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          priority: { type: "string", enum: ["blocker", "major", "minor"] },
          observation: { type: "string" },
          requestedChange: { type: "string" },
        },
        required: ["priority", "observation", "requestedChange"],
      },
    },
    requiredChanges: { type: "array", items: { type: "string" } },
  },
  required: ["accepted", "score", "summary", "evidence", "strengths", "issues", "requiredChanges"],
};
function usage() {
  console.log(`
Usage:
  npm run material:author-review -- <task-folder> [options]

The folder is read recursively. Markdown files form the brief and PNG/JPEG/WebP
files are attached to both agents. Agent work is MCP-only. A complete, compacted
event log is written under artifacts/material-author-review by default.

Prerequisites:
  1. Run: npm run dev
  2. Open http://material-designer.localhost and leave the tab open.
  3. Ensure the material-designer MCP is registered for Codex.

Options:
  --title <title>             Saved MCP library title (default: folder name)
  --max-rounds <n>            Author/reviewer rounds before failing (default: 8)
  --min-score <0..100>        Reviewer score required for acceptance (default: 85)
  --timeout-minutes <n>       Timeout for each agent turn (default: 30)
  --transport-retries <n>     Retries for transient 429/5xx failures (default: 4)
  --author-model <model>      Agent 1 model (default: gpt-5.6-terra); repeat for a schedule
  --author-effort <effort>    Agent 1 effort (default: high); repeat for a schedule
  --reviewer-model <model>    Agent 2 model (default: gpt-5.6-sol); repeat for a schedule
  --reviewer-effort <effort>  Agent 2 effort (default: high); repeat for a schedule
  --log-dir <path>            Event log root (default: artifacts/material-author-review)
  --dry-run                   Validate inputs and print the execution plan only
  --help                      Show this help

Example:
  npm run material:author-review -- /path/to/rusty-copper --title "Rusty Copper"

Repeated model and effort options apply in turn order. When a schedule is shorter
than the run, its last value is reused for later turns.
`);
}

function parseArgs(argv) {
  const opts = {
    taskFolder: "", title: "", maxRounds: 8, minScore: 85, timeoutMinutes: 30,
    transportRetries: 4, authorModels: [], authorEfforts: [], reviewerModels: [], reviewerEfforts: [],
    logDir: DEFAULT_LOG_ROOT, dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "--title") opts.title = value();
    else if (arg === "--max-rounds") opts.maxRounds = Number(value());
    else if (arg === "--min-score") opts.minScore = Number(value());
    else if (arg === "--timeout-minutes") opts.timeoutMinutes = Number(value());
    else if (arg === "--transport-retries") opts.transportRetries = Number(value());
    else if (arg === "--author-model") opts.authorModels.push(value());
    else if (arg === "--author-effort") opts.authorEfforts.push(value());
    else if (arg === "--reviewer-model") opts.reviewerModels.push(value());
    else if (arg === "--reviewer-effort") opts.reviewerEfforts.push(value());
    else if (arg === "--log-dir") opts.logDir = value();
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.taskFolder) opts.taskFolder = arg;
    else throw new Error(`Unexpected positional argument: ${arg}`);
  }
  if (!opts.taskFolder) throw new Error("A task folder is required.");
  opts.taskFolder = isAbsolute(opts.taskFolder) ? opts.taskFolder : resolve(process.cwd(), opts.taskFolder);
  if (!Number.isInteger(opts.maxRounds) || opts.maxRounds < 1) throw new Error("--max-rounds must be a positive integer.");
  if (!Number.isInteger(opts.minScore) || opts.minScore < 0 || opts.minScore > 100) {
    throw new Error("--min-score must be an integer from 0 to 100.");
  }
  if (!Number.isFinite(opts.timeoutMinutes) || opts.timeoutMinutes <= 0) {
    throw new Error("--timeout-minutes must be greater than zero.");
  }
  if (!Number.isInteger(opts.transportRetries) || opts.transportRetries < 0) {
    throw new Error("--transport-retries must be a non-negative integer.");
  }
  for (const effort of [...opts.authorEfforts, ...opts.reviewerEfforts]) {
    if (!REASONING_EFFORTS.has(effort)) {
      throw new Error(`Invalid reasoning effort ${JSON.stringify(effort)}. Use low, medium, high, xhigh, max, or ultra.`);
    }
  }
  if (!opts.authorModels.length) opts.authorModels.push(DEFAULT_AUTHOR_MODEL);
  if (!opts.reviewerModels.length) opts.reviewerModels.push(DEFAULT_REVIEWER_MODEL);
  if (!opts.authorEfforts.length) opts.authorEfforts.push(DEFAULT_REASONING_EFFORT);
  if (!opts.reviewerEfforts.length) opts.reviewerEfforts.push(DEFAULT_REASONING_EFFORT);
  opts.title ||= basename(opts.taskFolder);
  opts.logDir = isAbsolute(opts.logDir) ? opts.logDir : resolve(process.cwd(), opts.logDir);
  return opts;
}

function collectFiles(folder, result = { markdown: [], images: [] }) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (entry.isDirectory() && entry.name === "snapshot")) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) collectFiles(path, result);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") result.markdown.push(path);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) result.images.push(path);
  }
  result.markdown.sort();
  result.images.sort();
  return result;
}

function buildBrief(taskFolder, markdownFiles, imageFiles) {
  const descriptions = markdownFiles
    .map((path) => `## ${relative(taskFolder, path)}\n\n${readFileSync(path, "utf8").trim()}`)
    .join("\n\n");
  const images = imageFiles.map((path, index) => `${index + 1}. ${relative(taskFolder, path)}`).join("\n");
  return `# Material task\n\n${descriptions}\n\n# Attached reference images\n\n${images}`;
}

function authorInitialPrompt(brief, title, minScore) {
  return `You are Agent 1, the material author. Create one excellent procedural material in the currently open Material Designer document.

Boundaries and requirements:
- Use only the material-designer MCP. Do not use shell commands, browser automation, filesystem writes, source edits, generated files, or any other MCP.
- All graph creation and editing must happen through MCP mutation tools. Start with get_registry and get_document; never guess ports or parameter contracts.
- Do not save a version yet. The runner will explicitly tell you when Agent 2 accepts it.
- Build a purposeful PBR graph ending in principled-bsdf -> material-output. Connect base color, roughness, normal, metallic, ambient occlusion, and useful height/detail where appropriate.
- Keep the complete graph below 60 nodes, including shader and output nodes. Prefer the simplest graph that achieves the reference.
- Give every node a concise, friendly, contribution-oriented display title with set_label, such as "Large Rust Pits" or "Fine Roughness Breakup". Never leave generic, blank, duplicated, or numbered-only titles.
- Before finishing, trace every node's downstream path to Material Output and remove every unconnected, unreachable, unused, superseded, or redundant node.
- Verify every diff-capable data node's visible contribution yourself with get_render using {nodeId, view:"difference", size:1024, maxDim:1024, profile:"standard", scale:1}. Use the returned difference statistics. If the result is all zero, retry at scale 2 and, when relevant, on the final PBR channel that node is intended to affect. Every difference render must remain at size 1024 and maxDim 1024. A node that remains all zero does not belong in the graph: remove it or rework it, then check again. The principled-bsdf shader and material-output nodes are exempt because MCP isolation does not support shader/output nodes; both must still be connected.
- Preserve seamless tiling. Avoid obvious procedural regularity, implausible scale, clipped values, and details that contradict the references.
- Before finishing, call regenerate and inspect any useful debug renders yourself. These debug renders are not reviewer evidence.
- When the graph is final, call get_render exactly once with {size:1024, maxDim:1024, profile:"standard", scale:1} and no nodeId, view, or channel. This is the sole reviewer-facing render.png.
- Immediately after that final render, call create_snapshot with label "Author delivery round 1", then call get_document as your final MCP tool call. Do not mutate after producing the final render or delivery snapshot.
- The acceptance bar is ${minScore}/100; a merely valid graph is insufficient.

The eventual library title is ${JSON.stringify(title)}.

${brief}

Author the live MCP document now. Return status "revised", a concise summary, an empty savedVersionId, the exact snapshotId returned by create_snapshot, the final total nodeCount, and the number of distinct final diff-capable data nodes checked in contributionChecks. Do not include principled-bsdf or material-output in contributionChecks. Return "blocked" only if the MCP remains unavailable after retrying; use an empty snapshotId and zero counts when blocked.`;
}

function authorRevisionPrompt(round, review, minScore) {
  return `Agent 2 rejected round ${round - 1}. Revise the same live MCP document to address this report:

${JSON.stringify(review, null, 2)}

Use only material-designer MCP calls. Do not write files or save a version. Before adding nodes, step back and decide which existing parts work, which are redundant, and whether the rejected approach should be simplified or replaced. Do not keep patching corrective branches onto a wrong approach; remove or rewire failed work first, and keep the node count flat or lower unless a genuinely necessary replacement requires otherwise.

The finished graph must contain fewer than 60 total nodes. Give every node a concise, friendly, contribution-oriented title with set_label. Remove every unconnected, unreachable, unused, superseded, or redundant node. For every diff-capable data node, verify visible contribution yourself with get_render {nodeId, view:"difference", size:1024, maxDim:1024, profile:"standard", scale:1}; investigate an all-zero result at scale 2 and on its intended final PBR channel, always keeping size and maxDim at 1024, then remove or rework any node that remains all zero. The principled-bsdf shader and material-output nodes are exempt because MCP isolation does not support shader/output nodes; both must still be connected.

After cleanup, call regenerate and inspect any useful debug renders yourself. Then call get_render exactly once with {size:1024, maxDim:1024, profile:"standard", scale:1} and no nodeId, view, or channel; this is the sole reviewer-facing render.png. Immediately afterward call create_snapshot with label "Author delivery round ${round}", then call get_document as your final MCP tool call. Do not mutate after producing the final render or snapshot. The acceptance bar is ${minScore}/100. Return status "revised", a concise summary, an empty savedVersionId, the exact snapshotId, final total nodeCount, and the number of distinct final diff-capable data nodes checked in contributionChecks; do not count principled-bsdf or material-output. Use "blocked" only for a genuine MCP failure, with an empty snapshotId and zero counts.`;
}

function reviewerInitialPrompt(brief, minScore) {
  return `You are Agent 2, the independent material quality reviewer. Evaluate the attached final render against the attached references.

Boundaries and review contract:
- The first attached image is the current 1024px render.png. Every remaining attached image is a task reference.
- Use no tools or MCP calls. Do not inspect or discuss the graph, nodes, labels, organization, complexity, or authoring practices.
- Compare identity, structure, scale, palette/value range, roughness, relief/normals, tiling seams, repetition, artifacts, and reference-specific details.
- Accept only if the visible result is production-worthy, at least ${minScore}/100, with no blocker/major visual issue and no required visual change.
- Keep feedback visual and actionable. Set renderInspected and referencesCompared true only after actually comparing the attachments.

${brief}

Review the attached candidate and return only the required structured verdict.`;
}

function reviewerNextPrompt(round, minScore) {
  return `Review round ${round}. The first attached image is the current round's 1024px render.png; all remaining images are the original references.

Use no tools or MCP calls. Compare only the visible final result against the references. Do not inspect or discuss graph organization, nodes, labels, complexity, or authoring practices. Accept only at ${minScore}/100 or higher, with renderInspected and referencesCompared true, no blocker/major visual issue, and no required visual changes. Keep rejection feedback visual and actionable for Agent 1. Return only the structured verdict.`;
}

function savePrompt(title, round, review) {
  return `Agent 2 accepted round ${round}. Make the accepted live document the sole final job artifact.

Use only material-designer MCP. Call get_document to confirm the live document still has fewer than 60 total nodes, no disconnected nodes, and a friendly label on every node; if not, return blocked rather than saving a document different from the accepted contract. Then call save_version with title ${JSON.stringify(title)} and overwrite false. Call list_versions and verify the saved id is present. If this instruction is resumed after a transport failure and you already saved the accepted document, do not save a duplicate; recover and report the previously returned id from this conversation and verify it with list_versions. Do not edit the graph or write any file.

Accepted review:\n${JSON.stringify(review, null, 2)}

Return status "saved", a concise summary, and the exact library id in savedVersionId. On failure return "blocked" with an empty id.`;
}

function parseStructured(raw, label) {
  try { return JSON.parse(raw); }
  catch (error) {
    throw new Error(`${label} did not return valid structured JSON: ${error.message}. Response: ${truncateStatus(raw, 700)}`);
  }
}

function acceptedByGate(review, minScore) {
  const serious = review.issues.some((issue) => issue.priority === "blocker" || issue.priority === "major");
  return review.accepted && review.score >= minScore
    && REVIEW_EVIDENCE_KEYS.every((key) => review.evidence?.[key] === true)
    && !serious && review.requiredChanges.length === 0;
}

function modelForTurn(models, turnIndex) {
  if (!models.length) return "";
  return models[Math.min(turnIndex, models.length - 1)];
}

function sanitizeEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => value !== undefined && !PARENT_CODEX_ENV_KEYS.has(key)),
  );
}

function tomlLiteral(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlLiteral).join(",")}]`;
  throw new Error(`Unsupported Codex config value: ${typeof value}`);
}

function configOverride(key, value) {
  return ["--config", `${key}=${tomlLiteral(value)}`];
}

function buildCodexConfigArgs(env, role = "author") {
  const mcpEnv = {
    MD_CALL_TIMEOUT_MS: env.MD_CALL_TIMEOUT_MS || "20000",
    MD_WS_PORT: env.MD_WS_PORT || "51787",
    MD_WS_PORT_SPAN: env.MD_WS_PORT_SPAN || "16",
  };
  const args = [
    ...configOverride("approval_policy", "never"),
    ...configOverride("sandbox_mode", role === "reviewer" ? "read-only" : "danger-full-access"),
    ...configOverride("model_provider", CODEX_PROVIDER_ID),
    ...configOverride(`model_providers.${CODEX_PROVIDER_ID}.name`, "Material Author HTTPS"),
    ...configOverride(`model_providers.${CODEX_PROVIDER_ID}.base_url`, CHATGPT_CODEX_BASE_URL),
    ...configOverride(`model_providers.${CODEX_PROVIDER_ID}.wire_api`, "responses"),
    ...configOverride(`model_providers.${CODEX_PROVIDER_ID}.requires_openai_auth`, true),
    ...configOverride(`model_providers.${CODEX_PROVIDER_ID}.supports_websockets`, false),
    ...configOverride("features.apps", false),
    ...configOverride("features.memories", false),
    ...configOverride("features.multi_agent", false),
    ...configOverride("features.view_image", false),
    ...configOverride("web_search", "disabled"),
  ];
  if (role !== "reviewer") {
    args.push(
      ...configOverride("mcp_servers.material-designer.command", process.execPath),
      ...configOverride("mcp_servers.material-designer.args", [MATERIAL_MCP_PATH]),
      ...configOverride("mcp_servers.material-designer.cwd", ROOT),
      ...configOverride("mcp_servers.material-designer.required", true),
      ...configOverride("mcp_servers.material-designer.default_tools_approval_mode", "approve"),
    );
    for (const [key, value] of Object.entries(mcpEnv)) {
      args.push(...configOverride(`mcp_servers.material-designer.env.${key}`, value));
    }
  }
  return args;
}

function buildCodexArgs({ env, images, model, effort, outputSchemaPath, threadId, role = "author" }) {
  const args = [CODEX_CLI_PATH, "exec"];
  if (threadId) args.push("resume");
  args.push("--json", "--ignore-user-config", "--strict-config", "--skip-git-repo-check");
  args.push(...buildCodexConfigArgs(env, role));
  if (effort) args.push(...configOverride("model_reasoning_effort", effort));
  if (model) args.push("--model", model);
  if (outputSchemaPath) args.push("--output-schema", outputSchemaPath);
  for (const image of images) args.push("--image", image);
  if (threadId) args.push(threadId);
  args.push("-");
  return args;
}

function approximateBase64Bytes(payload) {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function compactDataUrl(value) {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\r\n]+)$/s.exec(value);
  if (!match) return null;
  const payload = match[2].replace(/\s/g, "");
  return {
    compacted: "base64",
    mimeType: match[1],
    encodedCharacters: payload.length,
    approximateBytes: approximateBase64Bytes(payload),
  };
}

function compactOutput(value, key = "") {
  if (key && SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return compactDataUrl(value) || value;
  if (Array.isArray(value)) return value.map((item) => compactOutput(item));
  if (!value || typeof value !== "object") return value;

  const compacted = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if ((value.type === "image" || value.type === "audio") && childKey === "data" && typeof childValue === "string") {
      const payload = childValue.replace(/\s/g, "");
      compacted[childKey] = {
        compacted: "base64",
        mimeType: value.mimeType || "application/octet-stream",
        encodedCharacters: payload.length,
        approximateBytes: approximateBase64Bytes(payload),
      };
    } else {
      compacted[childKey] = compactOutput(childValue, childKey);
    }
  }
  return compacted;
}

function redactText(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-api-key]");
}

function slugify(value) {
  return value.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "run";
}

function collectEventImages(value, images = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    const match = /^data:(image\/[^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\r\n]+)$/s.exec(value);
    if (match) images.push({ mimeType: match[1], data: match[2].replace(/\s/g, "") });
    return images;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return images;
  seen.add(value);
  if (value.type === "image" && typeof value.data === "string") {
    images.push({ mimeType: value.mimeType || "image/png", data: value.data.replace(/\s/g, "") });
  }
  for (const [key, child] of Object.entries(value)) {
    if (value.type === "image" && key === "data") continue;
    collectEventImages(child, images, seen);
  }
  return images;
}

function materialDocumentFromEvent(event) {
  if (event.type !== "item.completed" || event.item?.type !== "mcp_tool_call"
      || event.item.tool !== "get_document" || event.item.status !== "completed") return null;
  return materialDocumentFromResult(event.item.result);
}

function materialDocumentFromResult(result) {
  const candidates = [result?.structuredContent, result];
  for (const block of result?.content ?? []) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    try { candidates.push(JSON.parse(block.text)); } catch { /* Non-JSON MCP text is not a document. */ }
  }
  for (const candidate of candidates) {
    const document = candidate?.document ?? candidate;
    if (document && Array.isArray(document.nodes) && Array.isArray(document.edges)) return document;
  }
  return null;
}

function mcpResultError(result) {
  if (!result?.isError) return "";
  const message = (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ");
  return message.replace(/^Error:\s*/i, "") || "MCP tool returned an error.";
}

async function createMaterialMcpProbe(env, options = {}) {
  const timeoutMs = options.timeoutMs ?? MCP_PREFLIGHT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? MCP_PREFLIGHT_RETRY_MS;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MATERIAL_MCP_PATH],
    cwd: ROOT,
    env: {
      MD_CALL_TIMEOUT_MS: env.MD_CALL_TIMEOUT_MS || "20000",
      MD_WS_PORT: env.MD_WS_PORT || "51787",
      MD_WS_PORT_SPAN: env.MD_WS_PORT_SPAN || "16",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "material-author-review-preflight", version: "0.1.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw new Error(`Could not start the Material Designer MCP preflight: ${error.message}`);
  }

  return {
    async getDocument() {
      const deadline = Date.now() + timeoutMs;
      let lastError = "Material Designer MCP did not respond.";
      do {
        try {
          const result = await client.callTool(
            { name: "get_document", arguments: {} },
            undefined,
            { timeout: Math.min(5_000, Math.max(1, deadline - Date.now())) },
          );
          const resultError = mcpResultError(result);
          if (resultError) throw new Error(resultError);
          const document = materialDocumentFromResult(result);
          if (!document) throw new Error("get_document returned no valid material document.");
          return document;
        } catch (error) {
          lastError = error.message || String(error);
        }
        if (Date.now() + retryMs < deadline) {
          await new Promise((resolveWait) => setTimeout(resolveWait, retryMs));
        }
      } while (Date.now() < deadline);
      throw new Error(lastError);
    },
    close: () => client.close(),
  };
}

async function requireMaterialMcp(probe, logger, turnName) {
  logOrchestrator(logger, `checking Material Designer MCP before ${turnName}`);
  try {
    const document = await probe.getDocument();
    logOrchestrator(logger, `Material Designer MCP ready before ${turnName}: ${document.nodes.length} nodes`);
    return document;
  } catch (error) {
    throw new Error(
      `Material Designer MCP preflight failed before ${turnName}; no agent turn was started: ${error.message}`,
    );
  }
}

function snapshotFromEvent(event) {
  if (event.type !== "item.completed" || event.item?.type !== "mcp_tool_call"
      || event.item.tool !== "create_snapshot" || event.item.status !== "completed") return null;
  const candidates = [event.item.result?.structuredContent, event.item.result];
  for (const block of event.item.result?.content ?? []) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    try { candidates.push(JSON.parse(block.text)); } catch { /* Non-JSON MCP text is not snapshot metadata. */ }
  }
  return candidates.find((candidate) => (
    candidate && typeof candidate.id === "string" && typeof candidate.label === "string"
  )) ?? null;
}

function toolArguments(event) {
  const value = event.item?.arguments;
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function createRunLogger(logRoot, title, taskFolder, now = new Date()) {
  mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = join(logRoot, `${stamp}-${slugify(title)}`);
  let directory = base;
  for (let suffix = 2; ; suffix += 1) {
    try {
      mkdirSync(directory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      directory = `${base}-${suffix}`;
    }
  }
  const path = join(directory, "events.jsonl");
  writeFileSync(path, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  let sequence = 0;
  const turnStates = new Map();

  function getTurnState(context) {
    const round = String(context.round || 0).padStart(2, "0");
    const key = `${round}-${context.role}-${context.phase}`;
    if (turnStates.has(key)) return turnStates.get(key);
    const turnDirectory = join(directory, `round-${round}`, `${context.role}-${context.phase}`);
    const isAuthorDelivery = context.role === "author"
      && (context.phase === "authoring" || context.phase === "revision");
    const diffsDirectory = isAuthorDelivery ? join(turnDirectory, "diffs") : "";
    mkdirSync(diffsDirectory || turnDirectory, { recursive: true, mode: 0o700 });
    const deliveryDirectory = isAuthorDelivery ? join(turnDirectory, "snapshot") : "";
    if (deliveryDirectory) mkdirSync(deliveryDirectory, { recursive: true });
    const state = {
      directory: turnDirectory,
      diffsDirectory,
      deliveryDirectory,
      evidencePath: join(turnDirectory, "evidence.jsonl"),
      documentPath: deliveryDirectory ? join(deliveryDirectory, "document.json") : "",
      snapshotPath: deliveryDirectory ? join(deliveryDirectory, "snapshot.json") : "",
      renderPath: deliveryDirectory ? join(deliveryDirectory, "render.png") : "",
      diffNames: new Map(),
      document: null,
      hasDocument: false,
      finalRenderCount: 0,
      snapshotId: "",
      documentAfterSnapshot: false,
      snapshotAfterFinalRender: false,
      policyErrors: [],
      evidenceAnnounced: false,
    };
    turnStates.set(key, state);
    return state;
  }

  function record(entry, evidenceContext = null) {
    const envelope = compactOutput({
      schemaVersion: RUN_LOG_SCHEMA_VERSION,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      ...entry,
    });
    const line = `${JSON.stringify(envelope)}\n`;
    appendFileSync(path, line, "utf8");
    if (evidenceContext) appendFileSync(getTurnState(evidenceContext).evidencePath, line, "utf8");
    return envelope;
  }

  return {
    directory,
    path,
    record,
    async recordAgentEvent(context, threadId, event) {
      const state = getTurnState(context);
      const artifacts = [];
      const completedTool = event.type === "item.completed" && event.item?.type === "mcp_tool_call"
        && event.item.status === "completed" ? event.item.tool : "";
      if (DOCUMENT_MUTATION_TOOLS.has(completedTool)) {
        state.hasDocument = false;
        state.finalRenderCount = 0;
        state.document = null;
        state.snapshotId = "";
        state.documentAfterSnapshot = false;
        state.snapshotAfterFinalRender = false;
      }
      if (context.role === "reviewer" && completedTool) {
        state.policyErrors.push(`Reviewer called forbidden MCP tool ${completedTool}.`);
      }
      if (context.role === "reviewer" && event.type === "item.completed"
          && (event.item?.type === "command_execution" || event.item?.type === "file_change")) {
        state.policyErrors.push(`Reviewer used forbidden ${event.item.type}.`);
      }

      const args = toolArguments(event);
      const images = collectEventImages(event);
      if (completedTool === "get_render" && args.view === "difference") {
        if (context.role !== "author") state.policyErrors.push("Only the author may produce difference renders.");
        if (args.size !== 1024 || args.maxDim !== 1024) {
          state.policyErrors.push(`Difference render for ${args.nodeId || "unknown node"} was not requested at 1024px.`);
        }
        if (context.role === "author") {
          const channel = slugify(args.channel || "lit");
          const modeParts = [args.nodeId || "node"];
          if (args.profile && args.profile !== "standard") modeParts.push(args.profile);
          if (args.scale && args.scale !== 1) modeParts.push(`scale-${args.scale}`);
          const baseName = `${channel}-diff-${slugify(modeParts.join("-"))}`;
          const occurrence = (state.diffNames.get(baseName) || 0) + 1;
          state.diffNames.set(baseName, occurrence);
          const filename = `${baseName}${occurrence > 1 ? `-${occurrence}` : ""}.png`;
          const imagePath = join(state.diffsDirectory, filename);
          for (const image of images) {
            await sharp(Buffer.from(image.data, "base64")).resize(1024, 1024).png().toFile(imagePath);
            artifacts.push(relative(directory, imagePath));
          }
        }
      } else if (completedTool === "get_render" && context.role === "author"
          && state.deliveryDirectory && !args.nodeId && !args.view && !args.channel
          && (args.profile === undefined || args.profile === "standard")
          && (args.scale === undefined || args.scale === 1) && args.size === 1024 && args.maxDim === 1024) {
        state.finalRenderCount += images.length;
        for (const image of images) {
          await sharp(Buffer.from(image.data, "base64")).resize(1024, 1024).png().toFile(state.renderPath);
          artifacts.push(relative(directory, state.renderPath));
        }
      }
      const snapshot = snapshotFromEvent(event);
      if (snapshot && state.deliveryDirectory) {
        writeFileSync(state.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
        state.snapshotId = snapshot.id;
        state.documentAfterSnapshot = false;
        state.snapshotAfterFinalRender = state.finalRenderCount === 1;
        artifacts.push(relative(directory, state.snapshotPath));
      }
      const document = materialDocumentFromEvent(event);
      if (document && state.deliveryDirectory) {
        writeFileSync(state.documentPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
        state.document = document;
        state.hasDocument = true;
        state.documentAfterSnapshot = Boolean(state.snapshotId);
        artifacts.push(relative(directory, state.documentPath));
      }
      const envelope = record({
        source: "codex",
        stream: "stdout",
        threadId: threadId || "",
        ...context,
        event,
        artifacts,
      }, context);
      if (!state.evidenceAnnounced) {
        state.evidenceAnnounced = true;
        artifacts.unshift(relative(directory, state.evidencePath));
      }
      return { event: envelope.event, artifacts };
    },
    completeTurn(context, thread, result) {
      const state = getTurnState(context);
      const resultPath = join(state.directory, "result.json");
      writeFileSync(resultPath, `${JSON.stringify(compactOutput({
        threadId: thread.id,
        model: thread.model,
        effort: thread.effort,
        result,
      }), null, 2)}\n`, { mode: 0o600 });
      record({
        source: "orchestrator",
        ...context,
        event: { type: "turn.archived", resultPath: relative(directory, resultPath) },
      }, context);
      return relative(directory, resultPath);
    },
    authorDeliveryErrors(context, result) {
      const state = getTurnState(context);
      const errors = [...state.policyErrors];
      if (!state.hasDocument || !state.document) errors.push("Missing final document.json.");
      if (!state.documentAfterSnapshot) errors.push("Final get_document did not follow create_snapshot.");
      if (!state.snapshotAfterFinalRender) errors.push("create_snapshot did not follow the sole final render.");
      if (state.finalRenderCount !== 1) errors.push(`Expected exactly one final render; archived ${state.finalRenderCount}.`);
      if (!state.snapshotId) errors.push("Missing MCP snapshot.");
      else if (state.snapshotId !== result.snapshotId) {
        errors.push(`Reported snapshotId ${result.snapshotId || "<empty>"} does not match ${state.snapshotId}.`);
      }
      const nodes = Array.isArray(state.document?.nodes) ? state.document.nodes : [];
      if (nodes.length !== result.nodeCount) {
        errors.push(`Reported nodeCount ${result.nodeCount} does not match document node count ${nodes.length}.`);
      }
      return errors;
    },
    hasAuthorDelivery(context, result) {
      return this.authorDeliveryErrors(context, result).length === 0;
    },
    delivery(context) {
      const state = getTurnState(context);
      return { directory: state.deliveryDirectory, renderPath: state.renderPath, documentPath: state.documentPath };
    },
    policyErrors(context) {
      return [...getTurnState(context).policyErrors];
    },
  };
}

function logOrchestrator(logger, message, context = {}, level = "log") {
  const safeMessage = redactText(message);
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer(`[orchestrator] ${safeMessage}`);
  logger?.record({ source: "orchestrator", level, message: safeMessage, ...context });
}

function eventPrefix(context) {
  const round = context.round ? `round ${context.round}` : context.phase;
  return `[${context.role}][${round}][${context.phase}][attempt ${context.attempt}]`;
}

function truncateStatus(value, maxLength = 500) {
  const text = redactText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatToolArguments(event) {
  const args = toolArguments(event);
  const visible = Object.entries(args)
    .filter(([key, value]) => key !== "document" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .slice(0, 8)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return visible.length ? ` (${visible.join(", ")})` : "";
}

function formatCodexEvent(event) {
  if (event.type === "thread.started") return `thread started: ${event.thread_id}`;
  if (event.type === "turn.started") return "turn started";
  if (event.type === "turn.completed") return "turn completed";
  if (event.type === "turn.failed") return `turn failed: ${truncateStatus(event.error?.message || "unknown error")}`;
  if (event.type === "error") return `error: ${truncateStatus(event.message || "unknown error")}`;
  const item = event.item;
  if (!item) return truncateStatus(event.type);
  if (item.type === "mcp_tool_call") {
    const status = event.type === "item.started" ? "calling" : item.status || "completed";
    return `${status} ${item.tool || "MCP tool"}${formatToolArguments(event)}`;
  }
  if (item.type === "agent_message") {
    try {
      const message = JSON.parse(item.text);
      if (typeof message.score === "number") {
        return `review score=${message.score} accepted=${Boolean(message.accepted)}: ${truncateStatus(message.summary)}`;
      }
      return `${message.status || "message"}: ${truncateStatus(message.summary || item.text)}`;
    } catch {
      return `message: ${truncateStatus(item.text)}`;
    }
  }
  if (item.type === "reasoning") {
    return `thinking: ${truncateStatus(item.text || item.summary || "reasoning completed")}`;
  }
  if (item.type === "command_execution") {
    return `${item.status || "command"}: ${truncateStatus(item.command)}`;
  }
  if (item.type === "file_change") return `file changes: ${item.status || "completed"}`;
  if (item.type === "error") return `error: ${truncateStatus(item.message)}`;
  return `${event.type}: ${item.type}`;
}

async function emitCodexEvent(logger, context, threadId, event) {
  const archived = logger ? await logger.recordAgentEvent(context, threadId, event) : null;
  console.log(`${eventPrefix(context)} ${formatCodexEvent(event)}`);
  for (const artifact of archived?.artifacts ?? []) {
    console.log(`${eventPrefix(context)} file created: ${artifact}`);
  }
}

function emitCodexStderr(logger, context, threadId, line) {
  const text = truncateStatus(line, 700);
  console.error(`${eventPrefix(context)}[stderr] ${text}`);
  logger?.record({
    source: "codex",
    stream: "stderr",
    threadId: threadId || "",
    ...context,
    text,
  }, context);
}

async function withSchemaFile(schema, callback) {
  const directory = mkdtempSync(join(tmpdir(), "material-author-review-schema-"));
  const path = join(directory, "schema.json");
  writeFileSync(path, JSON.stringify(schema), "utf8");
  try {
    return await callback(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertChatGptLogin(env, logger) {
  const result = spawnSync(process.execPath, [CODEX_CLI_PATH, "login", "status"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.error || result.status !== 0) {
    const detail = status || result.error?.message || `exit code ${result.status}`;
    throw new Error(`Could not verify the local Codex login: ${detail}`);
  }
  if (!/\bChatGPT\b/i.test(status)) {
    throw new Error(
      `This workflow requires a ChatGPT Codex login and will not run with API-key authentication. `
      + `Current status: ${status || "unknown"}. Run \`codex login\` and choose ChatGPT.`,
    );
  }
  const version = spawnSync(process.execPath, [CODEX_CLI_PATH, "--version"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  logOrchestrator(logger, `authentication: ChatGPT subscription; ${version.stdout.trim() || "Codex CLI"}`);
}

function makeAttemptError(message, details = {}) {
  const error = new Error(message);
  error.retryable = details.retryable ?? TRANSPORT_ERROR.test(message);
  Object.assign(error, details);
  return error;
}

async function runCodexAttempt({
  role, phase, round, attempt, thread, prompt, images, schema, timeoutMs, env, logger,
  cliPath = CODEX_CLI_PATH, nodePath = process.execPath,
}) {
  return withSchemaFile(schema, async (outputSchemaPath) => {
    const context = { role, phase, round, attempt };
    const args = buildCodexArgs({
      env, images, model: thread.model, effort: thread.effort, outputSchemaPath, threadId: thread.id, role,
    });
    logOrchestrator(
      logger,
      `starting ${role} ${phase}${thread.id ? ` on thread ${thread.id}` : " on a new thread"}`
        + ` with ${thread.model || "the Codex default model"}/${thread.effort || "default effort"}`,
      context,
    );

    const childArgs = cliPath === CODEX_CLI_PATH ? args : [cliPath, ...args.slice(1)];
    const child = spawn(nodePath, childArgs, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    let spawnError = null;
    let stdinError = null;
    let stdoutError = null;
    let stderrError = null;
    let timedOut = false;
    let forceKillTimer = null;
    let finalResponse = "";
    let turnCompleted = false;
    let turnFailure = "";
    let lastStreamError = "";
    let completedMcpCalls = 0;
    const stderrTail = [];

    child.once("error", (error) => { spawnError = error; });
    child.stdin.on("error", (error) => { stdinError = error; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timer.unref();

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    const stdoutTask = (async () => {
      try {
        for await (const line of stdout) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch (error) {
            throw new Error(`Codex emitted invalid JSONL: ${line}`, { cause: error });
          }
          if (event.type === "thread.started") thread.id = event.thread_id;
          if (event.type === "item.completed" && event.item?.type === "agent_message") {
            finalResponse = event.item.text;
          }
          if (event.type === "item.completed" && event.item?.type === "mcp_tool_call"
              && event.item.status === "completed") {
            completedMcpCalls += 1;
          }
          if (event.type === "item.completed" && event.item?.type === "error") {
            lastStreamError = event.item.message || "Codex item failed.";
          }
          if (event.type === "turn.completed") turnCompleted = true;
          if (event.type === "turn.failed") turnFailure = event.error?.message || "Codex turn failed.";
          if (event.type === "error") lastStreamError = event.message || "Codex stream error.";
          await emitCodexEvent(logger, context, thread.id, event);
        }
      } catch (error) {
        stdoutError = error;
        child.kill("SIGTERM");
      }
    })();
    const stderrTask = (async () => {
      try {
        for await (const line of stderr) {
          if (!line) continue;
          stderrTail.push(line);
          if (stderrTail.length > 20) stderrTail.shift();
          emitCodexStderr(logger, context, thread.id, line);
        }
      } catch (error) {
        stderrError = error;
        child.kill("SIGTERM");
      }
    })();
    const closeTask = new Promise((resolveClose) => {
      child.once("close", (code, signal) => resolveClose({ code, signal }));
    });

    child.stdin.end(prompt);
    const [{ code, signal }] = await Promise.all([closeTask, stdoutTask, stderrTask]);
    clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    stdout.close();
    stderr.close();

    const details = { completedMcpCalls, threadId: thread.id };
    if (timedOut) {
      throw makeAttemptError(`${role} ${phase} timed out.`, { ...details, retryable: false });
    }
    if (stdoutError) throw makeAttemptError(stdoutError.message, details);
    if (stderrError) throw makeAttemptError(`Could not read Codex stderr: ${stderrError.message}`, details);
    if (spawnError) throw makeAttemptError(`Could not start Codex CLI: ${spawnError.message}`, details);
    if (stdinError && code !== 0) throw makeAttemptError(`Could not send prompt to Codex CLI: ${stdinError.message}`, details);
    if (turnFailure) throw makeAttemptError(turnFailure, details);
    if (code !== 0 || signal) {
      const exit = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      const diagnosticLines = [lastStreamError, ...stderrTail].filter(Boolean);
      const diagnostic = diagnosticLines.length ? `\n${diagnosticLines.join("\n")}` : "";
      throw makeAttemptError(`Codex CLI exited with ${exit}.${diagnostic}`, details);
    }
    if (!thread.id) throw makeAttemptError(`${role} did not report a Codex thread id.`, { retryable: false });
    if (!turnCompleted) {
      throw makeAttemptError(lastStreamError || `${role} ended without a turn.completed event.`, details);
    }
    if (!finalResponse) {
      throw makeAttemptError(lastStreamError || `${role} completed without a final response.`, { ...details, retryable: false });
    }
    const result = parseStructured(finalResponse, role);
    const resultArtifact = logger?.completeTurn(context, thread, result);
    if (resultArtifact) console.log(`${eventPrefix(context)} file created: ${resultArtifact}`);
    return { thread, result };
  });
}

async function runCodex(options) {
  const deadline = Date.now() + options.timeoutMs;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 2_000;
  for (let retry = 0; ; retry += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw makeAttemptError(`${options.role} ${options.phase} timed out after ${options.timeoutMs / 60000} minutes.`, {
        retryable: false,
      });
    }
    const isRetry = retry > 0;
    try {
      return await runCodexAttempt({
        ...options,
        attempt: retry + 1,
        prompt: isRetry && options.thread.id
          ? (options.role === "reviewer" ? REVIEWER_CONTINUE_AFTER_TRANSPORT_FAILURE : CONTINUE_AFTER_TRANSPORT_FAILURE)
          : options.prompt,
        images: isRetry && options.role === "author" ? [] : options.images,
        timeoutMs: remainingMs,
      });
    } catch (error) {
      if (!error.retryable || retry >= options.transportRetries) throw error;
      const baseDelayMs = Math.min(30_000, retryBaseDelayMs * (2 ** retry));
      const delayMs = baseDelayMs + Math.floor((options.random?.() ?? Math.random()) * Math.min(1_000, baseDelayMs));
      const reason = String(error.message || error).split("\n", 1)[0];
      logOrchestrator(
        options.logger,
        `transient ${options.role} ${options.phase} transport failure: ${reason}; `
          + `retry ${retry + 1}/${options.transportRetries} in ${(delayMs / 1000).toFixed(1)}s`,
        { role: options.role, phase: options.phase, round: options.round, attempt: retry + 1 },
        "warn",
      );
      if (Date.now() + delayMs >= deadline) {
        throw makeAttemptError(
          `${options.role} ${options.phase} exhausted its ${options.timeoutMs / 60000}-minute deadline after: ${reason}`,
          { retryable: false },
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
    }
  }
}

let activeLogger = null;

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!statSync(opts.taskFolder).isDirectory()) throw new Error(`Not a directory: ${opts.taskFolder}`);
  const files = collectFiles(opts.taskFolder);
  if (!files.markdown.length) throw new Error("The task folder contains no Markdown descriptions.");
  if (!files.images.length) throw new Error("The task folder contains no PNG, JPEG, or WebP reference images.");
  console.log(`[orchestrator] task: ${opts.taskFolder}`);
  console.log(`[orchestrator] title: ${opts.title}`);
  console.log(`[orchestrator] descriptions: ${files.markdown.length}; references: ${files.images.length}`);
  console.log(`[orchestrator] acceptance: ${opts.minScore}/100; maximum rounds: ${opts.maxRounds}`);
  console.log(`[orchestrator] author models: ${opts.authorModels.join(" -> ") || "Codex default"}`);
  console.log(`[orchestrator] author efforts: ${opts.authorEfforts.join(" -> ")}`);
  console.log(`[orchestrator] reviewer models: ${opts.reviewerModels.join(" -> ") || "Codex default"}`);
  console.log(`[orchestrator] reviewer efforts: ${opts.reviewerEfforts.join(" -> ")}`);
  console.log(`[orchestrator] event log root: ${opts.logDir}`);
  if (opts.dryRun) return null;

  const logger = createRunLogger(opts.logDir, opts.title, opts.taskFolder);
  activeLogger = logger;
  const env = sanitizeEnvironment();
  logOrchestrator(logger, `event log: ${logger.path}`);
  logger.record({
    source: "orchestrator",
    event: {
      type: "run.started",
      taskFolder: opts.taskFolder,
      title: opts.title,
      markdownFiles: files.markdown.map((path) => relative(opts.taskFolder, path)),
      imageFiles: files.images.map((path) => relative(opts.taskFolder, path)),
      minScore: opts.minScore,
      maxRounds: opts.maxRounds,
      timeoutMinutes: opts.timeoutMinutes,
      transportRetries: opts.transportRetries,
      authorModels: opts.authorModels,
      authorEfforts: opts.authorEfforts,
      reviewerModels: opts.reviewerModels,
      reviewerEfforts: opts.reviewerEfforts,
      transport: "https",
    },
  });
  assertChatGptLogin(env, logger);
  const mcpProbe = await createMaterialMcpProbe(env);
  try {
    const brief = buildBrief(opts.taskFolder, files.markdown, files.images);
    const authorThread = { id: "", model: "", effort: "" };
    const reviewerThread = { id: "", model: "", effort: "" };
    let authorTurnIndex = 0;
    let reviewerTurnIndex = 0;
    let previousReview = null;
    const timeoutMs = opts.timeoutMinutes * 60_000;

    for (let round = 1; round <= opts.maxRounds; round += 1) {
    authorThread.model = modelForTurn(opts.authorModels, authorTurnIndex);
    authorThread.effort = modelForTurn(opts.authorEfforts, authorTurnIndex);
    authorTurnIndex += 1;
    const authorPhase = round === 1 ? "authoring" : "revision";
    const authorContext = { role: "author", phase: authorPhase, round };
    await requireMaterialMcp(mcpProbe, logger, `author ${authorPhase} round ${round}`);
    logOrchestrator(logger, `round ${round}/${opts.maxRounds}: authoring`, authorContext);
    const authorTurn = await runCodex({
      ...authorContext, thread: authorThread,
      prompt: round === 1 ? authorInitialPrompt(brief, opts.title, opts.minScore)
        : authorRevisionPrompt(round, previousReview, opts.minScore),
      images: round === 1 ? files.images : [], schema: AUTHOR_SCHEMA, timeoutMs,
      transportRetries: opts.transportRetries, env, logger,
    });
    logOrchestrator(
      logger,
      `author ${authorTurn.result.status}: ${authorTurn.result.summary}`,
      authorContext,
    );
    if (authorTurn.result.status === "blocked") throw new Error(`Author blocked: ${authorTurn.result.summary}`);
    if (!authorTurn.result.snapshotId) throw new Error(`Author round ${round} did not create a delivery snapshot.`);
    const deliveryErrors = logger.authorDeliveryErrors(authorContext, authorTurn.result);
    if (deliveryErrors.length) throw new Error(`Author round ${round} delivery invalid: ${deliveryErrors.join(" ")}`);
    const delivery = logger.delivery(authorContext);

    reviewerThread.id = "";
    reviewerThread.model = modelForTurn(opts.reviewerModels, reviewerTurnIndex);
    reviewerThread.effort = modelForTurn(opts.reviewerEfforts, reviewerTurnIndex);
    reviewerTurnIndex += 1;
    const reviewerContext = { role: "reviewer", phase: "review", round };
    await requireMaterialMcp(mcpProbe, logger, `reviewer round ${round}`);
    logOrchestrator(logger, `round ${round}/${opts.maxRounds}: independent visual review`, reviewerContext);
    const reviewerTurn = await runCodex({
      ...reviewerContext, thread: reviewerThread,
      prompt: round === 1 ? reviewerInitialPrompt(brief, opts.minScore)
        : reviewerNextPrompt(round, opts.minScore),
      images: [delivery.renderPath, ...files.images], schema: REVIEWER_SCHEMA, timeoutMs,
      transportRetries: opts.transportRetries, env, logger,
    });
    const reviewerPolicyErrors = logger.policyErrors(reviewerContext);
    if (reviewerPolicyErrors.length) throw new Error(reviewerPolicyErrors.join(" "));
    previousReview = reviewerTurn.result;
    const accepted = acceptedByGate(previousReview, opts.minScore);
    logOrchestrator(
      logger,
      `reviewer score=${previousReview.score} accepted=${previousReview.accepted} gate=${accepted}: ${previousReview.summary}`,
      reviewerContext,
    );
    for (const issue of previousReview.issues) {
      logOrchestrator(
        logger,
        `reviewer ${issue.priority}: ${issue.observation} Requested: ${issue.requestedChange}`,
        reviewerContext,
      );
    }
    for (const change of previousReview.requiredChanges) {
      logOrchestrator(logger, `reviewer required: ${change}`, reviewerContext);
    }
    if (!accepted) continue;

    logOrchestrator(logger, "reviewer accepted; saving the live MCP document", { round, phase: "save" });
    authorThread.model = modelForTurn(opts.authorModels, authorTurnIndex);
    authorThread.effort = modelForTurn(opts.authorEfforts, authorTurnIndex);
    authorTurnIndex += 1;
    await requireMaterialMcp(mcpProbe, logger, `author save round ${round}`);
    const saveTurn = await runCodex({
      role: "author", phase: "save", round, thread: authorThread,
      prompt: savePrompt(opts.title, round, previousReview),
      images: [], schema: SAVE_SCHEMA, timeoutMs, transportRetries: opts.transportRetries, env, logger,
    });
    if (saveTurn.result.status !== "saved" || !saveTurn.result.savedVersionId) {
      throw new Error(`Accepted document was not saved: ${saveTurn.result.summary}`);
    }
    const summary = {
      status: "saved", title: opts.title, savedVersionId: saveTurn.result.savedVersionId,
      rounds: round, reviewerScore: previousReview.score, eventLog: logger.path,
    };
    logger.record({ source: "orchestrator", event: { type: "run.completed", ...summary } });
    logOrchestrator(
      logger,
      `saved ${summary.title} as ${summary.savedVersionId} after ${summary.rounds} round(s), reviewer score ${summary.reviewerScore}`,
    );
    return summary;
    }
    throw new Error(`Reviewer did not accept within ${opts.maxRounds} rounds. The live draft was not saved.`);
  } finally {
    await mcpProbe.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    activeLogger?.record({
      source: "orchestrator",
      level: "error",
      event: { type: "run.failed", message: error.message, stack: error.stack || "" },
    });
    console.error(`[orchestrator] ${truncateStatus(error.message, 900)}`);
    if (activeLogger) console.error(`[orchestrator] event log: ${activeLogger.path}`);
    process.exitCode = 1;
  });
}

export {
  AUTHOR_SCHEMA,
  CODEX_PROVIDER_ID,
  CONTINUE_AFTER_TRANSPORT_FAILURE,
  REVIEWER_SCHEMA,
  SAVE_SCHEMA,
  acceptedByGate,
  buildCodexArgs,
  compactOutput,
  createMaterialMcpProbe,
  createRunLogger,
  main,
  modelForTurn,
  parseArgs,
  runCodex,
  runCodexAttempt,
  sanitizeEnvironment,
};

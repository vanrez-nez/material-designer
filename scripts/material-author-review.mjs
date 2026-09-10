#!/usr/bin/env node

import { Codex } from "@openai/codex-sdk";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const CODEX_CLI_PATH = join(dirname(require.resolve("@openai/codex/package.json")), "bin", "codex.js");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUTHOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["revised", "saved", "blocked"] },
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
        standardScale1: { type: "boolean" },
        standardScale2: { type: "boolean" },
        standardScale4: { type: "boolean" },
        normalsScale2: { type: "boolean" },
        roughnessChannel: { type: "boolean" },
      },
      required: ["standardScale1", "standardScale2", "standardScale4", "normalsScale2", "roughnessChannel"],
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
const SAVE_VERIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verified: { type: "boolean" },
    savedVersionId: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
  },
  required: ["verified", "savedVersionId", "title", "summary"],
};

function usage() {
  console.log(`
Usage:
  npm run material:author-review -- <task-folder> [options]

The folder is read recursively. Markdown files form the brief and PNG/JPEG/WebP
files are attached to both agents. Agent work is MCP-only and creates no job
artifacts in the repository.

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
  --author-model <model>      Optional model override for Agent 1
  --reviewer-model <model>    Optional model override for Agent 2
  --dry-run                   Validate inputs and print the execution plan only
  --help                      Show this help

Example:
  npm run material:author-review -- /path/to/rusty-copper --title "Rusty Copper"
`);
}

function parseArgs(argv) {
  const opts = {
    taskFolder: "", title: "", maxRounds: 8, minScore: 85, timeoutMinutes: 30,
    transportRetries: 4, authorModel: "", reviewerModel: "", dryRun: false,
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
    else if (arg === "--author-model") opts.authorModel = value();
    else if (arg === "--reviewer-model") opts.reviewerModel = value();
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
  opts.title ||= basename(opts.taskFolder);
  return opts;
}

function collectFiles(folder, result = { markdown: [], images: [] }) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
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
- Preserve seamless tiling. Avoid obvious procedural regularity, implausible scale, clipped values, and details that contradict the references.
- Before finishing, call regenerate and inspect fresh get_render output at standard profile and multiple scales. Inspect useful channels and repair obvious defects yourself.
- The acceptance bar is ${minScore}/100; a merely valid graph is insufficient.

The eventual library title is ${JSON.stringify(title)}.

${brief}

Author the live MCP document now. Return status "revised", a concise summary, and an empty savedVersionId. Return "blocked" only if the MCP remains unavailable after retrying.`;
}

function authorRevisionPrompt(round, review, minScore) {
  return `Agent 2 rejected round ${round - 1}. Revise the same live MCP document to address this report:

${JSON.stringify(review, null, 2)}

Use only material-designer MCP calls. Do not write files or save a version. Inspect the live document, make substantive MCP edits for every required change, regenerate, and inspect fresh renderer output at multiple scales. The acceptance bar is ${minScore}/100. Return status "revised", a concise summary, and an empty savedVersionId; use "blocked" only for a genuine MCP failure.`;
}

function reviewerInitialPrompt(brief, minScore) {
  return `You are Agent 2, the independent material quality reviewer. Evaluate the live Material Designer document against the task and attached references.

Boundaries and review contract:
- Use only read-only material-designer MCP tools. Never mutate, snapshot, restore, regenerate, or save.
- Do not use shell commands, filesystem artifacts, browser screenshots, browser automation, or any other MCP.
- Every turn, inspect fresh get_render results for standard profile at scales 1, 2, and 4, plus normals at scale 2. Inspect roughness with get_channel_texture. Use get_document or list_nodes for PBR completeness.
- The page reconnects when an agent turn starts. If the first MCP call says no tab is connected, retry after the bridge reconnects; do not substitute another renderer.
- Compare identity, structure, scale, palette/value range, roughness, relief/normals, tiling seams, repetition, artifacts, and reference-specific details.
- Accept only if production-worthy within the existing node vocabulary, at least ${minScore}/100, with no blocker/major issue and no required change.
- Set evidence true only when its MCP call succeeded this turn. On rejection, give concrete graph/parameter feedback Agent 1 can execute.

${brief}

Review the live candidate and return only the required structured verdict.`;
}

function reviewerNextPrompt(round, authorReport, minScore) {
  return `Review round ${round} of the live candidate. Agent 1 reports:\n${JSON.stringify(authorReport, null, 2)}

Repeat the full independent material-designer MCP inspection: fresh standard get_render at scales 1, 2, and 4; normals at scale 2; roughness get_channel_texture; and graph inspection. If the page has not reconnected on the first call, retry rather than using another renderer. Do not mutate, regenerate, save, use the filesystem, or use another renderer. Accept only at ${minScore}/100 or higher, with all evidence true, no blocker/major issue, and no required changes. Return only the structured verdict.`;
}

function savePrompt(title, round, review) {
  return `Agent 2 accepted round ${round}. Make the accepted live document the sole final job artifact.

Use only material-designer MCP. Call get_document to confirm the live document, then save_version with title ${JSON.stringify(title)} and overwrite false. Call list_versions and verify the saved id is present. If this instruction is resumed after a transport failure and you already saved the accepted document, do not save a duplicate; recover and report the previously returned id from this conversation and verify it with list_versions. Do not edit the graph or write any file.

Accepted review:\n${JSON.stringify(review, null, 2)}

Return status "saved", a concise summary, and the exact library id in savedVersionId. On failure return "blocked" with an empty id.`;
}

function saveVerificationPrompt(title, savedVersionId) {
  return `Agent 1 reports that the accepted document was saved to the Material Designer MCP library.

Use only the read-only material-designer list_versions tool. Confirm that version id ${JSON.stringify(savedVersionId)} is present with title ${JSON.stringify(title)}. Do not mutate, render, regenerate, restore, snapshot, or save anything. If the page is still reconnecting, retry the MCP call.

Return verified true only for an exact id and title match. Echo the matched id and title; otherwise use empty strings and explain the failure.`;
}

function parseStructured(raw, label) {
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`${label} did not return valid structured JSON: ${error.message}\n${raw}`); }
}

function acceptedByGate(review, minScore) {
  const evidence = Object.values(review.evidence ?? {});
  const serious = review.issues.some((issue) => issue.priority === "blocker" || issue.priority === "major");
  return review.accepted && review.score >= minScore && evidence.length === 5 && evidence.every(Boolean)
    && !serious && review.requiredChanges.length === 0;
}

function assertChatGptLogin() {
  const result = spawnSync(process.execPath, [CODEX_CLI_PATH, "login", "status"], {
    encoding: "utf8",
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
  console.log("[orchestrator] authentication: ChatGPT subscription");
}

function createThread(codex, model) {
  return codex.startThread({
    model: model || undefined,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    workingDirectory: ROOT,
    skipGitRepoCheck: true,
  });
}

function createChatGptCodex() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => (
      value !== undefined && key !== "OPENAI_API_KEY" && key !== "CODEX_API_KEY"
    )),
  );
  return new Codex({ env });
}

async function runCodexAttempt({ role, thread, prompt, images, schema, timeoutMs }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();

  const input = images.length
    ? [{ type: "text", text: prompt }, ...images.map((path) => ({ type: "local_image", path }))]
    : prompt;

  console.log(`[orchestrator] starting ${role}${thread.id ? ` thread ${thread.id}` : ""}`);
  try {
    const { events } = await thread.runStreamed(input, { outputSchema: schema, signal: controller.signal });
    let finalResponse = "";
    let streamError = "";
    for await (const event of events) {
      if (event.type === "item.started" && event.item.type === "mcp_tool_call") {
        console.log(`[${role}] calling ${event.item.server}.${event.item.tool}`);
      } else if (event.type === "item.completed" && event.item.type === "mcp_tool_call") {
        console.log(`[${role}] ${event.item.server}.${event.item.tool}: ${event.item.status}`);
      } else if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      } else if (event.type === "item.completed" && event.item.type === "error") {
        console.error(`[${role}] ${event.item.message}`);
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "error") {
        streamError = event.message;
        console.error(`[${role}] ${event.message}`);
      }
    }
    if (!thread.id) throw new Error(`${role} did not report a Codex thread id.`);
    if (!finalResponse) throw new Error(streamError || `${role} completed without a final response.`);
    return { thread, result: parseStructured(finalResponse, role) };
  } catch (error) {
    if (timedOut) throw new Error(`${role} timed out after ${timeoutMs / 60000} minutes.`);
    error.retryable = /\b(?:429|500|502|503|504)\b|service unavailable|server_is_overloaded|temporarily overloaded|failed to connect to websocket|connection reset/i.test(error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runCodex(options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runCodexAttempt(options);
    } catch (error) {
      if (!error.retryable || attempt >= options.transportRetries) throw error;
      const baseDelayMs = Math.min(30_000, 2_000 * (2 ** attempt));
      const delayMs = baseDelayMs + Math.floor(Math.random() * 1_000);
      const reason = String(error.message || error).split("\n", 1)[0];
      console.warn(
        `[orchestrator] transient ${options.role} transport failure: ${reason}; `
        + `retry ${attempt + 1}/${options.transportRetries} in ${(delayMs / 1000).toFixed(1)}s`,
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!statSync(opts.taskFolder).isDirectory()) throw new Error(`Not a directory: ${opts.taskFolder}`);
  const files = collectFiles(opts.taskFolder);
  if (!files.markdown.length) throw new Error("The task folder contains no Markdown descriptions.");
  if (!files.images.length) throw new Error("The task folder contains no PNG, JPEG, or WebP reference images.");
  console.log(`[orchestrator] task: ${opts.taskFolder}`);
  console.log(`[orchestrator] title: ${opts.title}`);
  console.log(`[orchestrator] descriptions: ${files.markdown.length}; references: ${files.images.length}`);
  console.log(`[orchestrator] acceptance: ${opts.minScore}/100; maximum rounds: ${opts.maxRounds}`);
  if (opts.dryRun) return;

  assertChatGptLogin();
  const brief = buildBrief(opts.taskFolder, files.markdown, files.images);
  const codex = createChatGptCodex();
  const authorThread = createThread(codex, opts.authorModel);
  const reviewerThread = createThread(codex, opts.reviewerModel);
  let previousReview = null;
  const timeoutMs = opts.timeoutMinutes * 60_000;

  for (let round = 1; round <= opts.maxRounds; round += 1) {
    console.log(`\n[orchestrator] round ${round}/${opts.maxRounds}: authoring`);
    const authorTurn = await runCodex({
      role: "author", thread: authorThread,
      prompt: round === 1 ? authorInitialPrompt(brief, opts.title, opts.minScore)
        : authorRevisionPrompt(round, previousReview, opts.minScore),
      images: round === 1 ? files.images : [], schema: AUTHOR_SCHEMA, timeoutMs,
      transportRetries: opts.transportRetries,
    });
    console.log(`[author] ${authorTurn.result.status}: ${authorTurn.result.summary}`);
    if (authorTurn.result.status === "blocked") throw new Error(`Author blocked: ${authorTurn.result.summary}`);

    console.log(`[orchestrator] round ${round}/${opts.maxRounds}: independent review`);
    const reviewerTurn = await runCodex({
      role: "reviewer", thread: reviewerThread,
      prompt: round === 1 ? reviewerInitialPrompt(brief, opts.minScore)
        : reviewerNextPrompt(round, authorTurn.result, opts.minScore),
      images: round === 1 ? files.images : [], schema: REVIEWER_SCHEMA, timeoutMs,
      transportRetries: opts.transportRetries,
    });
    previousReview = reviewerTurn.result;
    const accepted = acceptedByGate(previousReview, opts.minScore);
    console.log(`[reviewer] score=${previousReview.score} accepted=${previousReview.accepted} gate=${accepted}`);
    console.log(`[reviewer] ${previousReview.summary}`);
    for (const change of previousReview.requiredChanges) console.log(`[reviewer] required: ${change}`);
    if (!accepted) continue;

    console.log("[orchestrator] reviewer accepted; saving the live MCP document");
    const saveTurn = await runCodex({
      role: "author", thread: authorThread, prompt: savePrompt(opts.title, round, previousReview),
      images: [], schema: AUTHOR_SCHEMA, timeoutMs, transportRetries: opts.transportRetries,
    });
    if (saveTurn.result.status !== "saved" || !saveTurn.result.savedVersionId) {
      throw new Error(`Accepted document was not saved: ${saveTurn.result.summary}`);
    }
    const verificationTurn = await runCodex({
      role: "reviewer", thread: reviewerThread,
      prompt: saveVerificationPrompt(opts.title, saveTurn.result.savedVersionId),
      images: [], schema: SAVE_VERIFICATION_SCHEMA, timeoutMs, transportRetries: opts.transportRetries,
    });
    const verification = verificationTurn.result;
    if (!verification.verified || verification.savedVersionId !== saveTurn.result.savedVersionId
        || verification.title !== opts.title) {
      throw new Error(`Reviewer could not verify the saved MCP version: ${verification.summary}`);
    }
    console.log(JSON.stringify({
      status: "saved", title: opts.title, savedVersionId: saveTurn.result.savedVersionId,
      rounds: round, reviewerScore: previousReview.score,
    }, null, 2));
    return;
  }
  throw new Error(`Reviewer did not accept within ${opts.maxRounds} rounds. The live draft was not saved.`);
}

main().catch((error) => {
  console.error(`[orchestrator] ${error.stack || error.message}`);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTHOR_SCHEMA,
  CONTINUE_AFTER_TRANSPORT_FAILURE,
  buildCodexArgs,
  compactOutput,
  createRunLogger,
  diffableNodeIds,
  runCodex,
  runCodexAttempt,
  sanitizeEnvironment,
} from "./material-author-review.mjs";

function silenceConsole(callback) {
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  return Promise.resolve()
    .then(callback)
    .finally(() => Object.assign(console, original));
}

function writeFakeCli(directory, source) {
  const path = join(directory, "fake-codex.mjs");
  writeFileSync(path, source, { mode: 0o700 });
  return path;
}

test("sanitized child environment keeps MCP settings but removes parent auth and session state", () => {
  assert.deepEqual(sanitizeEnvironment({
    PATH: "/bin",
    MD_WS_PORT: "6000",
    OPENAI_API_KEY: "sk-secret",
    CODEX_API_KEY: "secret",
    CODEX_SESSION_ID: "parent-session",
    CODEX_THREAD_ID: "parent-thread",
  }), {
    PATH: "/bin",
    MD_WS_PORT: "6000",
  });
});

test("Codex invocation is self-contained and forces ChatGPT Responses over HTTPS", () => {
  const args = buildCodexArgs({
    env: { MD_WS_PORT: "6000" },
    images: ["/tmp/reference.png"],
    model: "test-model",
    effort: "high",
    outputSchemaPath: "/tmp/schema.json",
    threadId: "thread-123",
  });
  const joined = args.join("\n");

  assert.deepEqual(args.slice(1, 3), ["exec", "resume"]);
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--strict-config"));
  assert.match(joined, /base_url="https:\/\/chatgpt\.com\/backend-api\/codex"/);
  assert.match(joined, /supports_websockets=false/);
  assert.match(joined, /requires_openai_auth=true/);
  assert.match(joined, /model_reasoning_effort="high"/);
  assert.match(joined, /mcp_servers\.material-designer\.required=true/);
  assert.match(joined, /mcp_servers\.material-designer\.default_tools_approval_mode="approve"/);
  assert.match(joined, /features\.view_image=false/);
  assert.doesNotMatch(joined, /\btools\./);
  assert.ok(args.includes("thread-123"));
  assert.equal(args.at(-1), "-");

  const reviewerArgs = buildCodexArgs({
    env: {}, images: ["/tmp/render.png"], model: "test-reviewer", effort: "high",
    outputSchemaPath: "/tmp/reviewer-schema.json", threadId: "", role: "reviewer",
  }).join("\n");
  assert.doesNotMatch(reviewerArgs, /mcp_servers\.material-designer/);
  assert.match(reviewerArgs, /sandbox_mode="read-only"/);
});

test("event output compacts binary payloads and redacts secret-shaped fields", () => {
  const compacted = compactOutput({
    type: "image",
    mimeType: "image/png",
    data: "aGVsbG8=",
    accessToken: "do-not-log",
    nested: { url: "data:image/webp;base64,aGVsbG8=" },
  });

  assert.deepEqual(compacted.data, {
    compacted: "base64",
    mimeType: "image/png",
    encodedCharacters: 8,
    approximateBytes: 5,
  });
  assert.equal(compacted.accessToken, "[redacted]");
  assert.deepEqual(compacted.nested.url, {
    compacted: "base64",
    mimeType: "image/webp",
    encodedCharacters: 8,
    approximateBytes: 5,
  });
});

test("run logger writes private, sequenced JSONL with compacted tool output", () => {
  const root = mkdtempSync(join(tmpdir(), "material-author-review-log-test-"));
  const logger = createRunLogger(root, "Cast Iron", root, new Date("2026-09-10T12:34:56.000Z"));
  logger.record({ source: "codex", event: { type: "image", mimeType: "image/png", data: "aGVsbG8=" } });
  logger.record({ source: "orchestrator", message: "done" });

  const entries = readFileSync(logger.path, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2]);
  assert.equal(entries[0].event.data.compacted, "base64");
  assert.equal(statSync(logger.path).mode & 0o777, 0o600);
});

test("a completed turn survives an earlier stream error and logs every event", async () => {
  const root = mkdtempSync(join(tmpdir(), "material-author-review-success-test-"));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const fakeCli = writeFakeCli(root, `
    process.stdin.resume();
    process.stdin.on("end", () => {
      console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-success" }));
      console.log(JSON.stringify({ type: "error", message: "temporary 503" }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "mcp_tool_call", tool: "get_render", status: "completed",
        arguments: { nodeId: "node-a", view: "difference", size: 1024, maxDim: 1024, profile: "standard", scale: 1 },
        result: { content: [{ type: "image", mimeType: "image/png", data: ${JSON.stringify(png)} }]
        }
      } }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "mcp_tool_call", tool: "get_render", status: "completed",
        arguments: { size: 1024, maxDim: 1024, profile: "standard", scale: 1 },
        result: { content: [{ type: "image", mimeType: "image/png", data: ${JSON.stringify(png)} }]
        }
      } }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "mcp_tool_call", tool: "create_snapshot", status: "completed", result: {
          content: [{ type: "text", text: JSON.stringify({ id: "snapshot-1", label: "Author delivery round 1", timestamp: 1 }) }]
        }
      } }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "mcp_tool_call", tool: "get_document", status: "completed", result: {
          content: [{ type: "text", text: JSON.stringify({ nodes: [
            { id: "node-a", type: "tileable-noise" },
            { id: "shader", type: "principled-bsdf" },
            { id: "output", type: "material-output" }
          ], edges: [] }) }]
        }
      } }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "agent_message", text: ${JSON.stringify(JSON.stringify({ status: "revised", summary: "complete", savedVersionId: "", snapshotId: "snapshot-1", nodeCount: 3, contributionChecks: 1 }))}
      } }));
      console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
    });
  `);
  const logger = createRunLogger(root, "success", root);
  const thread = { id: "", model: "" };

  const turn = await silenceConsole(() => runCodexAttempt({
    role: "author",
    phase: "authoring",
    round: 1,
    attempt: 1,
    thread,
    prompt: "author",
    images: [],
    schema: AUTHOR_SCHEMA,
    timeoutMs: 5_000,
    env: process.env,
    logger,
    cliPath: fakeCli,
  }));

  assert.equal(turn.thread.id, "thread-success");
  assert.equal(turn.result.status, "revised");
  const log = readFileSync(logger.path, "utf8");
  assert.match(log, /"type":"error","message":"temporary 503"/);
  assert.match(log, /"compacted":"base64"/);
  assert.equal(log.includes(png), false);
  const turnDirectory = join(logger.directory, "round-01", "author-authoring");
  assert.ok(existsSync(join(turnDirectory, "diffs", "lit-diff-node-a.png")));
  assert.ok(existsSync(join(turnDirectory, "evidence.jsonl")));
  assert.ok(existsSync(join(turnDirectory, "result.json")));
  const deliveryDirectory = join(root, "snapshot", "round-01");
  assert.ok(existsSync(join(deliveryDirectory, "render.png")));
  assert.ok(existsSync(join(deliveryDirectory, "snapshot.json")));
  assert.ok(existsSync(join(deliveryDirectory, "document.json")));
  assert.equal(logger.hasAuthorDelivery(
    { role: "author", phase: "authoring", round: 1 },
    { snapshotId: "snapshot-1", nodeCount: 3, contributionChecks: 1 },
  ), true);
});

test("diffable node IDs exclude shader and output nodes", () => {
  assert.deepEqual(diffableNodeIds({ nodes: [
    { id: "noise", type: "tileable-noise" },
    { id: "shader", type: "principled-bsdf" },
    { id: "output", type: "material-output" },
  ] }), ["noise"]);
});

test("terminal transport retry resumes the captured thread with a continuation prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "material-author-review-retry-test-"));
  const statePath = join(root, "state.json");
  const fakeCli = writeFakeCli(root, `
    import { existsSync, readFileSync, writeFileSync } from "node:fs";
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const statePath = process.env.FAKE_CODEX_STATE_PATH;
      const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { attempts: [] };
      previous.attempts.push({ argv: process.argv.slice(2), input });
      writeFileSync(statePath, JSON.stringify(previous));
      if (previous.attempts.length === 1) {
        console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-retry" }));
        console.log(JSON.stringify({ type: "error", message: "unexpected status 503 Service Unavailable" }));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-retry" }));
      console.log(JSON.stringify({ type: "item.completed", item: {
        type: "agent_message", text: ${JSON.stringify(JSON.stringify({ status: "revised", summary: "resumed", savedVersionId: "" }))}
      } }));
      console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
    });
  `);
  const logger = createRunLogger(root, "retry", root);
  const thread = { id: "", model: "" };

  const turn = await silenceConsole(() => runCodex({
    role: "author",
    phase: "authoring",
    round: 1,
    thread,
    prompt: "initial prompt",
    images: [],
    schema: AUTHOR_SCHEMA,
    timeoutMs: 5_000,
    transportRetries: 1,
    retryBaseDelayMs: 1,
    random: () => 0,
    env: { ...process.env, FAKE_CODEX_STATE_PATH: statePath },
    logger,
    cliPath: fakeCli,
  }));

  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(turn.result.summary, "resumed");
  assert.equal(state.attempts.length, 2);
  assert.equal(state.attempts[0].input, "initial prompt");
  assert.equal(state.attempts[1].input, CONTINUE_AFTER_TRANSPORT_FAILURE);
  assert.deepEqual(state.attempts[1].argv.slice(0, 2), ["exec", "resume"]);
  assert.ok(state.attempts[1].argv.includes("thread-retry"));
});

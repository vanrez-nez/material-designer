#!/usr/bin/env node

// Material Designer MCP server (dev + local). Bridges an MCP client (Claude) to the running dev app at
// http://material-designer.localhost. The app's in-page bridge (src/debug/mcp-bridge.ts) connects OUTBOUND
// to the WebSocket this server hosts; each MCP tool call is relayed to the page over that socket and its
// JSON (or image) result returned. Safety (auto-snapshot before mutations, validation, undeletable output)
// is enforced in the page, not here — this server is a thin relay.
//
// IMPORTANT: stdout carries the MCP JSON-RPC protocol. All logging MUST go to stderr (console.error).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { WebSocketServer, WebSocket } from "ws";

const WS_HOST = "127.0.0.1";
const WS_PORT = Number.parseInt(process.env.MD_WS_PORT || "51787", 10);
const WS_PORT_SPAN = Number.parseInt(process.env.MD_WS_PORT_SPAN || "16", 10);
const CALL_TIMEOUT_MS = Number.parseInt(process.env.MD_CALL_TIMEOUT_MS || "20000", 10);
const COMPACT_IMAGE_RESPONSES = process.env.MD_MCP_COMPACT_IMAGES === "1";
const IMAGE_ARTIFACT_DIR = process.env.MD_MCP_IMAGE_ARTIFACT_DIR || "";
const CONTRIBUTION_AUDIT_BATCH_LIMIT = 8;

// ---------------------------------------------------------------------------------------------------------
// WebSocket bridge to the page
// ---------------------------------------------------------------------------------------------------------

/** @type {WebSocket | null} the most-recently-connected app tab ("last connection wins") */
let page = null;
let nextId = 1;
/** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void, timer:NodeJS.Timeout}>} */
const pending = new Map();

async function listenOnAvailablePort() {
  for (let offset = 0; offset < WS_PORT_SPAN; offset += 1) {
    const port = WS_PORT + offset;
    const candidate = new WebSocketServer({ host: WS_HOST, port });
    const error = await new Promise((resolve) => {
      candidate.once("listening", () => resolve(null));
      candidate.once("error", resolve);
    });
    if (!error) return { wss: candidate, port };
    try { candidate.close(); } catch { /* The failed listener may already be closed. */ }
    if (error.code !== "EADDRINUSE") throw error;
  }
  throw new Error(`No free Material Designer bridge port in ${WS_PORT}-${WS_PORT + WS_PORT_SPAN - 1}.`);
}

const { wss, port: activeWsPort } = await listenOnAvailablePort();
console.error(`[mcp] WebSocket bridge listening on ws://${WS_HOST}:${activeWsPort}`);
console.error("[mcp] open http://material-designer.localhost (dev) so the page connects.");

wss.on("error", (err) => {
  console.error(`[mcp] WebSocket server error: ${err?.message ?? err}`);
});

wss.on("connection", (ws) => {
  page = ws;
  console.error("[mcp] app tab connected");

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return; // ignore non-JSON frames
    }
    if (msg && msg.hello) {
      console.error(`[mcp] hello from ${msg.app} (docVersion ${msg.docVersion})`);
      return;
    }
    if (typeof msg?.id !== "number") return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error?.message || "page returned an error"));
  });

  ws.on("close", () => {
    if (page === ws) {
      page = null;
      console.error("[mcp] app tab disconnected");
    }
  });

  ws.on("error", (err) => console.error(`[mcp] socket error: ${err?.message ?? err}`));
});

/** Send an RPC to the connected page and await its result. */
function callPage(method, params) {
  return new Promise((resolve, reject) => {
    if (!page || page.readyState !== WebSocket.OPEN) {
      reject(
        new Error(
          "No Material Designer tab connected — open http://material-designer.localhost (dev) so the bridge connects.",
        ),
      );
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out after ${CALL_TIMEOUT_MS}ms waiting for the app to respond to "${method}".`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    page.send(JSON.stringify({ id, method, params }));
  });
}

// ---------------------------------------------------------------------------------------------------------
// Tool definitions (JSON Schema). Each maps 1:1 to a page RPC method.
// ---------------------------------------------------------------------------------------------------------

const OBJ = (properties = {}, required = []) => ({ type: "object", properties, required });
const edgeProps = {
  fromNode: { type: "string", description: "source node id" },
  fromOutput: { type: "string", description: "source output port key" },
  toNode: { type: "string", description: "target node id" },
  toInput: { type: "string", description: "target input port key" },
};

const tools = [
  { name: "get_document", description: "Get the full live MaterialGraphDocument (nodes, edges, metadata).", inputSchema: OBJ() },
  { name: "list_nodes", description: "List the live graph's nodes (id, type, label, params) and edges.", inputSchema: OBJ() },
  { name: "get_registry", description: "List all available node types with their ports and param definitions (key, type, default, min/max, options).", inputSchema: OBJ() },

  {
    name: "add_node",
    description: "Add a node of the given type. Auto-snapshots first. Returns the new node id.",
    inputSchema: OBJ(
      {
        type: { type: "string", description: "registry node type (see get_registry)" },
        position: OBJ({ x: { type: "number" }, y: { type: "number" } }),
      },
      ["type"],
    ),
  },
  {
    name: "remove_node",
    description: "Remove a node by id. Auto-snapshots first. Rejects required output/boundary nodes.",
    inputSchema: OBJ({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "set_param",
    description: "Set a node param value. Auto-snapshots first.",
    inputSchema: OBJ(
      { nodeId: { type: "string" }, key: { type: "string" }, value: { description: "new value (type per get_registry)" } },
      ["nodeId", "key", "value"],
    ),
  },
  {
    name: "set_label",
    description: "Set a node's display label (the name shown on the node in the editor). Pass an empty label to clear it back to the node's type name. Auto-snapshots first.",
    inputSchema: OBJ(
      { nodeId: { type: "string" }, label: { type: "string", description: "display name; empty string clears it" } },
      ["nodeId", "label"],
    ),
  },
  { name: "connect_edge", description: "Connect two ports. Auto-snapshots first. Fails on incompatible port kinds.", inputSchema: OBJ(edgeProps, ["fromNode", "fromOutput", "toNode", "toInput"]) },
  { name: "disconnect_edge", description: "Remove an edge. Auto-snapshots first.", inputSchema: OBJ(edgeProps, ["fromNode", "fromOutput", "toNode", "toInput"]) },
  {
    name: "load_document",
    description: "Replace the whole graph with a supplied MaterialGraphDocument. Migrated + compile-validated before commit; auto-snapshots first. Pass dryRun to preview the diff without applying.",
    inputSchema: OBJ(
      { document: { type: "object" }, title: { type: "string" }, dryRun: { type: "boolean" } },
      ["document"],
    ),
  },
  {
    name: "set_output_resolution",
    description: "Set the Material Output resolution (px, rounded to a multiple of 64) used by bakes/renders. Auto-snapshots first.",
    inputSchema: OBJ({ size: { type: "number" } }, ["size"]),
  },

  { name: "list_snapshots", description: "List safety snapshots (auto-taken before each mutation, plus manual ones), newest first.", inputSchema: OBJ() },
  { name: "create_snapshot", description: "Take a manual named snapshot of the current document.", inputSchema: OBJ({ label: { type: "string" } }) },
  { name: "restore_snapshot", description: "Restore a snapshot by id. Snapshots the current state first, so restore is itself reversible.", inputSchema: OBJ({ id: { type: "string" } }, ["id"]) },

  { name: "save_version", description: "Save the current document as a library entry (a saved version). Pass overwrite:true to update the active entry instead of creating a new one.", inputSchema: OBJ({ title: { type: "string" }, overwrite: { type: "boolean" } }) },
  { name: "list_versions", description: "List saved document-library versions (id, title, updatedAt), newest first.", inputSchema: OBJ() },

  {
    name: "get_channel_texture",
    description: "Render a baked PBR channel to an LLM-optimized PNG. channel: baseColor|roughness|metallic|ambientOcclusion|normal|emission. Optional crop {x,y,w,h} (normalized 0..1) magnifies a region.",
    inputSchema: OBJ(
      {
        channel: { type: "string" },
        size: { type: "number", description: "bake size px (multiple of 64), default 512" },
        maxDim: { type: "number", description: "longest output side, default 768" },
        crop: OBJ({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }),
      },
      ["channel"],
    ),
  },
  {
    name: "get_render",
    description: "Render the current material or an ephemeral node-contribution view. nodeId alone matches the graph eye; view: solo|solo-vs-full|without-node-vs-full|difference. Comparisons use left=variant, right=full. difference is the absolute pixel difference between the full graph and the graph without the node (black=identical), with an in-image stats panel and machine-readable MCP text stats. channel selects a raw final-PBR view for without-node-vs-full or difference. The live document and its isolation setting are never changed.",
    inputSchema: OBJ({
      size: { type: "number", description: "render size px, default 768" },
      scale: { type: "number", description: "UV tiling factor, default 1" },
      profile: { type: "string", description: "lighting profile, default standard" },
      maxDim: { type: "number", description: "longest output side, default 768" },
      nodeId: { type: "string", description: "node to preview/compare; when supplied without view, defaults to solo" },
      view: {
        type: "string",
        enum: ["solo", "solo-vs-full", "without-node-vs-full", "difference"],
        description: "ephemeral node render layout; requires nodeId",
      },
      channel: {
        type: "string",
        enum: ["baseColor", "normal", "emission", "roughness", "metallic", "ambientOcclusion"],
        description: "lossless raw PBR channel on geometry; valid with without-node-vs-full or difference",
      },
    }),
  },
  {
    name: "audit_node_contributions",
    description: "Batch-check up to 8 data nodes with 1024px difference renders. The runner archives each lossless PNG, while the MCP response returns only compact numeric difference statistics so images do not accumulate in the agent context. Use repeated batches to audit a complete graph; retry zero results at scale 2 or on the relevant final PBR channel.",
    inputSchema: OBJ(
      {
        nodeIds: {
          type: "array",
          minItems: 1,
          maxItems: CONTRIBUTION_AUDIT_BATCH_LIMIT,
          uniqueItems: true,
          items: { type: "string" },
          description: "1-8 diff-capable data node ids",
        },
        scale: { type: "number", description: "UV tiling factor, default 1" },
        profile: { type: "string", description: "lighting profile, default standard" },
        channel: {
          type: "string",
          enum: ["baseColor", "normal", "emission", "roughness", "metallic", "ambientOcclusion"],
          description: "optional raw final-PBR channel",
        },
      },
      ["nodeIds"],
    ),
  },
  {
    name: "get_viewport",
    description: "Capture the live on-screen viewport (current camera + lighting) as an LLM-optimized image.",
    inputSchema: OBJ({
      size: { type: "number", description: "capture size px, default 768" },
      maxDim: { type: "number", description: "longest output side, default 768" },
    }),
  },
  {
    name: "gpu_info",
    description:
      "GPU-residency report: renderer live-texture/geometry counts plus every bake cache container's size (channel targets, decomposition caches, bake materials, scratch pools). Flat across regenerate cycles = caches released.",
    inputSchema: OBJ({}),
  },
  {
    name: "regenerate",
    description:
      "Full Regenerate: flush ALL baked GPU state (decomposition caches + bake materials), recompile and re-bake, awaited to completion. Returns {before, after} gpu_info payloads so cache growth/leaks show in one call.",
    inputSchema: OBJ({}),
  },
  {
    name: "profile_nodes",
    description:
      "Profile measured per-output node-local costs. Each output compares an independently cache-busted isolated real node with a matched neutral baseline; compile and timestamp-query GPU deltas are returned separately from real ancestor-subtree totals. Results also calculate selected-kernel primitive counts and isolated-vs-baseline fragment WGSL size.",
    inputSchema: OBJ({
      nodeIds: { type: "array", items: { type: "string" }, description: "restrict to these node ids (default: all)" },
      size: { type: "number", description: "render size px, default 512" },
      runs: { type: "number", description: "GPU timestamp samples per node (median), default 6" },
      compileRuns: { type: "number", description: "independently cache-busted pipeline compiles per node (median), default 3" },
    }),
  },
];

const toolNames = new Set(tools.map((t) => t.name));

// A page result that looks like an image → MCP image content, so the agent can see it.
function isImageResult(r) {
  return r && typeof r === "object" && typeof r.base64 === "string" && typeof r.mime === "string";
}

function artifactSlug(value) {
  return String(value).normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
    || "node";
}

function nextArtifactPath(baseName) {
  const first = join(IMAGE_ARTIFACT_DIR, `${baseName}.png`);
  if (!existsSync(first)) return { path: first, filename: `${baseName}.png` };
  for (let occurrence = 2; ; occurrence += 1) {
    const filename = `${baseName}-${occurrence}.png`;
    const path = join(IMAGE_ARTIFACT_DIR, filename);
    if (!existsSync(path)) return { path, filename };
  }
}

async function auditNodeContributions(args) {
  if (!IMAGE_ARTIFACT_DIR) {
    throw new Error("audit_node_contributions requires the author-review artifact directory.");
  }
  const nodeIds = Array.isArray(args.nodeIds) ? [...new Set(args.nodeIds)] : [];
  if (!nodeIds.length || nodeIds.length > CONTRIBUTION_AUDIT_BATCH_LIMIT
      || nodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeId)) {
    throw new Error(`nodeIds must contain 1-${CONTRIBUTION_AUDIT_BATCH_LIMIT} unique node ids.`);
  }
  mkdirSync(IMAGE_ARTIFACT_DIR, { recursive: true, mode: 0o700 });
  const scale = typeof args.scale === "number" ? args.scale : 1;
  const profile = typeof args.profile === "string" ? args.profile : "standard";
  const channel = typeof args.channel === "string" ? args.channel : undefined;
  const checks = [];
  const failures = [];
  for (const nodeId of nodeIds) {
    try {
      const result = await callPage("get_render", {
        nodeId,
        view: "difference",
        size: 1024,
        maxDim: 1024,
        scale,
        profile,
        ...(channel ? { channel } : {}),
      });
      if (!isImageResult(result) || !result.stats) throw new Error("difference render returned no image or statistics");
      const mode = [nodeId];
      if (profile !== "standard") mode.push(profile);
      if (scale !== 1) mode.push(`scale-${scale}`);
      const baseName = `${artifactSlug(channel || "lit")}-diff-${artifactSlug(mode.join("-"))}`;
      const artifact = nextArtifactPath(baseName);
      await sharp(Buffer.from(result.base64, "base64")).resize(1024, 1024).png().toFile(artifact.path);
      checks.push({ ...result.stats, artifact: artifact.filename });
    } catch (error) {
      failures.push({ nodeId, error: error?.message || String(error) });
    }
  }
  const zeroContribution = checks
    .filter((check) => check.changedPixels === 0 && check.maxPercent === 0)
    .map((check) => check.nodeId);
  return {
    size: 1024,
    maxDim: 1024,
    scale,
    profile,
    channel: channel || "lit",
    checkedCount: checks.length,
    zeroContribution,
    failures,
    checks,
  };
}

// ---------------------------------------------------------------------------------------------------------
// MCP server (stdio)
// ---------------------------------------------------------------------------------------------------------

const server = new Server(
  { name: "material-designer", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (!toolNames.has(name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = name === "audit_node_contributions"
      ? await auditNodeContributions(args ?? {})
      : await callPage(name, args ?? {});
    if (isImageResult(result)) {
      let imageData = result.base64;
      let imageMime = result.mime;
      // Long author turns can inspect dozens of 1024px renders. Keep their model context below
      // provider payload limits while the orchestrator still archives every response as PNG.
      if (COMPACT_IMAGE_RESPONSES && imageMime === "image/png") {
        const compact = await sharp(Buffer.from(imageData, "base64"))
          .webp({ quality: 78, effort: 4 })
          .toBuffer();
        imageData = compact.toString("base64");
        imageMime = "image/webp";
      }
      const content = [];
      if (result.stats) content.push({ type: "text", text: JSON.stringify({ difference: result.stats }, null, 2) });
      content.push({ type: "image", data: imageData, mimeType: imageMime });
      return { content };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? err}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] Material Designer MCP server ready (stdio).");

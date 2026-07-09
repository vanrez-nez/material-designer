import * as THREE from "three";
import { RenderTarget, type WebGPURenderer } from "three/webgpu";
import {
  bakeService,
  compileSockets,
  defaultRegistry,
  migrateMaterialDocument,
  MATERIAL_DOCUMENT_VERSION,
  PBR_SOCKETS,
  SURFACE_CHANNELS,
  type MaterialGraphDocument,
  type PbrSocket,
} from "@/runtime";
import type { MainScene } from "@/editor/panes/preview/MainScene";
import type { ExportApi } from "./export";
import { useWorkspaceStore } from "@/store/app";
import { useDocumentLibraryStore, listDocuments } from "@/store/document-library";
import { dispatchMaterialDocumentLoad, dispatchMaterialGraphRebuild } from "@/app-events";

// ---------------------------------------------------------------------------------------------------------
// In-page MCP bridge (dev-only). Connects OUTBOUND to the Node MCP server's WebSocket (scripts/
// material-mcp-server.mjs) and executes an RPC command table against the live editor: read the document,
// mutate nodes/edges, snapshot/restore for safety, save library versions, and capture LLM-optimized images
// (channel textures, a lit demo render, the live viewport). Every mutating command auto-snapshots first, so
// nothing an agent does is irreversible. See src/debug/bake-setup.ts for the sibling dev-handle pattern.
// ---------------------------------------------------------------------------------------------------------

const WS_URL = "ws://127.0.0.1:51787";
const SNAPSHOT_STORAGE_KEY = "md.mcp.snapshots";
const SNAPSHOT_CAP = 30; // in-memory ring cap
const SNAPSHOT_PERSIST = 10; // how many full docs to mirror to localStorage (survives a tab reload)

export interface McpBridgeDeps {
  mainScene: MainScene;
  exporter: ExportApi;
  getRenderer: () => WebGPURenderer;
  getCamera: () => THREE.PerspectiveCamera;
}

interface RpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface Snapshot {
  id: string;
  label: string;
  timestamp: number;
  source: "auto" | "manual";
  document: MaterialGraphDocument;
}

// A returned image, LLM-optimized (downscaled + compressed). The server maps this to MCP image content.
interface ImageResult {
  mime: string;
  base64: string;
  width: number;
  height: number;
}

export function installMcpBridge(deps: McpBridgeDeps): void {
  const controller = deps.mainScene.materialController;

  // --- snapshot ring (safety) ------------------------------------------------------------------------
  const snapshots: Snapshot[] = loadPersistedSnapshots();

  function currentDocument(): MaterialGraphDocument {
    return structuredClone(useWorkspaceStore.getState().materialDocument);
  }

  function takeSnapshot(label: string, source: "auto" | "manual"): Snapshot {
    const snap: Snapshot = {
      id: crypto.randomUUID(),
      label,
      timestamp: Date.now(),
      source,
      document: currentDocument(),
    };
    snapshots.unshift(snap);
    if (snapshots.length > SNAPSHOT_CAP) snapshots.length = SNAPSHOT_CAP;
    persistSnapshots(snapshots);
    return snap;
  }

  // Wrap a mutating command so the state before it is always recoverable. After the mutation lands in the
  // store, redraw the imperative node canvas — the store drives the preview reactively, but the Rete editor
  // view only refreshes on an explicit rebuild. Without this, MCP edits show in the preview but not in the
  // graph until a reload. Rebuilds coalesce (EditorPanel.queueRebuild), so bursts collapse to one redraw.
  async function mutating<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    takeSnapshot(label, "auto");
    const result = await fn();
    dispatchMaterialGraphRebuild();
    return result;
  }

  // --- validation ------------------------------------------------------------------------------------
  // Migrate + compile an inbound document; throws (rejecting the command) if it can't compile, so a bad doc
  // never reaches the live editor. Returns the migrated document ready to load.
  function validateDocument(raw: unknown): MaterialGraphDocument {
    if (!raw || typeof raw !== "object") throw new Error("document must be an object");
    const doc = raw as MaterialGraphDocument;
    if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
      throw new Error("document is missing nodes/edges arrays");
    }
    const migrated = migrateMaterialDocument(doc);
    compileSockets(migrated, defaultRegistry, { backend: "live" }); // throws on an invalid graph
    return migrated;
  }

  // The MCP `set_param` tool's `value` field is untyped, so a numeric value can arrive over the wire as a
  // string. Storing a string in a float/int param makes the editor's Tweakpane render a plain text input
  // instead of a slider (and can serialise oddly), so coerce to the registry param type before writing.
  function coerceParamValue(nodeType: string, key: string, value: unknown): unknown {
    const registry = controller.getRegistry();
    if (!registry.has(nodeType)) return value;
    const def = registry.get(nodeType).params.find((pd) => pd.key === key);
    if (!def) return value;
    if ((def.type === "float" || def.type === "int") && typeof value === "string") {
      const num = Number(value);
      if (Number.isFinite(num)) return def.type === "int" ? Math.round(num) : num;
    }
    if (def.type === "bool" && typeof value === "string") return value === "true";
    return value;
  }

  // --- command handlers ------------------------------------------------------------------------------
  const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
    // --- read / inspect ---
    get_document: () => currentDocument(),

    list_nodes: () => {
      const doc = useWorkspaceStore.getState().materialDocument;
      return {
        nodes: doc.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.label,
          enabled: n.enabled,
          position: n.position,
          params: n.params,
        })),
        edges: doc.edges,
      };
    },

    get_registry: () => {
      const registry = controller.getRegistry();
      return {
        nodes: registry.all().map((def) => ({
          type: def.type,
          nodeClass: def.nodeClass,
          label: def.label,
          undeletable: def.type === "material-output",
          singleton: def.type === "material-output",
          inputs: def.inputs.map((p) => ({ key: p.key, kind: p.kind, label: p.label })),
          outputs: def.outputs.map((p) => ({ key: p.key, kind: p.kind, label: p.label })),
          params: def.params.map((p) => ({
            key: p.key,
            label: p.label,
            type: p.type,
            default: p.default,
            min: p.min,
            max: p.max,
            step: p.step,
            options: p.options,
          })),
        })),
      };
    },

    // --- mutate (each auto-snapshotted; validation where a full doc is supplied) ---
    add_node: (p) => {
      const type = requireString(p, "type");
      const position = (p.position as { x: number; y: number }) ?? { x: 0, y: 0 };
      if (!controller.getRegistry().has(type)) throw new Error(`unknown node type: ${type}`);
      return mutating(`before add_node:${type}`, () => ({ id: controller.addNode(type, position) }));
    },

    remove_node: (p) => {
      const id = requireString(p, "id");
      const node = currentActive().nodes.find((n) => n.id === id);
      if (!node) throw new Error(`no node with id ${id}`);
      if (isUndeletable(node.type)) {
        throw new Error(`node ${id} (${node.type}) cannot be removed — it is a required output/boundary node`);
      }
      return mutating(`before remove_node:${node.type}`, () => {
        controller.removeNode(id);
        return { removed: id };
      });
    },

    set_param: (p) => {
      const nodeId = requireString(p, "nodeId");
      const key = requireString(p, "key");
      const node = currentActive().nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`no node with id ${nodeId}`);
      const value = coerceParamValue(node.type, key, p.value);
      return mutating(`before set_param:${nodeId}.${key}`, () => {
        controller.setParam(nodeId, key, value);
        return { ok: true };
      });
    },

    set_label: (p) => {
      const nodeId = requireString(p, "nodeId");
      // Allow an empty string to clear the label (falls back to the registry name); so don't requireString it.
      const label = typeof p.label === "string" ? p.label : "";
      const node = currentActive().nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`no node with id ${nodeId}`);
      return mutating(`before set_label:${nodeId}`, () => {
        controller.setNodeLabel(nodeId, label);
        return { ok: true, label: label.trim() || null };
      });
    },

    connect_edge: (p) => {
      const edge = edgeFrom(p);
      return mutating("before connect_edge", () => {
        const connected = controller.connect(edge);
        if (!connected) throw new Error("connection rejected — incompatible port kinds or unknown ports");
        return { connected: true };
      });
    },

    disconnect_edge: (p) => {
      const edge = edgeFrom(p);
      return mutating("before disconnect_edge", () => {
        controller.disconnect(edge);
        return { disconnected: true };
      });
    },

    load_document: (p) => {
      const migrated = validateDocument(p.document);
      const title = typeof p.title === "string" ? p.title : undefined;
      if (p.dryRun) return { dryRun: true, diff: diffDocuments(currentDocument(), migrated) };
      return mutating("before load_document", () => {
        dispatchMaterialDocumentLoad(migrated, title);
        return { loaded: true, diff: diffDocuments(currentDocument(), migrated) };
      });
    },

    set_output_resolution: (p) => {
      const size = clampTo64(requireNumber(p, "size"));
      const doc = currentDocument();
      const output = doc.nodes.find((n) => n.type === "material-output");
      if (!output) throw new Error("no material-output node");
      return mutating(`before set_output_resolution:${size}`, () => {
        controller.setParam(output.id, "outputResolution", String(size));
        return { outputResolution: size };
      });
    },

    // --- snapshots / versions ---
    list_snapshots: () =>
      snapshots.map((s) => ({ id: s.id, label: s.label, timestamp: s.timestamp, source: s.source })),

    create_snapshot: (p) => {
      const label = typeof p.label === "string" && p.label.trim() ? p.label.trim() : "manual snapshot";
      const snap = takeSnapshot(label, "manual");
      return { id: snap.id, label: snap.label, timestamp: snap.timestamp };
    },

    restore_snapshot: (p) => {
      const id = requireString(p, "id");
      const snap = snapshots.find((s) => s.id === id);
      if (!snap) throw new Error(`no snapshot with id ${id}`);
      // Restoring is itself reversible: snapshot the current state before overwriting it.
      takeSnapshot("before restore", "auto");
      const migrated = validateDocument(snap.document);
      dispatchMaterialDocumentLoad(migrated);
      return { restored: id };
    },

    save_version: (p) => {
      const title = typeof p.title === "string" ? p.title : undefined;
      const doc = currentDocument();
      const store = useDocumentLibraryStore.getState();
      const entry = p.overwrite ? store.saveActive(doc) : store.importDocument(doc, title);
      return { id: entry.id, title: entry.title, updatedAt: entry.updatedAt };
    },

    list_versions: () =>
      listDocuments(useDocumentLibraryStore.getState().documents).map((e) => ({
        id: e.id,
        title: e.title,
        updatedAt: e.updatedAt,
      })),

    // --- images (LLM-optimized) ---
    get_channel_texture: async (p) => {
      const channel = requireChannel(p);
      const size = clampTo64(typeof p.size === "number" ? p.size : 512);
      const maxDim = typeof p.maxDim === "number" ? p.maxDim : 768;
      const image = await bakeService.readImage(controller, channel, size);
      if (!image) throw new Error(`channel "${channel}" is not connected`);
      const crop = p.crop as { x: number; y: number; w: number; h: number } | undefined;
      return optimize(imageDataToCanvas(image), { maxDim, mime: "image/png", crop });
    },

    get_render: async (p) => {
      const size = clampTo64(typeof p.size === "number" ? p.size : 768);
      const scale = typeof p.scale === "number" ? p.scale : 1;
      const profile = typeof p.profile === "string" ? p.profile : "standard";
      const maxDim = typeof p.maxDim === "number" ? p.maxDim : 768;
      const blob = await deps.exporter.renderMaterialImage({ doc: currentDocument(), size, scale, profile });
      if (!blob) throw new Error("render produced no image");
      return optimize(await blobToCanvas(blob), { maxDim, mime: "image/jpeg", quality: 0.8 });
    },

    get_viewport: async (p) => {
      const maxDim = typeof p.maxDim === "number" ? p.maxDim : 768;
      const canvas = await captureViewport(clampTo64(typeof p.size === "number" ? p.size : 768));
      return optimize(canvas, { maxDim, mime: "image/jpeg", quality: 0.8 });
    },
  };

  // --- image helpers ---------------------------------------------------------------------------------
  function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
    return canvas;
  }

  async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  // Downscale (longest side ≤ maxDim) + optional magnified crop, then encode to a compact base64 image —
  // the same shape Chrome MCP returns screenshots in, so payloads stay small and legible.
  async function optimize(
    source: HTMLCanvasElement,
    opts: { maxDim: number; mime: string; quality?: number; crop?: { x: number; y: number; w: number; h: number } },
  ): Promise<ImageResult> {
    // Crop rect is normalized 0..1 of the source; default = whole image.
    const c = opts.crop;
    const sx = c ? Math.max(0, Math.min(1, c.x)) * source.width : 0;
    const sy = c ? Math.max(0, Math.min(1, c.y)) * source.height : 0;
    const sw = c ? Math.max(0.01, Math.min(1, c.w)) * source.width : source.width;
    const sh = c ? Math.max(0.01, Math.min(1, c.h)) * source.height : source.height;

    const longest = Math.max(sw, sh);
    const factor = longest > opts.maxDim ? opts.maxDim / longest : 1;
    const outW = Math.max(1, Math.round(sw * factor));
    const outH = Math.max(1, Math.round(sh * factor));

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    out.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, opts.mime, opts.quality),
    );
    if (!blob) throw new Error("failed to encode image");
    const base64 = await blobToBase64(blob);
    return { mime: opts.mime, base64, width: outW, height: outH };
  }

  // Render the live scene (with the on-screen camera) to an offscreen target and read it back — reliable
  // across WebGPU backends, unlike canvas.toDataURL on a presented swapchain.
  async function captureViewport(size: number): Promise<HTMLCanvasElement> {
    const renderer = deps.getRenderer();
    const camera = deps.getCamera();
    const scene = deps.mainScene.scene;
    const dim = size;
    const rt = new RenderTarget(dim, dim, { samples: 4, depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevAspect = camera.aspect;
    const prevTarget = renderer.getRenderTarget();
    try {
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      const buffer = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, dim, dim)) as unknown as Uint8Array;
      const canvas = document.createElement("canvas");
      canvas.width = dim;
      canvas.height = dim;
      canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(buffer), dim, dim), 0, 0);
      return canvas;
    } finally {
      renderer.setRenderTarget(prevTarget);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      rt.dispose();
    }
  }

  // The (sub)document currently targeted by controller edits — root or an entered group.
  function currentActive(): MaterialGraphDocument {
    return controller.activeDocument;
  }

  // --- transport -------------------------------------------------------------------------------------
  let socket: WebSocket | null = null;
  let backoff = 1000;

  function connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.addEventListener("open", () => {
      backoff = 1000;
      console.info("[mcp] bridge connected");
      send({ hello: true, app: "material-designer", docVersion: MATERIAL_DOCUMENT_VERSION });
    });

    ws.addEventListener("message", async (event: MessageEvent) => {
      let req: RpcRequest;
      try {
        req = JSON.parse(String(event.data)) as RpcRequest;
      } catch {
        return; // ignore non-JSON frames
      }
      if (typeof req.id !== "number" || typeof req.method !== "string") return;
      const handler = handlers[req.method];
      if (!handler) {
        send({ id: req.id, ok: false, error: { message: `unknown method: ${req.method}` } });
        return;
      }
      try {
        const result = await handler(req.params ?? {});
        send({ id: req.id, ok: true, result });
      } catch (err) {
        send({ id: req.id, ok: false, error: { message: err instanceof Error ? err.message : String(err) } });
      }
    });

    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", () => ws.close());
  }

  function send(payload: unknown): void {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function scheduleReconnect(): void {
    if (socket) {
      socket.onclose = null;
      socket = null;
    }
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  connect();
}

// ---------------------------------------------------------------------------------------------------------
// Free helpers (no closure state)
// ---------------------------------------------------------------------------------------------------------

function isUndeletable(type: string): boolean {
  return type === "material-output" || type === "group-input" || type === "group-output";
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value) throw new Error(`missing required string param: ${key}`);
  return value;
}

function requireNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`missing required number param: ${key}`);
  return value;
}

function requireChannel(params: Record<string, unknown>): PbrSocket {
  const channel = requireString(params, "channel");
  if (!(PBR_SOCKETS as readonly string[]).includes(channel)) {
    throw new Error(`unknown channel "${channel}" — expected one of ${SURFACE_CHANNELS.join(", ")}`);
  }
  return channel as PbrSocket;
}

function edgeFrom(params: Record<string, unknown>): {
  fromNode: string;
  fromOutput: string;
  toNode: string;
  toInput: string;
} {
  return {
    fromNode: requireString(params, "fromNode"),
    fromOutput: requireString(params, "fromOutput"),
    toNode: requireString(params, "toNode"),
    toInput: requireString(params, "toInput"),
  };
}

// readImage needs 256-byte-aligned rows → a multiple of 64 px. Round any request to the nearest one.
function clampTo64(size: number): number {
  return Math.max(64, Math.round(size / 64) * 64);
}

function diffDocuments(before: MaterialGraphDocument, after: MaterialGraphDocument) {
  const beforeIds = new Set(before.nodes.map((n) => n.id));
  const afterIds = new Set(after.nodes.map((n) => n.id));
  return {
    nodesAdded: [...afterIds].filter((id) => !beforeIds.has(id)),
    nodesRemoved: [...beforeIds].filter((id) => !afterIds.has(id)),
    nodeCount: { before: before.nodes.length, after: after.nodes.length },
    edgeCount: { before: before.edges.length, after: after.edges.length },
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function loadPersistedSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Snapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSnapshots(snapshots: Snapshot[]): void {
  try {
    // Only mirror the most recent few full documents — the ring can hold more in memory than we want to
    // push through the localStorage quota.
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots.slice(0, SNAPSHOT_PERSIST)));
  } catch {
    // Quota / private mode — non-fatal; the in-memory ring still works this session.
  }
}

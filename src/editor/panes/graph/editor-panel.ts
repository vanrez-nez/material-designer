// The graph editor on TweakPad's Flow widget (`tp-flow`). It renders an `EditorGraphConfig` (see types.ts)
// and keeps the owner (the material controller) as the source of truth.
//
// Nodes and wires are authored as `tp-flow-node` / `tp-flow-edge` children: the widget adopts them into
// its document. A node's properties are part of its definition and its values are its `data`, so the
// widget renders them as inline rows in the panel body and reports edits as node-data changes, which go
// to the owner; any further light-DOM content renders below them with the page's styles. The widget may
// move nodes on its own; every topology edit (connect, disconnect, delete, rename) goes through the config
// hooks first and is then reflected in the authored children. Undo and redo stay with the owner's history,
// so the widget's own history steps are refused.
import { html, nothing, type TemplateResult } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { Eye, Pencil, Trash2 } from 'lucide'
import { layoutFlow, type FlowEdge, type FlowNode, type FlowNodeDefinition } from '@tweakpad/ui/flow'
import type { TpFlow } from '@tweakpad/ui/widgets'
import type { TpInput } from '@tweakpad/ui'
import { GRAPH_AUTO_LAYOUT_EVENT, type GraphAutoLayoutEvent } from '@/app-events'
import { AddNodeControl } from './node-palette-dialog'
import { iconSlot, lucideIcon } from './floating-widget'
import type {
  EditorConnectionConfig,
  EditorGraphConfig,
  EditorHistoryUpdateOptions,
  EditorNodeConfig,
  EditorViewState,
} from './types'
import './editor.css'

export type EditorPanelOptions = {
  /** Where the panel attaches; defaults to `document.body`. */
  host?: HTMLElement
}

type LayoutArrangement = NonNullable<EditorViewState['layoutArrangement']>
type Point = { x: number; y: number }

const LAYOUT_ARRANGEMENTS: LayoutArrangement[] = ['down', 'right', 'up', 'left']
// Spacing between nodes in a layer and between layers for the automatic layout.
const LAYOUT_NODE_SPACING = 70
const LAYOUT_RANK_SPACING = 130
// The view to frame when a node title is double-clicked: the node at 100%.
const NODE_FOCUS_ZOOM = 1

// Header tone per node class (Blender nclass convention), from the tones the widget offers.
const CLASS_TONE: Record<string, string> = {
  input: 'chart-2',
  texture: 'destructive',
  color: 'warning',
  vector: 'chart-1',
  converter: 'chart-3',
  shader: 'success',
  output: 'chart-5',
  group: 'primary',
}

// Socket kinds paint their ports; compatibility is decided by the owner when a wire is drawn.
const DATA_TYPES = [
  { id: 'float', label: 'Float' },
  { id: 'vector', label: 'Vector', tone: 'chart-1' },
  { id: 'color', label: 'Color', tone: 'warning' },
  { id: 'shader', label: 'Shader', tone: 'success' },
]

// Geometry the widget may change on its own; any other user edit is applied through the owner.
const GEOMETRY_CHANGES = new Set(['node-position', 'node-size', 'node-measure'])

type MountedControls = { host: HTMLElement; dispose: () => void }

export class EditorPanel {
  private readonly root: HTMLDivElement
  private readonly canvasHost: HTMLDivElement
  private readonly flow: TpFlow
  private readonly addNodeControl: AddNodeControl

  private open_ = false
  private config: EditorGraphConfig | null = null
  private pendingConfig: EditorGraphConfig | null = null
  private pendingFitView = false
  private readonly nodeConfigs = new Map<string, EditorNodeConfig>()
  private readonly nodeElements = new Map<string, HTMLElement>()
  private readonly edgeElements = new Map<string, HTMLElement>()
  private readonly controls = new Map<string, MountedControls>()
  private graphSignature: string | null = null
  private layoutArrangement: LayoutArrangement = 'down'
  private renamingNodeId: string | null = null
  private positionsDirty = false
  private positionTransactionActive = false
  private restoringView = false

  constructor(options: EditorPanelOptions = {}) {
    this.root = document.createElement('div')
    this.root.className = 'ne-panel ne-panel--embedded'
    this.root.hidden = true

    this.canvasHost = document.createElement('div')
    this.canvasHost.className = 'ne-canvas'

    const flow = document.createElement('tp-flow') as TpFlow
    flow.className = 'fe-flow'
    flow.label = 'Material graph'
    flow.background = 'dots'
    // Node bodies are dense rows of inline fields: the canvas, and the popups it opens, use compact density
    // and the flat appearance (fields and nodes separated by fill, not edges).
    flow.setAttribute('density', 'compact')
    flow.setAttribute('appearance', 'flat')
    // Drag and zoom are the widget's defaults, but the zoom goes further out so fitting frames even a wide
    // graph whole. Nodes keep their full content (their parameter fields) at every zoom.
    flow.minZoom = 0.04
    flow.detailZoom = flow.minZoom
    flow.virtualize = false
    flow.palette = 'none'
    flow.inspector = 'none'
    flow.contextMenu = false
    flow.controls = ['zoom-out', 'fit', 'zoom-in']
    flow.controlsPosition = 'top-end'
    flow.controlsOrientation = 'horizontal'
    flow.nodeToolbar = (context) => this.renderNodeToolbar(context.node)
    flow.addEventListener('tp-value-change', this.onValueChange)
    flow.addEventListener('tp-value-commit', this.onValueCommit)
    flow.addEventListener('tp-connect', this.onConnect)
    flow.addEventListener('tp-delete', this.onDelete)
    flow.addEventListener('tp-viewport-change', this.onViewportChange)
    flow.addEventListener('dblclick', this.onDoubleClick)
    this.flow = flow

    const tip = document.createElement('span')
    tip.className = 'ne-canvas__tip'
    tip.slot = 'bottom-end'
    tip.textContent = 'Scroll to pan · Pinch or Ctrl + scroll to zoom · Double-click a title to focus'
    flow.appendChild(tip)

    this.canvasHost.appendChild(flow)
    this.addNodeControl = new AddNodeControl({
      mount: this.canvasHost,
      onPick: (type) => this.addPaletteNode(type),
    })

    this.root.appendChild(this.canvasHost)
    ;(options.host ?? document.body).appendChild(this.root)

    document.addEventListener('keydown', this.onKeyDown)
    window.addEventListener(GRAPH_AUTO_LAYOUT_EVENT, this.onGraphAutoLayout)
  }

  isOpen(): boolean {
    return this.open_
  }

  attachHost(host: HTMLElement): void {
    if (this.root.parentElement !== host) host.appendChild(this.root)
  }

  // The canvas element (position: relative), so callers can mount their own overlays (e.g. the
  // bake-progress widget) into the graph area.
  get overlayHost(): HTMLElement {
    return this.canvasHost
  }

  // Rebuilds coalesce to one per frame, so bursts of owner edits (e.g. MCP) redraw once. `fitView` frames
  // the whole graph once it has rendered (a newly opened document) instead of restoring its saved view.
  open(config: EditorGraphConfig, options: { fitView?: boolean } = {}): void {
    this.root.hidden = false
    this.open_ = true
    const queued = this.pendingConfig !== null
    this.pendingConfig = config
    if (options.fitView) this.pendingFitView = true
    if (!queued) requestAnimationFrame(() => void this.flushRebuild())
  }

  close(): void {
    this.open_ = false
    this.root.hidden = true
  }

  setLayoutArrangement(arrangement: LayoutArrangement): void {
    this.layoutArrangement = arrangement
    this.saveViewState()
    void this.arrangeGraph()
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener(GRAPH_AUTO_LAYOUT_EVENT, this.onGraphAutoLayout)
    this.disposeControls()
    this.addNodeControl.dispose()
    this.root.remove()
  }

  // DEV/test helper: a user-drawn connection by config ids, through the same owner hook a drag uses.
  simulateConnect(fromId: string, fromOutput: string, toId: string, toInput: string): boolean {
    return this.applyConnection({ from: fromId, fromOutput, to: toId, toInput })
  }

  // --- building ------------------------------------------------------------------------------------

  private async flushRebuild(): Promise<void> {
    const config = this.pendingConfig
    const fitView = this.pendingFitView
    this.pendingConfig = null
    this.pendingFitView = false
    if (!config) return
    try {
      await this.rebuild(config, fitView)
    } catch (error) {
      console.error('[graph-editor] rebuild failed', error)
    }
  }

  private async rebuild(config: EditorGraphConfig, fitView: boolean): Promise<void> {
    // A same-graph rebuild (a param change adding or removing sockets) keeps the view; a different graph
    // (group navigation) restores its saved view or lays itself out; a fitted one (document load) keeps its
    // positions and is framed whole.
    const previousSignature = this.graphSignature
    const previousViewport = this.flow.viewport
    const hasMissingPositions = config.nodes.some((node) => !node.position)

    this.config = config
    this.renamingNodeId = null
    if (config.editorViewState?.layoutArrangement) this.layoutArrangement = config.editorViewState.layoutArrangement
    this.graphSignature = config.nodes.map((node) => node.id).join('|')

    // Authored children are updated in place by id: the widget keeps a node host bound to its element, so
    // only nodes and wires that came or went are added or removed.
    this.disposeControls()
    this.nodeConfigs.clear()
    for (const node of config.nodes) this.nodeConfigs.set(node.id, node)
    this.updateSchema()
    for (const [id, element] of this.nodeElements) {
      if (this.nodeConfigs.has(id)) continue
      element.remove()
      this.nodeElements.delete(id)
    }
    for (const node of config.nodes) this.renderNodeElement(node, node.position ?? { x: 0, y: 0 })
    const edgeIds = new Set(config.connections.map(edgeId))
    for (const id of [...this.edgeElements.keys()]) if (!edgeIds.has(id)) this.removeEdgeElement(id)
    for (const connection of config.connections) this.addEdgeElement(connection)
    const canAdd = Boolean(config.onAddNode && config.palette && config.palette.length > 0)
    this.addNodeControl.setPalette(canAdd ? config.palette! : [])

    await this.flow.updateComplete
    await nextFrame()
    const saved = config.editorViewState?.transform
    const keepsLayout = !hasMissingPositions && (saved || previousSignature === this.graphSignature)
    if (!keepsLayout) await this.arrangeGraph({ history: 'skip' })
    else if (fitView) await this.frameGraph()
    else if (saved) await this.restoreViewport({ x: saved.x, y: saved.y, zoom: saved.k })
    else await this.restoreViewport(previousViewport)
  }

  // Each node is its own definition: its ports are instance-specific (groups, mode-dependent sockets).
  private updateSchema(): void {
    this.flow.schema = {
      dataTypes: DATA_TYPES,
      rules: { defaultEdgeKind: 'bezier', typeCompatibility: () => true },
      nodes: [...this.nodeConfigs.values()].map(definitionFor),
    }
  }

  // An authored node: the panel card shows the title, port rows and property rows (from its definition and
  // `data`); its content is the preview marker and any further controls (vectors, curves, the
  // group-interface editor).
  private renderNodeElement(node: EditorNodeConfig, position: Point): void {
    let element = this.nodeElements.get(node.id)
    if (!element) {
      element = document.createElement('tp-flow-node')
      element.id = node.id
      element.setAttribute('type', node.id)
      this.flow.appendChild(element)
      this.nodeElements.set(node.id, element)
    }
    element.setAttribute('label', node.title)
    element.setAttribute('data', JSON.stringify(node.values ?? {}))
    setPosition(element, position)
    const content: HTMLElement[] = []
    if (node.soloed) {
      const badge = document.createElement('tp-badge')
      badge.className = 'fe-node__solo'
      badge.setAttribute('variant', 'secondary')
      badge.textContent = 'Previewing'
      content.push(badge)
    }
    if (node.mountControls) {
      const host = document.createElement('div')
      host.className = 'fe-node__controls'
      // The controls own presses inside them (fields, the curve canvas), so they never start a node drag.
      host.addEventListener('pointerdown', (event) => event.stopPropagation())
      content.push(host)
      this.controls.set(node.id, { host, dispose: node.mountControls(host) })
    }
    element.replaceChildren(...content)
  }

  private addEdgeElement(connection: EditorConnectionConfig): void {
    const id = edgeId(connection)
    if (this.edgeElements.has(id)) return
    const element = document.createElement('tp-flow-edge')
    element.id = id
    element.setAttribute('source', connection.from)
    element.setAttribute('source-port', flowPortId('output', connection.fromOutput))
    element.setAttribute('target', connection.to)
    element.setAttribute('target-port', flowPortId('input', connection.toInput))
    this.flow.appendChild(element)
    this.edgeElements.set(id, element)
  }

  private removeEdgeElement(id: string): void {
    this.edgeElements.get(id)?.remove()
    this.edgeElements.delete(id)
  }

  private disposeControls(): void {
    for (const { dispose } of this.controls.values()) dispose()
    this.controls.clear()
  }

  // The bar above a selected node: rename, preview and delete.
  private renderNodeToolbar(flowNode: FlowNode): TemplateResult {
    const node = this.nodeConfigs.get(flowNode.id)
    if (!node) return html``
    if (this.renamingNodeId === flowNode.id) {
      return html`<tp-input
        class="fe-rename"
        label="Node name"
        .defaultValue=${node.title}
        ${ref((element) => element && focusAndSelect(element as TpInput))}
        @keydown=${(event: KeyboardEvent) => this.onRenameKey(event, flowNode.id)}
        @focusout=${(event: FocusEvent) => this.commitRename(event, flowNode.id)}
      ></tp-input>`
    }
    const deletable = Boolean(node.deletable && this.config?.onDeleteNode)
    const soloLabel = node.soloed ? 'Stop previewing this node' : 'Preview this node on the surface'
    return html`
      ${node.onRename
        ? html`<tp-button variant="ghost" size="icon-sm" title="Rename node" @click=${() => this.beginRename(flowNode.id)}>
            ${iconSlot(Pencil)}Rename node
          </tp-button>`
        : nothing}
      ${node.onSolo
        ? // Pressed while this node is previewed; the owner decides and re-renders the graph.
          html`<tp-toggle
            size="icon-sm"
            aria-label=${soloLabel}
            title=${soloLabel}
            .pressed=${Boolean(node.soloed)}
            @click=${() => node.onSolo?.()}
          >
            ${lucideIcon(Eye)}
          </tp-toggle>`
        : nothing}
      ${deletable
        ? html`<tp-button variant="ghost" size="icon-sm" title="Delete node" @click=${() => this.deleteElements([flowNode.id], [])}>
            ${iconSlot(Trash2)}Delete node
          </tp-button>`
        : nothing}
    `
  }

  // --- owner edits ---------------------------------------------------------------------------------

  private applyConnection(connection: EditorConnectionConfig): boolean {
    if (!this.config?.onConnect || !this.config.onConnect(connection)) return false
    // One wire per input: the new connection replaces whatever fed that input.
    for (const edge of this.flow.edges) {
      if (edge.target === connection.to && edge.targetPort === flowPortId('input', connection.toInput)) this.removeEdgeElement(edge.id)
    }
    this.addEdgeElement(connection)
    return true
  }

  private deleteElements(nodeIds: string[], edgeIds: string[]): void {
    const config = this.config
    if (!config) return
    const removedNodes = new Set(nodeIds.filter((id) => this.nodeConfigs.get(id)?.deletable && config.onDeleteNode))
    for (const id of removedNodes) config.onDeleteNode?.(id)
    for (const edge of this.flow.edges) {
      const onRemovedNode = removedNodes.has(edge.source) || removedNodes.has(edge.target)
      // Wires on a removed node go with it; the owner drops them with the node.
      if (edgeIds.includes(edge.id) && !onRemovedNode) config.onDisconnect?.(fromFlowEdge(edge))
      if (edgeIds.includes(edge.id) || onRemovedNode) this.removeEdgeElement(edge.id)
    }
    for (const id of removedNodes) {
      this.controls.get(id)?.dispose()
      this.controls.delete(id)
      this.nodeElements.get(id)?.remove()
      this.nodeElements.delete(id)
      this.nodeConfigs.delete(id)
    }
    this.updateSchema()
  }

  // Add a node from the palette: the owner creates it at the centre of the view and returns its config.
  private addPaletteNode(type: string): void {
    if (!this.config?.onAddNode) return
    const position = this.viewportCentre()
    const node = this.config.onAddNode(type, position)
    if (!node) return
    this.nodeConfigs.set(node.id, node)
    this.updateSchema()
    this.renderNodeElement(node, node.position ?? position)
    requestAnimationFrame(() => this.savePositions({ history: 'skip' }))
  }

  private beginRename(nodeId: string): void {
    this.renamingNodeId = nodeId
    this.flow.requestUpdate()
  }

  private onRenameKey(event: KeyboardEvent, nodeId: string): void {
    event.stopPropagation()
    if (event.key === 'Enter') (event.target as HTMLElement).blur()
    else if (event.key === 'Escape') {
      this.renamingNodeId = null
      this.flow.requestUpdate()
      void this.flow.focusNode(nodeId, { reveal: false })
    }
  }

  // Commit on leaving the field; an empty name clears back to the node type's name.
  private commitRename(event: FocusEvent, nodeId: string): void {
    if (this.renamingNodeId !== nodeId) return
    this.renamingNodeId = null
    const node = this.nodeConfigs.get(nodeId)
    const value = String((event.currentTarget as TpInput).value ?? '').trim()
    if (node?.onRename) {
      node.onRename(value)
      const title = value || node.defaultTitle || node.title
      this.nodeConfigs.set(nodeId, { ...node, title })
      this.nodeElements.get(nodeId)?.setAttribute('label', title)
    }
    this.flow.requestUpdate()
  }

  // --- widget events -------------------------------------------------------------------------------

  private readonly onValueChange = (event: Event): void => {
    if (event.target !== this.flow) return
    const detail = (event as CustomEvent<{ value: { edges: FlowEdge[] }; metadata?: FlowChangeMeta }>).detail
    const metadata = detail.metadata
    // The authored children are ours: their adoption is applied as is.
    if (metadata?.surface === 'api') return
    // Undo and redo belong to the owner's history.
    if (metadata?.history) {
      event.preventDefault()
      return
    }
    if (metadata?.reconnect) {
      event.preventDefault()
      const reconnect = metadata.reconnect
      const next = detail.value.edges.find((edge) => edge.id === reconnect.edgeId)
      if (next) queueMicrotask(() => this.applyReconnect(reconnect.edgeId, next))
      return
    }
    // A property edit inside a node body: the widget keeps the new value and the owner applies it.
    if (metadata?.surface === 'node' && metadata.nodeId && metadata.property) {
      const data = metadata.changes?.find((change) => change.type === 'node-data')?.data
      if (data) this.nodeConfigs.get(metadata.nodeId)?.onPropertyChange?.(metadata.property, data[metadata.property], 'propose')
      return
    }
    const changes = metadata?.changes ?? []
    if (!changes.every((change) => GEOMETRY_CHANGES.has(change.type))) {
      event.preventDefault()
      return
    }
    if (changes.some((change) => change.type === 'node-position')) {
      this.positionsDirty = true
      if (!this.positionTransactionActive && this.flow.dragging) {
        this.positionTransactionActive = true
        this.config?.onNodePositionTransactionStart?.()
      }
    }
  }

  private readonly onValueCommit = (event: Event): void => {
    if (event.target !== this.flow) return
    const metadata = (event as CustomEvent<{ metadata?: FlowChangeMeta }>).detail?.metadata
    if (metadata?.surface === 'node' && metadata.nodeId && metadata.property) {
      const value = this.flow.nodes.find((node) => node.id === metadata.nodeId)?.data[metadata.property]
      this.nodeConfigs.get(metadata.nodeId)?.onPropertyChange?.(metadata.property, value, 'commit')
      return
    }
    if (this.positionsDirty) {
      this.positionsDirty = false
      this.savePositions({ history: 'skip' })
    }
    if (this.positionTransactionActive) {
      this.positionTransactionActive = false
      this.config?.onNodePositionTransactionEnd?.()
    }
  }

  // Dragging a wire's end to another socket re-routes it: the old connection goes, the new one is drawn.
  private applyReconnect(id: string, next: FlowEdge): void {
    const previous = this.flow.edges.find((edge) => edge.id === id)
    if (!previous) return
    this.config?.onDisconnect?.(fromFlowEdge(previous))
    this.removeEdgeElement(id)
    this.applyConnection(fromFlowEdge(next))
  }

  private readonly onConnect = (event: Event): void => {
    event.preventDefault()
    const { connection } = (event as CustomEvent<{ connection: FlowEdge }>).detail
    this.applyConnection(fromFlowEdge(connection))
  }

  private readonly onDelete = (event: Event): void => {
    event.preventDefault()
    const { nodes, edges } = (event as CustomEvent<{ nodes: FlowNode[]; edges: FlowEdge[] }>).detail
    this.deleteElements(
      nodes.map((node) => node.id),
      edges.map((edge) => edge.id),
    )
  }

  private readonly onViewportChange = (): void => {
    if (!this.restoringView) queueMicrotask(() => this.saveViewState())
  }

  // A double-click on a node (not its controls or ports): groups open their subgraph, any other node is
  // framed at 100%. The widget captures the pointer on press, so the topmost node is found under the pointer
  // (the authored node elements are in the page's tree).
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const onControl = event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement &&
          (target.classList.contains('fe-node__controls') || target.localName === 'tp-flow-port'),
      )
    if (onControl) return
    const host = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.localName === 'tp-flow-node' && this.nodeElements.has(element.id))
    const node = host ? this.nodeConfigs.get(host.id) : undefined
    if (!node) return
    if (node.onEnter) node.onEnter()
    else void this.focusNode(node.id)
  }

  // Esc leaves one group level (unless typing in a field).
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open_ || event.key !== 'Escape' || !this.config?.onExit || this.renamingNodeId) return
    const target = event.composedPath()[0] as HTMLElement | undefined
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    event.preventDefault()
    this.config.onExit()
  }

  private readonly onGraphAutoLayout = (event: Event): void => {
    if (!this.open_) return
    const arrangement = (event as GraphAutoLayoutEvent).detail?.arrangement
    if (arrangement && LAYOUT_ARRANGEMENTS.includes(arrangement)) this.setLayoutArrangement(arrangement)
  }

  // --- view and layout -----------------------------------------------------------------------------

  // Lay the graph out in the chosen direction with the widget's layered layout (measured node sizes),
  // mirroring it for the upward and leftward arrangements, then frame it.
  private async arrangeGraph(options?: EditorHistoryUpdateOptions): Promise<void> {
    await this.whenMeasured()
    if (this.nodeElements.size === 0) return
    const model = this.flow.model
    // Every node has been measured by now; an unmeasured one would lay out at its origin.
    const source = {
      get nodes() {
        return model.nodes
      },
      get edges() {
        return model.edges
      },
      nodeRect: (id: string) => model.nodeRect(id) ?? { x: 0, y: 0, width: 0, height: 0 },
      absolutePosition: (id: string) => model.absolutePosition(id) ?? { x: 0, y: 0 },
      ports: (id: string) => model.ports(id),
      definitionOf: (node: FlowNode | string) => model.definitionOf(node),
      getNode: (id: string) => model.getNode(id),
    }
    const vertical = this.layoutArrangement === 'down' || this.layoutArrangement === 'up'
    const result = layoutFlow(source, vertical ? 'vertical' : 'horizontal', {
      nodeSpacing: LAYOUT_NODE_SPACING,
      rankSpacing: LAYOUT_RANK_SPACING,
    })
    const targets = new Map<string, Point>()
    for (const [id, point] of result.positions) {
      const size = result.sizes.get(id) ?? { width: 0, height: 0 }
      const element = this.nodeElements.get(id)
      if (!element) continue
      const target =
        this.layoutArrangement === 'up'
          ? { x: point.x, y: -point.y - size.height }
          : this.layoutArrangement === 'left'
            ? { x: -point.x - size.width, y: point.y }
            : point
      setPosition(element, target)
      targets.set(id, target)
    }
    await this.whenPositioned(targets)
    this.savePositions(options)
    await this.frameGraph(options)
  }

  // Fit the whole graph into the canvas once its nodes have their final sizes.
  private async frameGraph(options?: EditorHistoryUpdateOptions): Promise<void> {
    await this.whenMeasured()
    await this.flow.fitViewTo({ duration: 0 })
    this.saveViewState(options)
  }

  // Node sizes follow their rendered boxes (fonts, mounted controls), which settle over a few frames after a
  // rebuild; a fit or layout before then frames stale sizes. Wait (a short while at most) until the graph's
  // bounds hold still across consecutive frames.
  private async whenMeasured(): Promise<void> {
    await document.fonts.ready
    let previous = ''
    for (let frame = 0, stable = 0; frame < 30 && stable < 3; frame++) {
      await nextFrame()
      const { x, y, width, height } = this.flow.getNodesBounds()
      const bounds = `${x},${y},${width},${height}`
      stable = bounds === previous ? stable + 1 : 0
      previous = bounds
    }
  }

  // The widget adopts moved children on its own schedule; wait (a few frames at most) until its document
  // holds the new positions, so they are what gets saved and framed.
  private async whenPositioned(targets: Map<string, Point>): Promise<void> {
    const placed = () =>
      this.flow.nodes.every((node) => {
        const target = targets.get(node.id)
        return !target || (node.position.x === target.x && node.position.y === target.y)
      })
    for (let frame = 0; frame < 10 && !placed(); frame++) await nextFrame()
    await nextFrame()
  }

  private async focusNode(nodeId: string): Promise<void> {
    const rect = this.flow.getNodesBounds([nodeId])
    await this.flow.setCenter({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { zoom: NODE_FOCUS_ZOOM })
  }

  private async restoreViewport(viewport: { x: number; y: number; zoom: number }): Promise<void> {
    this.restoringView = true
    await this.flow.setViewport(viewport, { duration: 0 })
    this.restoringView = false
  }

  private viewportCentre(): Point {
    const rect = this.canvasHost.getBoundingClientRect()
    return this.flow.screenToFlow({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  private savePositions(options?: EditorHistoryUpdateOptions): void {
    const positions = Object.fromEntries(this.flow.nodes.map((node) => [node.id, { ...node.position }]))
    this.config?.onNodePositionsChange?.(positions, options)
  }

  private saveViewState(options: EditorHistoryUpdateOptions = { history: 'skip' }): void {
    if (!this.config || this.restoringView) return
    const { x, y, zoom } = this.flow.viewport
    this.config.onEditorViewStateChange?.({ layoutArrangement: this.layoutArrangement, transform: { x, y, k: zoom } }, options)
  }
}

type FlowChangeMeta = {
  changes?: ReadonlyArray<{ type: string; data?: Record<string, unknown> }>
  history?: 'undo' | 'redo'
  surface?: string
  nodeId?: string
  property?: string
  reconnect?: { edgeId: string; end: 'source' | 'target' }
}

function definitionFor(node: EditorNodeConfig): FlowNodeDefinition {
  return {
    type: node.id,
    label: node.title,
    shape: 'panel',
    tone: node.nodeClass ? CLASS_TONE[node.nodeClass] : undefined,
    properties: (node.properties ?? []).map((property) => ({
      key: property.key,
      label: property.label,
      control: property.control,
      min: property.min,
      max: property.max,
      step: property.step,
      options: property.options?.map((option) => ({ value: option, label: option })),
    })),
    ports: [
      ...(node.outputs ?? []).map((socket) => ({
        id: flowPortId('output', socket.key),
        label: socket.label,
        direction: 'output' as const,
        dataType: socket.kind,
        side: 'right' as const,
      })),
      // A drop on a connected input replaces its wire (applyConnection), so the widget must let it through.
      ...(node.inputs ?? []).map((socket) => ({
        id: flowPortId('input', socket.key),
        label: socket.label,
        direction: 'input' as const,
        dataType: socket.kind,
        side: 'left' as const,
        multiple: true,
      })),
    ],
  }
}

function edgeId(connection: EditorConnectionConfig): string {
  return `${connection.from}:${connection.fromOutput}->${connection.to}:${connection.toInput}`
}

function fromFlowEdge(edge: { source: string; sourcePort?: string; target: string; targetPort?: string }): EditorConnectionConfig {
  return {
    from: edge.source,
    fromOutput: socketKey('output', edge.sourcePort),
    to: edge.target,
    toInput: socketKey('input', edge.targetPort),
  }
}

// Material sockets are keyed within their direction; Flow port IDs must be unique across a node.
// Keep that UI identity out of material documents and controller callbacks.
function flowPortId(direction: 'input' | 'output', key: string): string {
  return `${direction}:${key}`
}

function socketKey(direction: 'input' | 'output', id = ''): string {
  return id.startsWith(`${direction}:`) ? id.slice(direction.length + 1) : id
}

function setPosition(element: HTMLElement, point: Point): void {
  element.setAttribute('x', String(point.x))
  element.setAttribute('y', String(point.y))
}

function focusAndSelect(input: TpInput): void {
  void input.updateComplete.then(() => {
    const field = input.querySelector('input')
    field?.focus()
    field?.select()
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

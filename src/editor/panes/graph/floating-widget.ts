import "./floating-widget.css";

// A string naming one of 8 anchors (plus dead-center), tokens in ANY order: "top-left", "center-top",
// "right-center", "bottom-right", … `top`/`bottom` pick the vertical anchor (else vertical-center);
// `left`/`right` pick the horizontal (else horizontal-center); a `center` token is a filler no-op.
export type FloatingAlign = string;
export type FloatingOrientation = "horizontal" | "vertical";

export interface FloatingWidgetOptions {
  // Where to mount — must be a positioned (relative/absolute) container (e.g. the editor canvas host).
  mount: HTMLElement;
  align: FloatingAlign;
  orientation?: FloatingOrientation;
  // Extra class(es) on the root, for per-widget sizing/tweaks.
  className?: string;
  title?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  // localStorage key to persist the collapsed state under (optional).
  persistKey?: string;
  // Render the right-aligned summary slot in the header.
  extraInfo?: boolean;
}

const EDGE_MARGIN = "12px";

function anchorStyles(align: FloatingAlign): Partial<CSSStyleDeclaration> {
  const tokens = new Set(align.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  const top = tokens.has("top");
  const bottom = tokens.has("bottom");
  const left = tokens.has("left");
  const right = tokens.has("right");

  const style: Partial<CSSStyleDeclaration> = {};
  const transforms: string[] = [];

  if (top) style.top = EDGE_MARGIN;
  else if (bottom) style.bottom = EDGE_MARGIN;
  else {
    style.top = "50%";
    transforms.push("translateY(-50%)");
  }

  if (left) style.left = EDGE_MARGIN;
  else if (right) style.right = EDGE_MARGIN;
  else {
    style.left = "50%";
    transforms.push("translateX(-50%)");
  }

  style.transform = transforms.join(" ");
  return style;
}

// A reusable floating panel: 8-anchor positioning, optional title + collapse + right-aligned extra
// info, horizontal/vertical body. Self-contained DOM — imports nothing from Rete.
export class FloatingWidget {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly header: HTMLDivElement | null = null;
  private readonly summaryEl: HTMLSpanElement | null = null;
  private readonly persistKey?: string;
  private collapsed: boolean;

  constructor(opts: FloatingWidgetOptions) {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      el.className = cls;
      return el;
    };

    this.persistKey = opts.persistKey;
    this.collapsed =
      (opts.persistKey ? localStorage.getItem(opts.persistKey) === "1" : undefined) ??
      opts.collapsed ??
      false;

    this.root = make("div", "floating-widget");
    if (opts.className) this.root.classList.add(...opts.className.split(/\s+/).filter(Boolean));
    Object.assign(this.root.style, anchorStyles(opts.align));

    const hasHeader = Boolean(opts.title || opts.collapsible || opts.extraInfo);
    if (hasHeader) {
      this.header = make("div", "floating-widget__header");
      if (opts.title) {
        const title = make("span", "floating-widget__title");
        title.textContent = opts.title;
        this.header.appendChild(title);
      }
      if (opts.extraInfo) {
        this.summaryEl = make("span", "floating-widget__summary");
        this.header.appendChild(this.summaryEl);
      }
      if (opts.collapsible) {
        const chevron = make("span", "floating-widget__chevron");
        chevron.textContent = "▾";
        this.header.appendChild(chevron);
        this.header.classList.add("floating-widget__header--collapsible");
        this.header.addEventListener("click", () => this.setCollapsed(!this.collapsed));
      }
      this.root.appendChild(this.header);
    }

    this.body = make("div", "floating-widget__body");
    this.body.classList.add(
      opts.orientation === "horizontal" ? "floating-widget__body--horizontal" : "floating-widget__body--vertical",
    );
    this.root.appendChild(this.body);

    this.applyCollapsed();
    opts.mount.appendChild(this.root);
  }

  setTitle(text: string): void {
    const title = this.header?.querySelector<HTMLSpanElement>(".floating-widget__title");
    if (title) title.textContent = text;
  }

  setSummary(text: string): void {
    if (this.summaryEl) this.summaryEl.textContent = text;
  }

  setBusy(busy: boolean): void {
    this.root.classList.toggle("floating-widget--busy", busy);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    if (this.persistKey) localStorage.setItem(this.persistKey, collapsed ? "1" : "0");
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.root.classList.toggle("floating-widget--collapsed", this.collapsed);
  }

  dispose(): void {
    this.root.remove();
  }
}

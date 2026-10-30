import { createElement as createLucideElement, type IconNode } from "lucide";
import type { TpButton, TpCollapsible, TpToggle } from "@tweakpad/ui";

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

const EDGE_MARGIN = "var(--tp-space-3)";

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

// A lucide icon sized by the TweakPad control it sits in (1em follows the control's icon extent).
export function lucideIcon(icon: IconNode): SVGElement {
  return createLucideElement(icon, { "aria-hidden": "true", height: "1em", stroke: "currentColor", width: "1em" });
}

// A lucide icon placed in a TweakPad button's leading icon slot.
export function iconSlot(icon: IconNode): SVGElement {
  const svg = lucideIcon(icon);
  svg.setAttribute("slot", "icon-start");
  return svg;
}

// A reusable floating panel: 8-anchor positioning, optional collapsible title + right-aligned extra info,
// horizontal/vertical body of TweakPad controls. Self-contained DOM — imports nothing from the graph editor.
export class FloatingWidget {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly orientation: FloatingOrientation;
  private readonly titleEl: HTMLSpanElement | null = null;
  private readonly summaryEl: HTMLSpanElement | null = null;
  private readonly collapsible: TpCollapsible | null = null;
  private readonly persistKey?: string;

  constructor(opts: FloatingWidgetOptions) {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      el.className = cls;
      return el;
    };

    this.orientation = opts.orientation ?? "vertical";
    this.persistKey = opts.persistKey;
    const collapsed =
      (opts.persistKey ? localStorage.getItem(opts.persistKey) === "1" : undefined) ??
      opts.collapsed ??
      false;

    this.root = make("div", "floating-widget");
    if (opts.className) this.root.classList.add(...opts.className.split(/\s+/).filter(Boolean));
    Object.assign(this.root.style, anchorStyles(opts.align));

    this.body = make("div", "floating-widget__body");
    this.body.classList.add(`floating-widget__body--${this.orientation}`);

    if (opts.title || opts.extraInfo) {
      this.titleEl = make("span", "floating-widget__title");
      this.titleEl.textContent = opts.title ?? "";
      if (opts.extraInfo) this.summaryEl = make("span", "floating-widget__summary");
    }

    if (opts.collapsible) {
      // A TweakPad Collapsible: the title is its trigger label, the summary sits on the trigger's
      // trailing side and the body is its content.
      const collapsible = document.createElement("tp-collapsible") as TpCollapsible;
      collapsible.className = "floating-widget__collapsible";
      collapsible.setAttribute("indicator-position", "leading");
      collapsible.open = !collapsed;
      if (this.titleEl) {
        this.titleEl.slot = "label";
        collapsible.appendChild(this.titleEl);
      }
      if (this.summaryEl) {
        this.summaryEl.slot = "trailing";
        collapsible.appendChild(this.summaryEl);
      }
      collapsible.appendChild(this.body);
      // The summary repeats the body in brief, so it shows beside the title only while collapsed.
      if (this.summaryEl) this.summaryEl.hidden = !collapsed;
      collapsible.addEventListener("tp-open-change", (event) => {
        if (event.target !== collapsible) return;
        const open = (event as CustomEvent<{ value: boolean }>).detail.value;
        if (this.summaryEl) this.summaryEl.hidden = open;
        this.persistCollapsed(!open);
      });
      this.collapsible = collapsible;
      this.root.appendChild(collapsible);
    } else {
      if (this.titleEl) {
        const header = make("div", "floating-widget__header");
        header.appendChild(this.titleEl);
        if (this.summaryEl) header.appendChild(this.summaryEl);
        this.root.appendChild(header);
      }
      this.root.appendChild(this.body);
    }

    opts.mount.appendChild(this.root);
  }

  setTitle(text: string): void {
    if (this.titleEl) this.titleEl.textContent = text;
  }

  setSummary(text: string): void {
    if (this.summaryEl) this.summaryEl.textContent = text;
  }

  setBusy(busy: boolean): void {
    this.root.classList.toggle("floating-widget--busy", busy);
  }

  // An icon-only action button.
  addButton(icon: IconNode, label: string, onClick: () => void): TpButton {
    const button = document.createElement("tp-button") as TpButton;
    button.variant = "ghost";
    button.size = "icon-sm";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(iconSlot(icon));
    button.addEventListener("click", onClick);
    this.body.appendChild(button);
    return button;
  }

  // An icon-only on/off control. The widget owns its pressed state (set `pressed`); a press runs `onClick`
  // instead of flipping the toggle itself, so a re-press can re-apply an already-active choice.
  addToggle(icon: IconNode, label: string, onClick: () => void): TpToggle {
    const toggle = document.createElement("tp-toggle") as TpToggle;
    toggle.size = "icon-sm";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.appendChild(lucideIcon(icon));
    toggle.addEventListener("tp-value-change", (event) => {
      if (event.target !== toggle) return;
      // Refuse the toggle's own flip; the widget sets `pressed` once the refused proposal has settled.
      event.preventDefault();
      queueMicrotask(onClick);
    });
    this.body.appendChild(toggle);
    return toggle;
  }

  // A divider between groups of controls, across the body's direction.
  addSeparator(): void {
    const separator = document.createElement("tp-separator");
    separator.setAttribute("orientation", this.orientation === "horizontal" ? "vertical" : "horizontal");
    this.body.appendChild(separator);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsible) this.collapsible.open = !collapsed;
    if (this.collapsible && this.summaryEl) this.summaryEl.hidden = !collapsed;
    this.persistCollapsed(collapsed);
  }

  private persistCollapsed(collapsed: boolean): void {
    if (this.persistKey) localStorage.setItem(this.persistKey, collapsed ? "1" : "0");
  }

  dispose(): void {
    this.root.remove();
  }
}

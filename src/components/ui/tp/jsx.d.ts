import type { DetailedHTMLProps, HTMLAttributes } from "react";

// JSX typings for the TweakPad custom elements the primitives render. React 19 assigns props that exist
// on an upgraded element as properties (open, sizes, value…) and everything else as attributes, so the
// element-specific props stay loosely typed here; the primitives own the typed public API.
type TpElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  [prop: string]: unknown;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tp-alert": TpElementProps;
      "tp-alert-dialog": TpElementProps;
      "tp-breadcrumb": TpElementProps;
      "tp-button": TpElementProps;
      "tp-checkbox": TpElementProps;
      "tp-description-list": TpElementProps;
      "tp-description-list-item": TpElementProps;
      "tp-dialog": TpElementProps;
      "tp-empty-state": TpElementProps;
      "tp-field": TpElementProps;
      "tp-input": TpElementProps;
      "tp-key-hint": TpElementProps;
      "tp-key-hint-group": TpElementProps;
      "tp-markdown": TpElementProps;
      "tp-menu": TpElementProps;
      "tp-menu-item": TpElementProps;
      "tp-menubar": TpElementProps;
      "tp-resizable-handle": TpElementProps;
      "tp-resizable-panel": TpElementProps;
      "tp-resizable-panel-group": TpElementProps;
      "tp-scroll-area": TpElementProps;
      "tp-select": TpElementProps;
      "tp-separator": TpElementProps;
      "tp-spinner": TpElementProps;
      "tp-switch": TpElementProps;
      "tp-time": TpElementProps;
      "tp-toggle": TpElementProps;
      "tp-toggle-group": TpElementProps;
      "tp-tooltip": TpElementProps;
    }
  }
}

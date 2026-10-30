import {
  TpButton,
  TpCheckbox,
  TpDialog,
  TpKeyHint,
  TpKeyHintGroup,
  TpMenu,
  TpMenuItem,
  TpMenubar,
  TpPopover,
  TpResizableHandle,
  TpResizablePanel,
  TpResizablePanelGroup,
  TpSelect,
  TpSeparator,
  TpSwitch,
  TpToggle,
  TpToggleGroup,
  TpTooltip,
  defineElement,
} from "@tweakpad/ui";

// Define only the TweakPad elements the app's primitives render. `defineElement` also defines the library
// elements each one renders internally, so this stays the complete list of what the app uses.
const ELEMENTS: Array<CustomElementConstructor & { readonly tagName: string }> = [
  TpButton,
  TpCheckbox,
  TpDialog,
  TpKeyHint,
  TpKeyHintGroup,
  TpMenu,
  TpMenuItem,
  TpMenubar,
  TpPopover,
  TpResizableHandle,
  TpResizablePanel,
  TpResizablePanelGroup,
  TpSelect,
  TpSeparator,
  TpSwitch,
  TpToggle,
  TpToggleGroup,
  TpTooltip,
];

for (const element of ELEMENTS) defineElement(element.tagName, element);

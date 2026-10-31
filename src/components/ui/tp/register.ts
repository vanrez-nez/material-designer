import { TpFlow } from "@tweakpad/ui/widgets";
import {
  TpBadge,
  TpButton,
  TpCollapsible,
  TpDialog,
  TpInput,
  TpNativeSelect,
  TpProgress,
  TpSeparator,
  TpToggle,
  TpToggleGroup,
  defineElement,
} from "@tweakpad/ui";

// Define the TweakPad elements the app creates outside React: the imperative scene toolbars, the graph
// editor's Flow widget and its node widgets, and the bake panel. React components from `@tweakpad/ui/react`
// define their own element on first render. `defineElement` also defines the library elements each one
// renders internally, so this stays the complete list of what the imperative code uses.
const ELEMENTS: Array<CustomElementConstructor & { readonly tagName: string }> = [
  TpBadge,
  TpButton,
  TpCollapsible,
  TpDialog,
  TpFlow,
  TpInput,
  TpNativeSelect,
  TpProgress,
  TpSeparator,
  TpToggle,
  TpToggleGroup,
];

for (const element of ELEMENTS) defineElement(element.tagName, element);

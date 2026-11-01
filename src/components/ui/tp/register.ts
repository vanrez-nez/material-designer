import { TpColorPicker, TpFlow } from "@tweakpad/ui/widgets";
import {
  TpBadge,
  TpButton,
  TpCollapsible,
  TpColorInput,
  TpDialog,
  TpInput,
  TpNativeSelect,
  TpProgress,
  TpSelect,
  TpSeparator,
  TpSlider,
  TpSwitch,
  TpTabs,
  TpToggle,
  TpToggleGroup,
  defineElement,
} from "@tweakpad/ui";

// Define the TweakPad elements the app creates outside React: the imperative scene toolbars and Controls
// panel, the graph editor's Flow widget and its node widgets (curves, group interfaces), and the bake
// panel. React components from `@tweakpad/ui/react` define their own element on first render.
// `defineElement` also defines the library elements each one renders internally, so this stays the
// complete list of what the imperative code uses.
const ELEMENTS: Array<CustomElementConstructor & { readonly tagName: string }> = [
  TpBadge,
  TpButton,
  TpCollapsible,
  TpColorInput,
  TpColorPicker,
  TpDialog,
  TpFlow,
  TpInput,
  TpNativeSelect,
  TpProgress,
  TpSelect,
  TpSeparator,
  TpSlider,
  TpSwitch,
  TpTabs,
  TpToggle,
  TpToggleGroup,
];

for (const element of ELEMENTS) defineElement(element.tagName, element);

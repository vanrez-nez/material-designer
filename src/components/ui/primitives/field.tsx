import type * as React from "react";

type FieldProps = React.HTMLAttributes<HTMLElement> & {
  description?: string;
  disabled?: boolean;
  label?: string;
  // Captions a group of peer Fields placed in the `group` slot.
  legend?: string;
  // Off for a control that opens a popup (a Select), so a click on the label does not open it twice.
  nativeLabel?: boolean;
  // Per-part style hooks (TweakPad presentation), e.g. the spacing of the `group` slot's members.
  partPresentation?: Record<string, { styleHook: Record<string, string> }>;
  legendScale?: "section" | "field";
  orientation?: "horizontal" | "vertical" | "responsive";
};

// The label, description and state around one control (tp-field). It names the control inside it, so the
// control needs no aria-label of its own.
function Field({ legendScale, ...props }: FieldProps) {
  return <tp-field data-slot="field" legend-scale={legendScale} {...props} />;
}

export { Field };

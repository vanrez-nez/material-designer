import * as React from "react";
import {
  Toggle,
  ToggleGroup as TpToggleGroup,
  type ToggleGroupProps as TpToggleGroupProps,
} from "@tweakpad/ui/react";

type ToggleGroupProps = Omit<TpToggleGroupProps, "onValueChange" | "value"> & {
  onValueChange?: (value: string) => void;
  // Single selection that can't be cleared: the selected item stays pressed when clicked again.
  value: string;
};

// One tab stop for the group. The selection is React's: a proposal is accepted by rendering it, and an empty
// one (re-pressing the selected item) is never rendered.
function ToggleGroup({ onValueChange, value, ...props }: ToggleGroupProps) {
  const selection = React.useMemo(() => [value], [value]);
  return (
    <TpToggleGroup
      onValueChange={(event) => {
        const [next] = event.detail.value;
        if (next && next !== value) onValueChange?.(next);
      }}
      value={selection}
      {...props}
    />
  );
}

export { ToggleGroup, Toggle as ToggleGroupItem };

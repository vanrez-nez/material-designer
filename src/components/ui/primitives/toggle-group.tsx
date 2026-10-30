import * as React from "react";

import { type TpValueChangeDetail, useTpEvent } from "@/components/ui/tp/hooks";

type ToggleGroupProps = Omit<React.HTMLAttributes<HTMLElement>, "onChange"> & {
  // Accessible name for the group (tp-toggle-group is one tab stop).
  label?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  size?: "xs" | "sm" | "default" | "lg";
  // Single selection that can't be cleared: the selected item stays pressed when clicked again.
  value: string;
  variant?: "default" | "outline";
};

function ToggleGroup({ onValueChange, value, ...props }: ToggleGroupProps) {
  const ref = React.useRef<HTMLElement>(null);
  const selection = React.useMemo(() => [value], [value]);

  useTpEvent<TpValueChangeDetail<string[]>>(ref, "tp-value-change", (event) => {
    // Items emit their own pressed changes; only the group's selection proposal matters here.
    if (event.target !== ref.current) return;
    // Controlled: React state drives `value`; an empty proposal (re-pressing the selection) is refused.
    event.preventDefault();
    const [next] = event.detail.value;
    if (next && next !== value) onValueChange?.(next);
  });

  return <tp-toggle-group ref={ref} data-slot="toggle-group" value={selection} {...props} />;
}

type ToggleGroupItemProps = React.HTMLAttributes<HTMLElement> & {
  disabled?: boolean;
  value: string;
};

function ToggleGroupItem(props: ToggleGroupItemProps) {
  return <tp-toggle data-slot="toggle-group-item" {...props} />;
}

export { ToggleGroup, ToggleGroupItem };

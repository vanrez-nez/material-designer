import type * as React from "react";
import {
  Menu as TpMenu,
  MenuItem as TpMenuItem,
  type MenuItemProps as TpMenuItemProps,
  Separator,
} from "@tweakpad/ui/react";

import { withSlot } from "@/components/ui/tp/hooks";

// A command menu opened from a trigger. Rendered without a portal so items stay inside the React root; items
// close the menu when activated.
function Menu({
  align = "center",
  children,
  label,
}: {
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
  label?: string;
}) {
  return (
    <TpMenu align={align} label={label} portal={false}>
      {children}
    </TpMenu>
  );
}

function MenuTrigger({ children }: { asChild?: boolean; children?: React.ReactNode }) {
  return withSlot(children, "trigger");
}

type MenuItemProps = Omit<TpMenuItemProps, "onClick" | "onSelect" | "variant"> & {
  // Activation by pointer, Enter or Space.
  onSelect?: () => void;
  variant?: "default" | "destructive";
};

function MenuItem({ onSelect, variant = "default", ...props }: MenuItemProps) {
  return (
    <TpMenuItem
      onClick={() => onSelect?.()}
      variant={variant === "destructive" ? "destructive" : undefined}
      {...props}
    />
  );
}

function MenuSeparator() {
  return <Separator />;
}

export { Menu, MenuItem, MenuSeparator, MenuTrigger };

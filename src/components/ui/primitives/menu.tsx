import * as React from "react";

import { withSlot } from "@/components/ui/tp/hooks";

// A command menu opened from a trigger (tp-menu). Rendered without a portal so items stay inside the React
// root; items close the menu when activated.
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
    <tp-menu data-slot="menu" align={align} label={label} portal={false}>
      {children}
    </tp-menu>
  );
}

function MenuTrigger({ children }: { asChild?: boolean; children?: React.ReactNode }) {
  return withSlot(children, "trigger", { "data-slot": "menu-trigger" });
}

type MenuItemProps = Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> & {
  disabled?: boolean;
  onSelect?: () => void;
  variant?: "default" | "destructive";
};

function MenuItem({ onSelect, variant = "default", ...props }: MenuItemProps) {
  const ref = React.useRef<HTMLElement>(null);
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  // Activation (click, Enter/Space) is reported as `tp-action` on the owning menu, naming the item.
  React.useEffect(() => {
    const item = ref.current;
    const menu = item?.closest("tp-menu");
    if (!item || !menu) return undefined;
    const onAction = (event: Event) => {
      if ((event as CustomEvent<{ item?: Element }>).detail?.item === item) onSelectRef.current?.();
    };
    menu.addEventListener("tp-action", onAction);
    return () => menu.removeEventListener("tp-action", onAction);
  }, []);

  return (
    <tp-menu-item
      ref={ref}
      data-slot="menu-item"
      variant={variant === "destructive" ? "destructive" : undefined}
      {...props}
    />
  );
}

function MenuSeparator() {
  return <tp-separator data-slot="menu-separator" />;
}

export { Menu, MenuItem, MenuSeparator, MenuTrigger };

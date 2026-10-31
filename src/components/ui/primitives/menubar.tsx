import * as React from "react";
import type { TpMenubar as TpMenubarElement } from "@tweakpad/ui";
import {
  Button,
  Menu,
  Menubar as TpMenubar,
  type MenubarProps as TpMenubarProps,
  Separator,
} from "@tweakpad/ui/react";

import { MenuItem } from "@/components/ui/primitives/menu";

// tp-menubar coordinates its tp-menu children (one open at a time, arrow keys between triggers). Menus render
// without a portal so their items stay inside the React root (and inside the app's menubar element).

type MenubarProps = Omit<TpMenubarProps, "onValueChange" | "ref" | "value"> & {
  // Always accepted: the menubar opens the proposed menu as it reports it.
  onValueChange?: (value: string) => void;
  // The open menu's value ("" when closed).
  value?: string;
};

function Menubar({ onValueChange, value, ...props }: MenubarProps) {
  const ref = React.useRef<TpMenubarElement>(null);

  // Non-modal, like the app's previous menubar: an open menu leaves the rest of the page interactive.
  return (
    <TpMenubar
      ref={ref}
      data-slot="menubar"
      modal={false}
      onValueChange={(event) => {
        const next = String(event.detail.value ?? "");
        // Accept the proposal while it is reported, as TweakPad documents for a controlled owner: a menu
        // opened from the keyboard then lands on its first item, which accepting on a later render loses.
        if (value !== undefined && ref.current) ref.current.value = next;
        onValueChange?.(next);
      }}
      value={value}
      {...props}
    />
  );
}

const MenuAlignContext = React.createContext<((align: "start" | "center" | "end") => void) | null>(
  null,
);

function MenubarMenu({ children, value }: { children?: React.ReactNode; value?: string }) {
  const [align, setAlign] = React.useState<"start" | "center" | "end">();

  return (
    <MenuAlignContext.Provider value={setAlign}>
      <Menu align={align} portal={false} value={value}>
        {children}
      </Menu>
    </MenuAlignContext.Provider>
  );
}

function MenubarTrigger({ children }: { children?: React.ReactNode }) {
  return (
    <Button slot="trigger" size="sm" variant="ghost">
      {children}
    </Button>
  );
}

// The items render straight into the menu; the content only carries the popup alignment.
function MenubarContent({
  align = "start",
  children,
}: {
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
}) {
  const setAlign = React.useContext(MenuAlignContext);
  React.useLayoutEffect(() => setAlign?.(align), [align, setAlign]);
  return <>{children}</>;
}

// A menubar item is a menu item; `inset` aligns its label with items that carry an icon.
const MenubarItem = MenuItem;

function MenubarSeparator() {
  return <Separator />;
}

// A submenu is a nested tp-menu with its own trigger.
function MenubarSub({ children }: { children?: React.ReactNode }) {
  return (
    <Menu portal={false}>
      {children}
    </Menu>
  );
}

function MenubarSubTrigger({ children }: { children?: React.ReactNode }) {
  return (
    <Button slot="trigger" variant="ghost">
      {children}
    </Button>
  );
}

function MenubarSubContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
};

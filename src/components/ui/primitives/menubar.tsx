import * as React from "react";

import { type TpValueChangeDetail, useTpEvent } from "@/components/ui/tp/hooks";

// tp-menubar coordinates its tp-menu children (one open at a time, arrow keys between triggers). Menus render
// without a portal so their items stay inside the React root (and inside the app's menubar element).

type MenubarProps = Omit<React.HTMLAttributes<HTMLElement>, "onChange"> & {
  onValueChange?: (value: string) => void;
  // The open menu's value ("" when closed).
  value?: string;
};

function Menubar({ onValueChange, value, ...props }: MenubarProps) {
  const ref = React.useRef<HTMLElement>(null);

  useTpEvent<TpValueChangeDetail<string>>(ref, "tp-value-change", (event) => {
    if (event.target !== ref.current) return;
    // Controlled: React state drives which menu is open.
    if (value !== undefined && event.cancelable) event.preventDefault();
    onValueChange?.(String(event.detail.value ?? ""));
  });

  // Non-modal, like the app's previous menubar: an open menu leaves the rest of the page interactive.
  return <tp-menubar ref={ref} data-slot="menubar" modal={false} value={value} {...props} />;
}

const MenuAlignContext = React.createContext<((align: "start" | "center" | "end") => void) | null>(
  null,
);

function MenubarMenu({ children, value }: { children?: React.ReactNode; value?: string }) {
  const [align, setAlign] = React.useState<"start" | "center" | "end">();

  return (
    <MenuAlignContext.Provider value={setAlign}>
      <tp-menu data-slot="menubar-menu" align={align} portal={false} value={value}>
        {children}
      </tp-menu>
    </MenuAlignContext.Provider>
  );
}

function MenubarTrigger({ children }: { children?: React.ReactNode }) {
  return (
    <tp-button slot="trigger" data-slot="menubar-trigger" size="sm" variant="ghost">
      {children}
    </tp-button>
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

type MenubarItemProps = Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> & {
  disabled?: boolean;
  inset?: boolean;
  onSelect?: () => void;
  variant?: "default" | "destructive";
};

function MenubarItem({ onSelect, variant = "default", ...props }: MenubarItemProps) {
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
      data-slot="menubar-item"
      variant={variant === "destructive" ? "destructive" : undefined}
      {...props}
    />
  );
}

function MenubarSeparator() {
  return <tp-separator data-slot="menubar-separator" />;
}

// A submenu is a nested tp-menu with its own trigger.
function MenubarSub({ children }: { children?: React.ReactNode }) {
  return (
    <tp-menu data-slot="menubar-sub" portal={false}>
      {children}
    </tp-menu>
  );
}

function MenubarSubTrigger({ children }: { children?: React.ReactNode }) {
  return (
    <tp-button slot="trigger" data-slot="menubar-sub-trigger" variant="ghost">
      {children}
    </tp-button>
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

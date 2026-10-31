import { KbdGroup as TpKbdGroup, type KbdGroupProps } from "@tweakpad/ui/react";

// Shortcut labels: the caller supplies the platform-specific glyph (⌘, Ctrl, ⇧…) as the key text.
export { Kbd } from "@tweakpad/ui/react";

// Marked as a menu shortcut so a menu item lays it out at the item's end (its only use is in menus).
export function KbdGroup(props: KbdGroupProps) {
  return <TpKbdGroup data-menu-shortcut="" separator="none" {...props} />;
}

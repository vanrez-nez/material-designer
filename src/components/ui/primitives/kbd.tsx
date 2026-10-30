import type * as React from "react";

// Shortcut labels: the caller supplies the platform-specific glyph (⌘, Ctrl, ⇧…) as the key text.
function Kbd(props: React.HTMLAttributes<HTMLElement>) {
  return <tp-key-hint data-slot="kbd" {...props} />;
}

// Marked as a menu shortcut so a tp-menu-item lays it out at the item's end (its only use is in menus).
function KbdGroup(props: React.HTMLAttributes<HTMLElement>) {
  return <tp-key-hint-group data-slot="kbd-group" data-menu-shortcut="" separator="none" {...props} />;
}

export { Kbd, KbdGroup };

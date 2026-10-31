import { type ReactElement, type ReactNode, cloneElement, isValidElement, useCallback, useState } from "react";

// Open state for overlay primitives: controlled when `open` is passed, otherwise owned here.
export function useOpenState(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
): [boolean, (open: boolean) => void] {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  return [isOpen, setOpen];
}

// Radix-style `asChild` for slotted triggers: put the caller's element in a TweakPad slot.
export function withSlot(child: ReactNode, slot: string, props: Record<string, unknown> = {}): ReactNode {
  if (!isValidElement(child)) return child;
  return cloneElement(child as ReactElement<Record<string, unknown>>, { slot, ...props });
}

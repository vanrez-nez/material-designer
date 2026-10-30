import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// TweakPad reports state through `tp-*` CustomEvents. React 19 maps an `onX` prop on a custom element to an
// event literally named "X", so the primitives subscribe with a native listener instead. The handler is read
// through a ref, so callers can pass inline closures without re-binding the listener every render.
export function useTpEvent<TDetail = unknown>(
  ref: RefObject<HTMLElement | null>,
  name: string,
  handler: ((event: CustomEvent<TDetail>) => void) | undefined,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const listener = (event: Event) => handlerRef.current?.(event as CustomEvent<TDetail>);
    node.addEventListener(name, listener);
    return () => node.removeEventListener(name, listener);
  }, [ref, name]);
}

export type TpValueChangeDetail<TValue = unknown> = { value: TValue; reason?: string };

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

// A TweakPad surface's cancelable `tp-open-change` proposal (Escape, outside press, trigger, close control)
// is always refused and replayed through React state, so React stays the single source of truth for the
// `open` property it renders — and a consumer that ignores the change keeps the surface as it is.
export function useTpOpenChange(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  setOpen: (open: boolean) => void,
): void {
  useTpEvent<TpValueChangeDetail<boolean>>(ref, "tp-open-change", (event) => {
    // Nested surfaces bubble their own proposals; only this element's matter.
    if (event.target !== ref.current) return;
    if (event.cancelable) event.preventDefault();
    const next = Boolean(event.detail.value);
    if (next !== isOpen) setOpen(next);
  });
}

// Radix-style `asChild` for slotted triggers: put the caller's element in a TweakPad slot.
export function withSlot(child: ReactNode, slot: string, props: Record<string, unknown> = {}): ReactNode {
  if (!isValidElement(child)) return child;
  return cloneElement(child as ReactElement<Record<string, unknown>>, { slot, ...props });
}

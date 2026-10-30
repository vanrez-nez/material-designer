import * as React from "react";

import { type TpValueChangeDetail, useTpEvent } from "@/components/ui/tp/hooks";

type InputProps = Omit<React.HTMLAttributes<HTMLElement>, "onChange"> & {
  // Accessible name when no Field labels the input.
  label?: string;
  maxLength?: number;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
};

// What callers can do with the native editor tp-input renders in its light DOM.
type InputHandle = Pick<HTMLInputElement, "blur" | "focus" | "select">;

// tp-input renders its real <input> once it has updated, so the handle waits for it before acting.
const Input = React.forwardRef<InputHandle, InputProps>(function Input(
  { maxLength, onValueChange, value, ...props },
  ref,
) {
  const hostRef = React.useRef<HTMLElement & { updateComplete?: Promise<unknown> }>(null);

  React.useImperativeHandle(ref, () => {
    const withEditor = (action: (input: HTMLInputElement) => void) => {
      const host = hostRef.current;
      const input = host?.querySelector("input");
      if (input) action(input);
      else void host?.updateComplete?.then(() => {
        const ready = host.querySelector("input");
        if (ready) action(ready);
      });
    };
    return {
      blur: () => withEditor((input) => input.blur()),
      focus: (options?: FocusOptions) => withEditor((input) => input.focus(options)),
      select: () => withEditor((input) => input.select()),
    };
  }, []);

  useTpEvent<TpValueChangeDetail<string>>(hostRef, "tp-value-change", (event) => {
    if (event.target !== hostRef.current) return;
    onValueChange?.(String(event.detail.value ?? ""));
  });

  return (
    <tp-input ref={hostRef} data-slot="input" maxlength={maxLength} value={value} {...props} />
  );
});

export { Input, type InputHandle };

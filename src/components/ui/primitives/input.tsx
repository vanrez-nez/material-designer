import * as React from "react";
import type { TpInput } from "@tweakpad/ui";
import { Input as TpInputBinding, type InputProps as TpInputProps } from "@tweakpad/ui/react";

type InputProps = Omit<TpInputProps, "onValueChange" | "ref"> & {
  onValueChange?: (value: string) => void;
};

// What callers can do with the native editor tp-input renders in its light DOM.
type InputHandle = Pick<HTMLInputElement, "blur" | "focus" | "select">;

// tp-input renders its real <input> once it has updated, so the handle waits for it before acting.
const Input = React.forwardRef<InputHandle, InputProps>(function Input({ onValueChange, ...props }, ref) {
  const hostRef = React.useRef<TpInput>(null);

  React.useImperativeHandle(ref, () => {
    const withEditor = (action: (input: HTMLInputElement) => void) => {
      const host = hostRef.current;
      const input = host?.querySelector("input");
      if (input) action(input);
      else void host?.updateComplete.then(() => {
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

  return (
    <TpInputBinding
      ref={hostRef}
      onValueChange={(event) => onValueChange?.(String(event.detail.value ?? ""))}
      {...props}
    />
  );
});

export { Input, type InputHandle };

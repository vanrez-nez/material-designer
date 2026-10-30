import * as React from "react";

import { type TpValueChangeDetail, useTpEvent } from "@/components/ui/tp/hooks";

type CheckboxProps = Omit<React.HTMLAttributes<HTMLElement>, "onChange"> & {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  name?: string;
  onCheckedChange?: (checked: boolean) => void;
  required?: boolean;
};

function Checkbox({ checked, onCheckedChange, ...props }: CheckboxProps) {
  const ref = React.useRef<HTMLElement>(null);
  const controlled = checked !== undefined;

  useTpEvent<TpValueChangeDetail<boolean>>(ref, "tp-value-change", (event) => {
    // Controlled: let React state drive `checked` instead of the element toggling itself.
    if (controlled && event.cancelable) event.preventDefault();
    onCheckedChange?.(Boolean(event.detail.value));
  });

  return <tp-checkbox ref={ref} data-slot="checkbox" checked={checked} {...props} />;
}

export { Checkbox };

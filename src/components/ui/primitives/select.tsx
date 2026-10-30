import * as React from "react";

import { type TpValueChangeDetail, useTpEvent } from "@/components/ui/tp/hooks";

type SelectTriggerProps = Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  children?: React.ReactNode;
  size?: "sm" | "default";
};

// tp-select names its combobox from `label`.
type SelectHostProps = Pick<SelectTriggerProps, "className" | "id"> & { label?: string };

const SelectTriggerContext = React.createContext<((props: SelectHostProps) => void) | null>(null);

type SelectProps = {
  children?: React.ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
};

// tp-select is the whole control: it reads its choices from <option> children and renders its own trigger
// and list. SelectTrigger contributes the host attributes (aria-label, class…); SelectContent/SelectItem
// become the options.
function Select({ children, disabled, onValueChange, value }: SelectProps) {
  const ref = React.useRef<HTMLElement>(null);
  const [hostProps, setHostProps] = React.useState<SelectHostProps>({});

  // The element commits the pick itself (canceling the proposal would also cancel close-on-select); React
  // mirrors it through onValueChange and the `value` property.
  useTpEvent<TpValueChangeDetail<string>>(ref, "tp-value-change", (event) => {
    if (event.target !== ref.current) return;
    onValueChange?.(String(event.detail.value));
  });

  return (
    <SelectTriggerContext.Provider value={setHostProps}>
      <tp-select ref={ref} data-slot="select" disabled={disabled} value={value} {...hostProps}>
        {children}
      </tp-select>
    </SelectTriggerContext.Provider>
  );
}

function SelectTrigger({ "aria-label": ariaLabel, className, id }: SelectTriggerProps) {
  const setHostProps = React.useContext(SelectTriggerContext);
  if (!setHostProps) throw new Error("SelectTrigger must be rendered inside <Select>.");

  React.useLayoutEffect(() => {
    setHostProps({ className, id, label: ariaLabel });
  }, [ariaLabel, className, id, setHostProps]);

  return null;
}

// tp-select renders the selected option's label itself.
function SelectValue(_props: { placeholder?: string }) {
  return null;
}

function SelectContent({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SelectItem({
  children,
  disabled,
  value,
}: {
  children?: React.ReactNode;
  disabled?: boolean;
  value: string;
}) {
  return (
    <option data-slot="select-item" disabled={disabled} value={value}>
      {children}
    </option>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };

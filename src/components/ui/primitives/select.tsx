import * as React from "react";
import { Select as TpSelect } from "@tweakpad/ui/react";

type SelectTriggerProps = {
  "aria-label"?: string;
  children?: React.ReactNode;
  className?: string;
  id?: string;
  size?: "sm" | "default";
};

// tp-select names its combobox from `label`.
type SelectHostProps = { className?: string; id?: string; label?: string };

const SelectTriggerContext = React.createContext<((props: SelectHostProps) => void) | null>(null);

type SelectProps = {
  children?: React.ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
};

// tp-select is the whole control: it reads its choices from <option> children and renders its own trigger
// and list. SelectTrigger contributes the host attributes (aria-label, class…); SelectContent/SelectItem
// become the options. A controlled owner accepts a pick by rendering it as `value`.
function Select({ children, disabled, onValueChange, value }: SelectProps) {
  const [hostProps, setHostProps] = React.useState<SelectHostProps>({});

  return (
    <SelectTriggerContext.Provider value={setHostProps}>
      <TpSelect
        disabled={disabled}
        onValueChange={(event) => onValueChange?.(String(event.detail.value))}
        value={value}
        {...hostProps}
      >
        {children}
      </TpSelect>
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
    <option disabled={disabled} value={value}>
      {children}
    </option>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };

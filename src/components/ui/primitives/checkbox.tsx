import { Checkbox as TpCheckbox, type CheckboxProps as TpCheckboxProps } from "@tweakpad/ui/react";

type CheckboxProps = Omit<TpCheckboxProps, "onCheckedChange"> & {
  onCheckedChange?: (checked: boolean) => void;
};

// A passed `checked` owns the state: the element proposes each change and shows it only once React renders it.
export function Checkbox({ onCheckedChange, ...props }: CheckboxProps) {
  return <TpCheckbox onCheckedChange={(event) => onCheckedChange?.(event.detail.value)} {...props} />;
}

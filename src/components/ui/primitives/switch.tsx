import { Switch as TpSwitch, type SwitchProps as TpSwitchProps } from "@tweakpad/ui/react";

type SwitchProps = Omit<TpSwitchProps, "onCheckedChange"> & {
  onCheckedChange?: (checked: boolean) => void;
};

// A passed `checked` owns the state: the element proposes each change and shows it only once React renders it.
export function Switch({ onCheckedChange, ...props }: SwitchProps) {
  return <TpSwitch onCheckedChange={(event) => onCheckedChange?.(event.detail.value)} {...props} />;
}

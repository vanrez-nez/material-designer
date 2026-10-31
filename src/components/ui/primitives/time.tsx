import { Time as TpTime, type TimeProps as TpTimeProps } from "@tweakpad/ui/react";

type TimeProps = Omit<TpTimeProps, "datetime"> & {
  // Epoch milliseconds.
  value: number;
};

// A timestamp, relative by default ("3 minutes ago"), which refreshes itself. Its own date tooltip stays off
// unless asked for, as it adds a tab stop inside the row, menu item or toggle that shows the time.
export function Time({ value, ...props }: TimeProps) {
  return <TpTime datetime={value} mode="relative" numeric="always" relativeStyle="long" tooltip={false} {...props} />;
}

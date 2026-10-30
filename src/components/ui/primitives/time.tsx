import type * as React from "react";

type TimeProps = React.HTMLAttributes<HTMLElement> & {
  // "relative" reads how long ago ("3 minutes ago"); "absolute" reads the date and time.
  mode?: "relative" | "absolute";
  // Relative only: "long" reads "3 minutes ago"; "narrow" shortens it for tight rows.
  relativeStyle?: "long" | "short" | "narrow";
  // Shows the full date and time on hover or focus, which also makes the time a tab stop.
  tooltip?: boolean;
  // The tooltip's layout in Unicode date-field symbols, such as "MMM d h:mma".
  tooltipPattern?: string;
  // Epoch milliseconds.
  value: number;
};

// A timestamp (tp-time). Relative text refreshes itself. Its own date tooltip is off by default, as it adds
// a tab stop inside the row, menu item or toggle that shows the time.
function Time({
  mode = "relative",
  relativeStyle = "long",
  tooltip = false,
  tooltipPattern,
  value,
  ...props
}: TimeProps) {
  return (
    <tp-time
      data-slot="time"
      datetime={value}
      mode={mode}
      numeric="always"
      relativeStyle={relativeStyle}
      tooltip={tooltip}
      tooltip-pattern={tooltipPattern}
      {...props}
    />
  );
}

export { Time };

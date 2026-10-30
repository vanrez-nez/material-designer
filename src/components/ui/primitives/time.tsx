import type * as React from "react";

type TimeProps = React.HTMLAttributes<HTMLElement> & {
  // "relative" reads how long ago ("3 minutes ago"); "absolute" reads the date and time.
  mode?: "relative" | "absolute";
  // Relative only: "long" reads "3 minutes ago"; "narrow" shortens it for tight rows.
  relativeStyle?: "long" | "short" | "narrow";
  // Epoch milliseconds.
  value: number;
};

// A timestamp (tp-time). Relative text refreshes itself. Its own date tooltip is off: it would add a tab stop
// inside the rows, menu items and toggles that show times; wrap the row in a Tooltip where the full date
// matters.
function Time({ mode = "relative", relativeStyle = "long", value, ...props }: TimeProps) {
  return (
    <tp-time
      data-slot="time"
      datetime={value}
      mode={mode}
      numeric="always"
      relativeStyle={relativeStyle}
      tooltip={false}
      {...props}
    />
  );
}

export { Time };

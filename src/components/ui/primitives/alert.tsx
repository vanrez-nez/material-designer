import type * as React from "react";

type AlertProps = React.HTMLAttributes<HTMLElement> & {
  // "polite" announces an alert that appears after an action; "assertive" only urgent problems.
  announcement?: "off" | "polite" | "assertive";
  // Changes color only; the title says what happened.
  severity?: "informational" | "success" | "warning" | "danger";
  title: string;
};

// An in-flow message (tp-alert): a title plus supporting text as children.
function Alert(props: AlertProps) {
  return <tp-alert data-slot="alert" {...props} />;
}

export { Alert };

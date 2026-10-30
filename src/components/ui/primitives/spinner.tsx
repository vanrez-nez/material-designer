import type * as React from "react";

// An indeterminate activity indicator (tp-spinner). `label` is announced; pass "" when nearby text already
// says what is loading.
function Spinner(props: React.HTMLAttributes<HTMLElement> & { label: string; size?: "sm" | "default" | "lg" }) {
  return <tp-spinner data-slot="spinner" {...props} />;
}

export { Spinner };

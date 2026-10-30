import type * as React from "react";

// The trail of ancestors (tp-breadcrumb): each step is a direct child — links for ancestors, a plain element
// for the current step (marked current automatically).
function Breadcrumb(props: React.HTMLAttributes<HTMLElement> & { label?: string }) {
  return <tp-breadcrumb data-slot="breadcrumb" {...props} />;
}

export { Breadcrumb };

import type * as React from "react";

// A native scroll viewport with theme scrollbars (tp-scroll-area). Constrain its size; `label` names it as a
// region.
function ScrollArea(props: React.HTMLAttributes<HTMLElement> & { label?: string }) {
  return <tp-scroll-area data-slot="scroll-area" {...props} />;
}

export { ScrollArea };

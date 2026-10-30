import type * as React from "react";

type EmptyStateProps = React.HTMLAttributes<HTMLElement> & {
  description?: string;
  // "icon" sizes a single glyph in the media slot; "plain" shows media as authored.
  mediaTreatment?: "icon" | "plain";
  title: string;
};

// What a view shows when it has nothing to show yet (tp-empty-state). Children go to its `media` and
// `actions` slots.
function EmptyState({ mediaTreatment, ...props }: EmptyStateProps) {
  return <tp-empty-state data-slot="empty-state" media-treatment={mediaTreatment} {...props} />;
}

export { EmptyState };

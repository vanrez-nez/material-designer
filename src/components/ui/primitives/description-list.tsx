import type * as React from "react";

type DescriptionListProps = React.HTMLAttributes<HTMLElement> & {
  // "horizontal" places the pairs side by side, wrapping when space runs out.
  orientation?: "vertical" | "horizontal";
};

// Label and value pairs for the details of a record (tp-description-list).
function DescriptionList(props: DescriptionListProps) {
  return <tp-description-list data-slot="description-list" {...props} />;
}

// One pair: `label` names the value given as children.
function DescriptionListItem(props: React.HTMLAttributes<HTMLElement> & { label: string }) {
  return <tp-description-list-item data-slot="description-list-item" {...props} />;
}

export { DescriptionList, DescriptionListItem };

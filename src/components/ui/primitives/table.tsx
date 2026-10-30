import type * as React from "react";

type TableProps = React.HTMLAttributes<HTMLElement> & {
  // Names the scrolling region that holds the table.
  label: string;
  // "row" paints the rows marked `selected`; the selection itself belongs to the caller.
  selectionPresentation?: "none" | "row";
  // Pins the header while the rows scroll.
  stickyHeader?: boolean;
};

// Tabular data (tp-table). Constrained with ordinary CSS such as max-block-size, it scrolls itself. It has no
// keyboard model of its own: compose Buttons in cells for actions.
function Table({ label, selectionPresentation, stickyHeader, ...props }: TableProps) {
  return (
    <tp-table
      data-slot="table"
      label={label}
      selectionPresentation={selectionPresentation}
      stickyHeader={stickyHeader}
      {...props}
    />
  );
}

function TableHeader(props: React.HTMLAttributes<HTMLElement>) {
  return <tp-table-header data-slot="table-header" {...props} />;
}

function TableBody(props: React.HTMLAttributes<HTMLElement>) {
  return <tp-table-body data-slot="table-body" {...props} />;
}

// One row; `selected` is painted when the table presents row selection.
function TableRow(props: React.HTMLAttributes<HTMLElement> & { selected?: boolean }) {
  return <tp-table-row data-slot="table-row" {...props} />;
}

// A header cell: a column header, or with scope "row" the cell that names its row.
function TableHead(props: React.HTMLAttributes<HTMLElement> & { scope?: "col" | "row" }) {
  return <tp-table-head data-slot="table-head" {...props} />;
}

function TableCell(props: React.HTMLAttributes<HTMLElement>) {
  return <tp-table-cell data-slot="table-cell" {...props} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };

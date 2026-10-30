import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CircleQuestionMark } from "lucide-react";

import { MarkdownContent } from "@/components/ui/composables/markdown-content";
import { Button } from "@/components/ui/primitives/button";
import { Dialog, DialogContent } from "@/components/ui/primitives/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";

type HelpHintSize = "xs" | "md" | "lg";
type HelpHintTrigger = "hover" | "click" | "both";

type HelpHintProps = {
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  doc: string;
  size?: HelpHintSize;
  trigger?: HelpHintTrigger;
};

type ParsedHelpDoc = { body: string; description: string; title: string };

const SIZE_TO_BUTTON: Record<HelpHintSize, "icon-xs" | "icon-sm" | "icon-lg"> = {
  lg: "icon-lg",
  md: "icon-sm",
  xs: "icon-xs",
};

// A help doc is Markdown with `title` and `description` front matter; the description is its one-line summary.
export function parseHelpDoc(raw: string): ParsedHelpDoc {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(raw);
  if (!match) return { body: raw.trim(), description: "", title: "" };

  let title = "";
  let description = "";

  for (const line of match[1].split("\n")) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!field) continue;
    const value = field[2].trim().replace(/^["']|["']$/g, "");
    if (field[1] === "title") title = value;
    else if (field[1] === "description") description = value;
  }

  return { body: raw.slice(match[0].length).trim(), description, title };
}

export function HelpHint({
  ariaLabel = "More info",
  className,
  contentClassName,
  doc,
  size = "md",
  trigger = "both",
}: HelpHintProps) {
  const { body, description, title } = useMemo(() => parseHelpDoc(doc), [doc]);
  const showHover = (trigger === "hover" || trigger === "both") && Boolean(description);
  const showDialog = trigger === "click" || trigger === "both";
  const [dialogOpen, setDialogOpen] = useState(false);
  const hostRef = useRef<HTMLSpanElement>(null);

  // The hint handles its own click: inside a field label it must not toggle the labelled control, as a
  // button inside a native <label> doesn't, and tp-field skips label activation for a handled click. Native,
  // because React's listener runs at the root, after the field has seen the click.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onClick = (event: Event) => {
      event.preventDefault();
      if (showDialog) setDialogOpen(true);
    };
    host.addEventListener("click", onClick);
    return () => host.removeEventListener("click", onClick);
  }, [showDialog]);

  const button = (
    <Button
      aria-label={ariaLabel}
      className={cn("rounded-full text-muted-foreground", className)}
      size={SIZE_TO_BUTTON[size]}
      type="button"
      variant="ghost"
    >
      <CircleQuestionMark />
    </Button>
  );

  // The hover description is a tooltip: it opens on hover/focus and, being in the top layer, stays above
  // the dialogs a hint sits in.
  const withHover = (control: ReactNode) =>
    showHover ? (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    ) : (
      control
    );

  return (
    <>
      <span className="contents" ref={hostRef}>
        {withHover(button)}
      </span>
      {showDialog && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className={cn("max-w-lg", contentClassName)} title={title || "Help"}>
            <MarkdownContent content={body} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

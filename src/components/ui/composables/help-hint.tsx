import { type ReactNode, useMemo } from "react";
import { CircleQuestionMark } from "lucide-react";

import { MarkdownContent } from "@/components/ui/composables/markdown-content";
import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/primitives/dialog";
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

  if (!showDialog) return withHover(button);

  return (
    <Dialog>
      {withHover(<DialogTrigger asChild>{button}</DialogTrigger>)}
      <DialogContent className={cn("max-w-lg", contentClassName)}>
        <DialogHeader>
          <DialogTitle>{title || "Help"}</DialogTitle>
          {description ? (
            <DialogDescription className="sr-only">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <MarkdownContent content={body} />
      </DialogContent>
    </Dialog>
  );
}

import { type MouseEvent, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  Widget,
  type WidgetOwnerRect,
  type WidgetPosition,
} from "@/editor/panes/common/Widget";

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

const SIZE_TO_ICON: Record<HelpHintSize, string> = {
  lg: "size-6",
  md: "size-5",
  xs: "size-4",
};

const HOVER_PANEL_WIDTH = 288;
const VIEWPORT_PADDING = 12;

function parseHelpDoc(raw: string): ParsedHelpDoc {
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

function rectToOwnerRect(rect: DOMRect): WidgetOwnerRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
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
  const [hoverOpen, setHoverOpen] = useState(false);
  const [position, setPosition] = useState<WidgetPosition>({
    x: VIEWPORT_PADDING,
    y: VIEWPORT_PADDING,
  });
  const [ownerRect, setOwnerRect] = useState<WidgetOwnerRect | null>(null);
  const leaveTimerRef = useRef<number>(0);
  const showHover = (trigger === "hover" || trigger === "both") && Boolean(description);
  const showDialog = trigger === "click" || trigger === "both";

  const openHover = (event: MouseEvent<HTMLButtonElement>) => {
    window.clearTimeout(leaveTimerRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - HOVER_PANEL_WIDTH - VIEWPORT_PADDING);
    setPosition({ x: Math.min(Math.max(rect.left, VIEWPORT_PADDING), maxX), y: rect.bottom + 6 });
    setOwnerRect(rectToOwnerRect(rect));
    setHoverOpen(true);
  };

  const closeHover = () => {
    window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => setHoverOpen(false), 80);
  };

  const button = (
    <Button
      aria-label={ariaLabel}
      className={cn("rounded-full text-muted-foreground", className)}
      onClick={showHover ? () => setHoverOpen(false) : undefined}
      onMouseEnter={showHover ? openHover : undefined}
      onMouseLeave={showHover ? closeHover : undefined}
      size={SIZE_TO_BUTTON[size]}
      type="button"
      variant="ghost"
    >
      <CircleQuestionMark className={SIZE_TO_ICON[size]} />
    </Button>
  );

  const hoverPanel =
    showHover && hoverOpen ? (
      <Widget
        contentClassName="min-h-0 p-3"
        floatingOwnerRect={ownerRect ?? undefined}
        floatingPosition={position}
        showFloatingOwnerCallout
        onMouseEnter={() => window.clearTimeout(leaveTimerRef.current)}
        onMouseLeave={closeHover}
        style={{ width: HOVER_PANEL_WIDTH }}
        variant="floating"
      >
        <p className="leading-relaxed">{description}</p>
      </Widget>
    ) : null;

  if (!showDialog) {
    return (
      <>
        {button}
        {hoverPanel}
      </>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{button}</DialogTrigger>
      {hoverPanel}
      <DialogContent className={cn("max-w-lg", contentClassName)}>
        <DialogHeader>
          <DialogTitle>{title || "Help"}</DialogTitle>
          {description ? (
            <DialogDescription className="sr-only">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <MarkdownContent content={body} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

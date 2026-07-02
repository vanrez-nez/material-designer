import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import { cn } from "@/lib/utils";

export type WidgetVariant = "default" | "floating";

export type WidgetPosition = {
  x: number;
  y: number;
};

export type WidgetOwnerRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type WidgetProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  collapsed?: boolean;
  contentClassName?: string;
  defaultCollapsed?: boolean;
  floatingOwnerRect?: WidgetOwnerRect;
  floatingPosition?: WidgetPosition;
  ignoreFloatingDismissSelector?: string;
  onCollapsedChange?: (collapsed: boolean) => void;
  onFloatingDismiss?: () => void;
  showFloatingOwnerCallout?: boolean;
  title?: ReactNode;
  variant?: WidgetVariant;
  viewportPadding?: number;
};

const DEFAULT_FLOATING_POSITION: WidgetPosition = { x: 12, y: 12 };
const WIDGET_CONTENT_TRANSITION_MS = 200;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function Widget({
  children,
  className,
  collapsed,
  contentClassName,
  defaultCollapsed = false,
  floatingOwnerRect,
  floatingPosition = DEFAULT_FLOATING_POSITION,
  ignoreFloatingDismissSelector,
  onCollapsedChange,
  onFloatingDismiss,
  showFloatingOwnerCallout = false,
  title,
  variant = "default",
  viewportPadding = 12,
  style,
  ...props
}: WidgetProps) {
  const widgetRef = useRef<HTMLElement>(null);
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const [resolvedPosition, setResolvedPosition] = useState(floatingPosition);
  const isFloating = variant === "floating";
  const isCollapsed = isFloating ? false : collapsed ?? internalCollapsed;
  const hasHeader = !isFloating || Boolean(title);
  const [floatingWidgetWidth, setFloatingWidgetWidth] = useState(0);
  const [shouldRenderContent, setShouldRenderContent] = useState(!isCollapsed);
  const [isContentOpaque, setIsContentOpaque] = useState(!isCollapsed);
  const previousCollapsedRef = useRef(isCollapsed);

  const setCollapsed = (nextCollapsed: boolean) => {
    if (collapsed === undefined) {
      setInternalCollapsed(nextCollapsed);
    }

    onCollapsedChange?.(nextCollapsed);
  };

  const updateFloatingPosition = useCallback(() => {
    if (!isFloating || !widgetRef.current) {
      return;
    }

    const rect = widgetRef.current.getBoundingClientRect();
    setFloatingWidgetWidth(rect.width);
    const maxX = Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding);
    const maxY = Math.max(viewportPadding, window.innerHeight - rect.height - viewportPadding);
    const nextPosition = {
      x: clamp(floatingPosition.x, viewportPadding, maxX),
      y: clamp(floatingPosition.y, viewportPadding, maxY),
    };

    setResolvedPosition((currentPosition) =>
      currentPosition.x === nextPosition.x && currentPosition.y === nextPosition.y
        ? currentPosition
        : nextPosition,
    );
  }, [floatingPosition.x, floatingPosition.y, isFloating, viewportPadding]);

  const ownerCalloutLeft =
    isFloating && floatingOwnerRect
      ? clamp(
          floatingOwnerRect.left + floatingOwnerRect.width / 2 - resolvedPosition.x,
          10,
          Math.max(10, floatingWidgetWidth - 10),
        )
      : 0;

  useLayoutEffect(() => {
    if (!isFloating || !widgetRef.current) {
      return;
    }

    const resizeObserver = new ResizeObserver(updateFloatingPosition);

    resizeObserver.observe(widgetRef.current);
    window.addEventListener("resize", updateFloatingPosition);
    updateFloatingPosition();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFloatingPosition);
    };
  }, [isFloating, updateFloatingPosition]);

  useEffect(() => {
    if (!isFloating || !onFloatingDismiss) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;

      if (
        ignoreFloatingDismissSelector &&
        target instanceof Element &&
        target.closest(ignoreFloatingDismissSelector)
      ) {
        return;
      }

      if (
        target instanceof Node &&
        widgetRef.current &&
        !widgetRef.current.contains(target)
      ) {
        onFloatingDismiss();
      }
    };

    const outsideClickListener = window.setTimeout(() => {
      document.addEventListener("click", handleDocumentClick);
    }, 0);

    return () => {
      window.clearTimeout(outsideClickListener);
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [ignoreFloatingDismissSelector, isFloating, onFloatingDismiss]);

  useEffect(() => {
    if (isFloating) {
      setShouldRenderContent(true);
      setIsContentOpaque(true);
      previousCollapsedRef.current = isCollapsed;
      return;
    }

    const previousCollapsed = previousCollapsedRef.current;
    previousCollapsedRef.current = isCollapsed;

    if (previousCollapsed === isCollapsed) {
      return;
    }

    if (!isCollapsed) {
      setShouldRenderContent(true);
      setIsContentOpaque(false);

      const revealContent = window.setTimeout(() => {
        setIsContentOpaque(true);
      }, WIDGET_CONTENT_TRANSITION_MS);

      return () => {
        window.clearTimeout(revealContent);
      };
    }

    setIsContentOpaque(false);

    const unmountContent = window.setTimeout(() => {
      setShouldRenderContent(false);
    }, WIDGET_CONTENT_TRANSITION_MS);

    return () => {
      window.clearTimeout(unmountContent);
    };
  }, [isCollapsed, isFloating]);

  const widgetElement = (
    <section
      ref={widgetRef}
      className={cn(
        "select-none border bg-card text-xs text-card-foreground [&_button]:text-xs [&_input]:text-xs [&_select]:text-xs",
        isFloating
          ? "floating-widget-surface fixed z-50 rounded-md shadow-2xl"
          : "widget-panel flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-md shadow-none",
        className,
      )}
      style={
        isFloating
          ? {
              ...style,
              left: resolvedPosition.x,
              top: resolvedPosition.y,
            }
          : style
      }
      {...props}
    >
      {isFloating && showFloatingOwnerCallout && floatingOwnerRect ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 size-2 rotate-45 border-t border-l bg-card"
          style={{ left: ownerCalloutLeft }}
        />
      ) : null}
      {hasHeader ? (
        <header
          className={cn(
            "flex shrink-0 items-center gap-2 px-3",
            !isCollapsed && "border-b",
            isFloating ? "h-7" : "h-9",
          )}
        >
          {!isFloating ? (
            <Button
              aria-label={isCollapsed ? "Expand widget" : "Collapse widget"}
              onClick={() => setCollapsed(!isCollapsed)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            </Button>
          ) : null}
          {isFloating ? (
            <div className="min-w-0 flex-1 truncate text-xs font-medium">{title}</div>
          ) : (
            <button
              aria-expanded={!isCollapsed}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => setCollapsed(!isCollapsed)}
              type="button"
            >
              {title}
            </button>
          )}
        </header>
      ) : null}
      {isFloating ? (
        <div className={cn("min-h-16 p-3", contentClassName)}>{children}</div>
      ) : (
        <div
          aria-hidden={isCollapsed}
          className={cn(
            "grid min-h-0 transition-[grid-template-rows] duration-200 ease-out",
            !isCollapsed && "flex-1",
            isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
          )}
        >
          <div className="min-h-0 overflow-y-auto overflow-x-hidden">
            {shouldRenderContent ? (
              <div
                className={cn(
                  "min-h-16 p-3 transition-opacity ease-out",
                  isContentOpaque
                    ? "opacity-100 duration-150"
                    : "pointer-events-none opacity-0 duration-100",
                  contentClassName,
                )}
              >
                {children}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );

  if (isFloating && typeof document !== "undefined") {
    return createPortal(widgetElement, document.body);
  }

  return widgetElement;
}

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  type TpValueChangeDetail,
  useOpenState,
  useTpEvent,
  useTpOpenChange,
} from "@/components/ui/tp/hooks";

const DialogContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

function useDialogContext(part: string) {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error(`${part} must be rendered inside <Dialog>.`);
  return context;
}

type DialogProps = {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

function Dialog({ children, defaultOpen, onOpenChange, open }: DialogProps) {
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  const context = React.useMemo(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

type DialogActionProps = { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>;

// Radix-style `asChild` triggers/closers: extra props (e.g. a slot from an enclosing trigger) pass through
// to the caller's element, which keeps its own click handler.
function withClick(
  child: React.ReactNode,
  onClick: () => void,
  props: Record<string, unknown>,
): React.ReactNode {
  if (!React.isValidElement<{ onClick?: (event: React.MouseEvent) => void }>(child)) return child;
  const ownClick = child.props.onClick;
  return React.cloneElement(child, {
    ...props,
    onClick: (event: React.MouseEvent) => {
      ownClick?.(event);
      if (!event.defaultPrevented) onClick();
    },
  });
}

function DialogTrigger({ asChild: _asChild, children, ...props }: DialogActionProps) {
  const { setOpen } = useDialogContext("DialogTrigger");
  return withClick(children, () => setOpen(true), props);
}

function DialogClose({ asChild: _asChild, children, ...props }: DialogActionProps) {
  const { setOpen } = useDialogContext("DialogClose");
  return withClick(children, () => setOpen(false), props);
}

type DialogContentProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  // Scope the dialog to a region instead of the page: it renders inside `container`, which must be
  // `position: relative; isolation: isolate`, and only that region goes inert.
  container?: HTMLElement | null;
  // Shown in the dialog's header under the title, and describes the dialog for assistive technology.
  description?: string;
  showCloseButton?: boolean;
  // The header title; it also names the dialog.
  title: string;
};

// tp-dialog owns the modal surface, backdrop, focus management, Escape/outside dismissal and the corner
// close control. Content mounts when the dialog opens, as with Radix, and unmounts only once the close has
// completed: in container modality tp-dialog projects its children into the container while open, and
// hands them back on close, so React must not remove them before then.
function DialogContent({
  children,
  container,
  description,
  showCloseButton = true,
  title,
  ...props
}: DialogContentProps) {
  const { open, setOpen } = useDialogContext("DialogContent");
  const ref = React.useRef<HTMLElement>(null);
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);
  useTpOpenChange(ref, open, setOpen);
  useTpEvent<TpValueChangeDetail<boolean>>(ref, "tp-open-change-complete", (event) => {
    if (event.target === ref.current && !event.detail.value) setPresent(false);
  });

  return (
    <tp-dialog
      ref={ref}
      data-slot="dialog-content"
      container={container ?? null}
      description={description}
      label={title}
      modality={container ? "container" : "modal"}
      open={open}
      show-close-control={showCloseButton}
      {...props}
    >
      {open || present ? children : null}
    </tp-dialog>
  );
}

// One row in tp-dialog's footer: actions end-aligned, as before; `className` can re-arrange the row.
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      slot="footer"
      data-slot="dialog-footer"
      className={cn("flex flex-1 items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
};

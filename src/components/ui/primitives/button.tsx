import * as React from "react";

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

type ButtonProps = Omit<React.ComponentProps<"button">, "ref"> & {
  // Render a child anchor as the button: tp-button renders a native link from href/target/rel.
  asChild?: boolean;
  // Shows the shared spinner as the leading mark (busy semantics; does not disable the Button).
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

function Button({
  asChild = false,
  children,
  loading = false,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) {
  const hostRef = React.useRef<HTMLElement>(null);
  let content = children;
  let linkProps: Record<string, unknown> = {};

  if (asChild && React.isValidElement<React.ComponentProps<"a">>(children) && children.type === "a") {
    const { children: anchorChildren, href, rel, target } = children.props;
    content = anchorChildren;
    linkProps = { href, rel, target };
  }

  // tp-button renders icons in its leading mark (`icon-start` slot); on icon sizes the default slot is the
  // visually hidden label. Route a leading icon there, whichever component rendered the <svg>.
  React.useLayoutEffect(() => {
    const icon = hostRef.current?.firstElementChild;
    if (icon instanceof SVGElement && icon.getAttribute("slot") !== "icon-start") {
      icon.setAttribute("slot", "icon-start");
    }
  });

  return (
    <tp-button
      ref={hostRef}
      data-slot="button"
      data-size={size}
      data-variant={variant}
      loading-position={loading ? "leading" : undefined}
      size={size}
      type={type}
      variant={variant}
      {...linkProps}
      {...props}
    >
      {content}
    </tp-button>
  );
}

export { Button };

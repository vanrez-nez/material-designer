import * as React from "react";
import type { TpButton } from "@tweakpad/ui";
import { Button as TpButtonBinding, type ButtonProps as TpButtonProps } from "@tweakpad/ui/react";

type ButtonProps = Omit<TpButtonProps, "loadingPosition" | "ref"> & {
  // Render a child anchor as the button: tp-button renders a native link from href/target/rel.
  asChild?: boolean;
  // Shows the shared spinner as the leading mark (busy semantics; does not disable the Button).
  loading?: boolean;
};

function Button({ asChild = false, children, loading = false, type = "button", ...props }: ButtonProps) {
  const hostRef = React.useRef<TpButton>(null);
  let content = children;
  let linkProps: Pick<TpButtonProps, "href" | "rel" | "target"> = {};

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
    <TpButtonBinding
      ref={hostRef}
      loadingPosition={loading ? "leading" : null}
      type={type}
      {...linkProps}
      {...props}
    >
      {content}
    </TpButtonBinding>
  );
}

export { Button };

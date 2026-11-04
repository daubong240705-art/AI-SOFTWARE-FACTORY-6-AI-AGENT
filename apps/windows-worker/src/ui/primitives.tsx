import type { ComponentPropsWithoutRef, ReactNode } from "react";

// Keep layout choices explicit. These wrappers do not own product state or actions.
type DivProps = ComponentPropsWithoutRef<"div">;
export function Stack({ className = "", ...props }: DivProps) {
  return <div className={`ui-stack ${className}`} {...props} />;
}
export function Cluster({ className = "", ...props }: DivProps) {
  return <div className={`ui-cluster ${className}`} {...props} />;
}
export function Notice({
  children,
  actions,
  tone = "neutral",
}: {
  children: ReactNode;
  actions?: ReactNode;
  tone?: "neutral" | "error" | "success";
}) {
  return (
    <div
      className={`ui-notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Stack className="ui-notice-body">{children}</Stack>
      {actions && <Cluster>{actions}</Cluster>}
    </div>
  );
}
export function ScrollRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`ui-scroll-region ${className}`}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

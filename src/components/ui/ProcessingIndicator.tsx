import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg";
type Variant = "default" | "inverse";

const SIZE: Record<Size, string> = {
  xs: "h-2.5",
  sm: "h-3.5",
  md: "h-5",
  lg: "h-7",
};

export function ProcessingIndicator({
  size = "sm",
  variant = "default",
  className,
  label = "Processing",
}: {
  size?: Size;
  variant?: Variant;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "processing-indicator inline-flex items-end gap-[3px]",
        SIZE[size],
        variant === "inverse" && "processing-indicator--inverse",
        className
      )}
      role="status"
      aria-label={label}
    >
      <span className="processing-indicator__bar" />
      <span className="processing-indicator__bar" />
      <span className="processing-indicator__bar" />
    </span>
  );
}

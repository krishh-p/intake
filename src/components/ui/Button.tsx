import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover disabled:opacity-50",
  secondary:
    "border border-line bg-surface text-ink hover:border-line-strong hover:bg-paper disabled:opacity-50",
  ghost:
    "text-ink-muted hover:text-ink hover:bg-paper disabled:opacity-50",
  danger:
    "bg-alert-high text-white hover:opacity-90 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className,
  children,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus-ring",
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

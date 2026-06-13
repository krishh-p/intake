import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink",
        "placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "disabled:bg-paper disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink",
        "placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "disabled:bg-paper disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("mb-1.5 block text-sm font-medium text-ink-muted", className)}>
      {children}
    </span>
  );
}

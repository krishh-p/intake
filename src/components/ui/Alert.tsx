import { cn } from "@/lib/utils";

type Tone = "error" | "success";

const TONES: Record<Tone, string> = {
  error: "border-alert-high/20 bg-alert-high/5 text-alert-high",
  success: "border-success/20 bg-success-soft text-success",
};

export function Alert({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", TONES[tone], className)}>
      {children}
    </div>
  );
}

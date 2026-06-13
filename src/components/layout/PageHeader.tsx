export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-10 flex items-start justify-between gap-6 border-b border-line pb-8">
      <div>
        <h1 className="font-display text-[1.75rem] leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

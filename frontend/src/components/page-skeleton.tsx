import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Route-level Suspense fallback: a header and a card shaped like most pages. */
export function PageSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-3 px-5 py-5">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${90 - (i % 3) * 15}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Table-shaped skeleton for lists. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full" aria-busy="true">
      <div className="flex gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border px-4 py-3 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" style={{ opacity: 1 - r * 0.08 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-screen centred spinner for the very first session check. */
export function AppLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}

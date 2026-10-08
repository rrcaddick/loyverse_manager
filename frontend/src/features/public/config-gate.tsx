/**
 * Loads GET /public/form-config for a public screen: a step-shaped skeleton
 * while it loads, a retry alert when it fails, the children once it is here.
 */

import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";

import { useFormConfig } from "./api";
import type { FormConfig } from "./types";

export function ConfigGate({ children }: { children: (config: FormConfig) => ReactNode }) {
  const config = useFormConfig();
  if (config.isPending) return <StepSkeleton />;
  if (config.isError || !config.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>The form could not be loaded</AlertTitle>
        <AlertDescription>
          <p>{errorMessage(config.error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void config.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return <>{children(config.data)}</>;
}

export function StepSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-5 w-full" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

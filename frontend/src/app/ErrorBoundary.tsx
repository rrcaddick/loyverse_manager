import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";

import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api";

function ErrorPanel({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" className="size-5" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      </div>
      <div className="flex gap-2">
        {onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw data-icon="inline-start" />
            Try again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => window.location.assign("/")}>
          Go to start
        </Button>
      </div>
    </div>
  );
}

/** Route-level errorElement: handles thrown responses, ApiErrors and bugs. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return <ErrorPanel title={error.status === 404 ? "Page not found" : `Error ${error.status}`} detail={error.statusText} onRetry={() => window.location.reload()} />;
  }
  if (isApiError(error)) {
    return <ErrorPanel title="Could not load this page" detail={error.message} onRetry={() => window.location.reload()} />;
  }
  const detail = error instanceof Error ? error.message : undefined;
  return <ErrorPanel title="Something went wrong" detail={detail} onRetry={() => window.location.reload()} />;
}

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Top-level boundary around the whole app (outside the router). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-svh bg-background text-foreground">
          <ErrorPanel
            title="Something went wrong"
            detail={this.state.error.message}
            onRetry={() => {
              this.setState({ error: null });
            }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

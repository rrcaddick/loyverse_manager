import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { router } from "@/app/router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppearanceSync } from "@/lib/appearance-sync";
import { AuthProvider } from "@/lib/auth";
import { createQueryClient } from "@/lib/query";

export default function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppearanceSync />
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

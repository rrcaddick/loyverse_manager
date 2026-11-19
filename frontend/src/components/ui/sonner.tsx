import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/lib/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      closeButton
      duration={4000}
      icons={{
        success: <CircleCheckIcon className="size-4 text-green-text" />,
        info: <InfoIcon className="size-4 text-blue-text" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-text" />,
        error: <OctagonXIcon className="size-4 text-red-text" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--font-sans": "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast font-sans text-body shadow-md",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

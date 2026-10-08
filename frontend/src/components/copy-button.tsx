import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CopyButtonProps extends Omit<React.ComponentProps<typeof Button>, "onClick" | "value"> {
  value: string;
  /** Visible label; omit for an icon-only button with a tooltip. */
  label?: string;
  copiedLabel?: string;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for insecure contexts: select a hidden textarea.
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ value, label, copiedLabel = "Copied", className, size, variant, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleClick() {
    const ok = await copyText(value);
    if (ok) setCopied(true);
    else toast.error("Could not copy. Select the text and copy it manually.");
  }

  const button = (
    <Button
      type="button"
      variant={variant ?? (label ? "outline" : "ghost")}
      size={size ?? (label ? "sm" : "icon-sm")}
      onClick={handleClick}
      aria-label={label ? undefined : copied ? copiedLabel : "Copy"}
      className={cn(className)}
      {...props}
    >
      {copied ? <Check className="text-success" data-icon={label ? "inline-start" : undefined} /> : <Copy data-icon={label ? "inline-start" : undefined} />}
      {label ? (copied ? copiedLabel : label) : null}
    </Button>
  );

  if (label) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{copied ? copiedLabel : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

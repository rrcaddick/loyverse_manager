import { Rows3 } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";

/** "Compact" toggle for a table toolbar; pair with `useTableDensity`. */
export function DataTableDensityToggle({ compact, onChange, className }: { compact: boolean; onChange: (compact: boolean) => void; className?: string }) {
  return (
    <Toggle size="sm" variant="outline" pressed={compact} onPressedChange={onChange} aria-label="Compact rows" className={className}>
      <Rows3 aria-hidden="true" />
      Compact
    </Toggle>
  );
}

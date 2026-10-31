import { Monitor, Moon, Sun } from "lucide-react";

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Segmented control for the theme, used on the login page and in settings. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={theme}
      onValueChange={(value) => value && setTheme(value as ThemePreference)}
      aria-label="Theme"
      className={className}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem key={value} value={value} aria-label={label} title={label}>
          <Icon aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Radio items for the user menu. Render inside a DropdownMenuContent. */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem key={value} value={value}>
          <Icon aria-hidden="true" />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

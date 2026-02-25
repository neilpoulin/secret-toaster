import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

function labelForTheme(preference: string, resolvedTheme: string): string {
  if (preference === "system") {
    return `System (${resolvedTheme})`;
  }
  return preference === "dark" ? "Dark" : "Light";
}

export function ThemeToggle() {
  const { preference, resolvedTheme, cyclePreference } = useTheme();

  return (
    <Button type="button" variant="outline" size="sm" onClick={cyclePreference}>
      Theme: {labelForTheme(preference, resolvedTheme)}
    </Button>
  );
}

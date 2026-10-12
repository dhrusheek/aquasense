import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

/** Light / dark switch. The label names the mode it switches to, so it needs no aria-pressed. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      type="button"
      data-slot="theme-toggle"
      variant="ghost"
      size="icon-lg"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
      className="shrink-0 transition-colors duration-150"
    >
      {next === 'light' ? <Sun aria-hidden="true" className="size-[18px]" /> : <Moon aria-hidden="true" className="size-[18px]" />}
    </Button>
  );
}

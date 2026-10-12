import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useHashRoute } from '@/app/useHashRoute';
import { AppSidebar } from '@/components/shell/AppSidebar';
import { TopBar } from '@/components/shell/TopBar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

/** localStorage key of the desktop sidebar state: 'expanded' (default) or 'collapsed'. */
const SIDEBAR_KEY = 'aq-sidebar';

function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== 'collapsed';
  } catch {
    return true; // storage blocked: the default
  }
}

// The hash is the router, so the skip link must not change it: move focus by hand instead.
function skipToMain(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  document.getElementById('main')?.focus();
}

const SIDEBAR_SIZE = { '--sidebar-width': '17rem', '--sidebar-width-icon': '3rem' } as CSSProperties;

/**
 * Page frame: skip link, sidebar (<nav>), and <main> holding the top bar (<header>) and the view.
 * From 900 px up the sidebar collapses to a 3 rem icon rail (top-bar trigger, the rail, Ctrl/Cmd+B)
 * and remembers it; under 900 px it is a drawer (see hooks/use-mobile.ts).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const view = useHashRoute();
  const [open, setOpen] = useState(readSidebarOpen);
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? 'expanded' : 'collapsed');
    } catch { /* storage blocked: the state still holds for this visit */ }
  }, []);

  return (
    <>
      <a
        href="#main"
        onClick={skipToMain}
        className="fixed -top-20 left-4 z-50 surface-up rounded-full px-4 py-2 font-sans text-sm text-foreground focus:top-4"
      >
        Skip to content
      </a>
      {/* One provider for the rail tooltips; they open at once, like a menu label. */}
      <TooltipProvider delayDuration={0}>
        <SidebarProvider open={open} onOpenChange={onOpenChange} style={SIDEBAR_SIZE}>
          <AppSidebar />
          <SidebarInset id="main" tabIndex={-1} className="min-w-0 outline-none">
            <TopBar view={view} />
            <div data-slot="view" className="w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ListOrdered } from 'lucide-react';
import { NAV_PAGES, RUBRIC_IDS, VIEWS, type ViewId } from '@/app/routes';
import { useHashRoute } from '@/app/useHashRoute';
import { RELEASE } from '@/lib/constants';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

/** localStorage key of the rubric group: 'open' or 'closed' (default). */
const RUBRIC_KEY = 'aq-rubric-open';

function readRubricOpen(): boolean {
  try {
    return window.localStorage.getItem(RUBRIC_KEY) === 'open';
  } catch {
    return false;
  }
}
function writeRubricOpen(open: boolean): void {
  try {
    window.localStorage.setItem(RUBRIC_KEY, open ? 'open' : 'closed');
  } catch { /* storage blocked: the state still holds for this visit */ }
}

// 40 px rows, sans 14, 10 px radius. Active = ink-4 fill and 600 weight (no inverse bar); hover is the ink-4 fill. The focus outline is inset so the collapsing rubric list cannot clip it.
const ITEM = 'relative h-10 gap-2.5 rounded-[10px] px-3 transition-[width,height,padding,background-color,color] duration-150 '
  + 'hover:bg-sidebar-accent data-active:bg-sidebar-accent data-active:font-semibold data-active:text-sidebar-accent-foreground';
const MARK = '';

function PageItem({ id, label, icon: Icon, active }: (typeof NAV_PAGES)[number] & { active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label} className={cn(ITEM, MARK)}>
        {/* A plain link: deep links, back/forward and middle-click work without a router. */}
        <a href={`#${id}`} aria-current={active ? 'page' : undefined}>
          <Icon aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function RubricItem({ id, active }: { id: ViewId; active: boolean }) {
  const v = VIEWS[id];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={`${v.n} · ${v.shortTitle}`}
        // on the rail the 20 px number cell fills the 32 px square
        className={cn(ITEM, 'px-2 text-sm group-data-[collapsible=icon]:p-1.5!')}
      >
        <a href={`#${id}`} aria-current={active ? 'page' : undefined}>
          <span
            aria-hidden="true"
            className={cn(
              'tabular flex h-5 min-w-5 shrink-0 items-center justify-center font-mono text-xs',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {v.n}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="sr-only">Rubric {v.n}: </span>
            {v.shortTitle}
          </span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The collapsible group of nine rubric views (evaluator build only). */
function RubricGroup({ view }: { view: ViewId }) {
  const inRubric = VIEWS[view].group === 'rubric';
  // Open at once on a rubric deep link, so the list does not animate in on load.
  const [rubricOpen, setRubricOpen] = useState(() => readRubricOpen() || inRubric);

  const onRubricChange = useCallback((next: boolean) => {
    setRubricOpen(next);
    writeRubricOpen(next);
  }, []);

  // Navigating to a rubric view opens the group; other pages leave it as the user set it.
  // (State adjusted during render on a route change; the effect only writes it to storage.)
  const [lastView, setLastView] = useState(view);
  if (lastView !== view) {
    setLastView(view);
    if (inRubric) setRubricOpen(true);
  }
  useEffect(() => {
    if (inRubric) writeRubricOpen(true);
  }, [inRubric, view]);
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <Collapsible asChild open={rubricOpen} onOpenChange={onRubricChange} className="group/nums">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                {/* Reads as current while it hides the current view. */}
                <SidebarMenuButton tooltip="Rubric views" isActive={inRubric && !rubricOpen} className={ITEM}>
                  <ListOrdered aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">Rubric views</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="ml-auto text-muted-foreground transition-transform duration-150 group-data-[collapsible=icon]:hidden group-data-[state=open]/nums:rotate-90"
                  />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                <ul
                  aria-label="Rubric views"
                  className="mt-1 ml-3 flex min-w-0 flex-col gap-1 border-l border-sidebar-border pl-1.5 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:pl-0"
                >
                  {RUBRIC_IDS.map((id) => <RubricItem key={id} id={id} active={view === id} />)}
                </ul>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}


/**
 * Brand, the pages and (evaluator build) the collapsible group of nine rubric views. Reads the hash route itself.
 * Collapses to a 3 rem icon rail with tooltips; under 900 px it is the drawer.
 */
export function AppSidebar() {
  const view = useHashRoute();

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="h-14 justify-center gap-0 px-5 py-0 group-data-[collapsible=icon]:px-3.5">
        <a
          href={RELEASE ? '#story' : '#home'}
          aria-label="AquaSense, home"
          className="flex w-fit items-center gap-2 text-foreground"
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center">
            <span className="size-3.5 rounded-[4px] bg-foreground" />
          </span>
          <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-sans text-sm leading-tight font-semibold tracking-tight">AquaSense</span>
            {RELEASE && <span className="font-sans text-xs leading-tight text-muted-foreground">free pond sensing for fishermen</span>}
          </span>
        </a>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden group-data-[collapsible=icon]:overflow-y-auto">
        <nav aria-label={RELEASE ? 'Pages' : 'Dashboard views'}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {NAV_PAGES.map((p) => <PageItem key={p.label} {...p} active={view === p.id} />)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {!RELEASE && <RubricGroup view={view} />}
        </nav>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

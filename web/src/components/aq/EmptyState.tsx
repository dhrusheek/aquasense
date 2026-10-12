import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Short heading. Optional so a table can show just its sentence. */
  title?: string;
  /** Must say what will fill the space ("Appears when the sink posts its first AGG frame."). */
  description: string;
  /** Not drawn: empty states are a plain sentence (spec 08 §3). Kept for call sites. */
  icon?: ReactNode;
  action?: ReactNode;
  /** Tighter padding and smaller type: for use inside cards, tables and KeyValue. */
  compact?: boolean;
  className?: string;
}

/** The mandatory empty state of every list, table and chart: a centred sentence, no box art. */
export function EmptyState({ title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <Empty
      data-slot="empty-state"
      className={cn('panel-empty gap-3', compact ? 'px-4 py-5' : 'px-6 py-10', className)}
    >
      <EmptyHeader className="max-w-[60ch] gap-1">
        {title && <EmptyTitle>{title}</EmptyTitle>}
        <EmptyDescription className={'text-[13px] text-muted-foreground'}>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

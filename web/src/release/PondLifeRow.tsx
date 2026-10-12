// The Pond life switch (fish and ripples in the page margins; stored as `aq-pond`).
import { usePondEnabled } from '@/components/pond/prefs';
import { Switch } from '@/components/ui/switch';

export function PondLifeRow() {
  const [on, setOn] = usePondEnabled();
  return (
    <span className="inline-flex items-center gap-2">
      <Switch id="pond-life" size="sm" checked={on} onCheckedChange={setOn} />
      <label htmlFor="pond-life" className="cursor-pointer text-sm">
        <span className="sr-only">Pond life</span>
        <span aria-hidden="true">{on ? 'On' : 'Off'}</span>
      </label>
    </span>
  );
}

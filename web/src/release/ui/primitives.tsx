// Release-skin primitives. Class names are styled in ../cyber.css under [data-skin=cyber].
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useDecodeOnView, useTypewriter } from './motion';

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ');

/** One level class per heading (`look` picks a different visual level than the tag, e.g. a box title is an h2 that looks like h3). */
export function Decode({ as: Tag = 'h2', look, className, children }: { as?: 'h1' | 'h2' | 'h3'; look?: 'h1' | 'h2' | 'h3'; className?: string; children: string }) {
  const [ref, text] = useDecodeOnView<HTMLElement>(children);
  const cls = `cy-${look ?? Tag}`;
  return (
    <Tag ref={ref as never} className={cx(cls, className)} aria-label={children}>
      <span aria-hidden="true" className="cy-decode">{text}</span>
    </Tag>
  );
}

export function Dim({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('cy-dim', className)}>{children}</span>;
}

export function Box({ as: Tag = 'section', title, titleAs = 'h2', dim, span, className, children }: {
  as?: 'section' | 'article' | 'div'; title?: ReactNode; titleAs?: 'h2' | 'h3'; dim?: string; span?: number; className?: string; children: ReactNode;
}) {
  const style = span ? ({ gridColumn: `span ${span}` } as CSSProperties) : undefined;
  const heading = typeof title === 'string' ? <Decode as={titleAs} look="h3" className="cy-box-title">{title}</Decode>
    : title ? (titleAs === 'h2' ? <h2 className="cy-h3 cy-box-title">{title}</h2> : <h3 className="cy-h3 cy-box-title">{title}</h3>) : null;
  return (
    <Tag className={cx('cy-box', className)} style={style}>
      {dim ? <span className="cy-dim cy-box-dim">{dim}</span> : null}
      <div className="cy-box-in">
        {heading}
        {children}
      </div>
      <span className="cy-box-joints" aria-hidden="true" />
    </Tag>
  );
}

export function Btn({ primary, href, onClick, pending, disabled, className, children }: {
  primary?: boolean; href?: string; onClick?: () => void; pending?: boolean; disabled?: boolean; className?: string; children: ReactNode;
}) {
  const cls = cx('cy-btn', primary && 'cy-btn-primary', className);
  if (href && !disabled) {
    const ext = /^https?:/.test(href);
    return <a className={cls} href={href} {...(ext ? { target: '_blank', rel: 'noreferrer' } : {})} onClick={onClick}>{children}</a>;
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <span aria-hidden="true" className="cy-spin" /> : null}
      {children}
    </button>
  );
}

export function Table({ cols, rows, caption, className }: { cols: string[]; rows: ReactNode[][]; caption?: string; className?: string }) {
  return (
    <div className="cy-table-wrap">
      <table className={cx('cy-table', className)}>
        {caption ? <caption>{caption}</caption> : null}
        <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={cols[j]}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function Divider() {
  return <div className="cy-rule" aria-hidden="true" />;
}

export function Typewriter({ text, speed = 28, className }: { text: string; speed?: number; className?: string }) {
  const [shown, done] = useTypewriter(text, speed);
  return (
    <p className={cx('cy-typewriter', className)} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
      <span aria-hidden="true" className={cx('cy-cursor', done && 'cy-cursor-blink')} />
    </p>
  );
}

export function Ticker({ items }: { items: string[] }) {
  const line = items.length ? items.join(' ~ ') + ' ~' : '';
  const seg = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // ~60 px/s: one loop travels one segment width. Only retime on a real change, so the 1 s data tick does not jump the scroll.
    const w = seg.current?.offsetWidth ?? 0;
    const el = track.current;
    if (!el || !w) return;
    const prev = parseFloat(el.dataset.w ?? '0');
    if (!prev || Math.abs(w - prev) / prev > 0.15) {
      el.dataset.w = String(w);
      el.style.setProperty('--cy-tk-dur', `${(w / 60).toFixed(1)}s`);
    }
  }, [line]);
  return (
    <div className="cy-ticker" role="region" aria-label="Live readings" tabIndex={0}>
      <div className="cy-ticker-track" ref={track}>
        <span className="cy-ticker-seg" ref={seg}>{line}</span>
        <span className="cy-ticker-seg cy-ticker-dup" aria-hidden="true">{line}</span>
      </div>
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const cells = 10;
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * cells) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(cells - filled);
  return (
    <div className="cy-progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label ?? 'Progress'}>
      <span aria-hidden="true">[{bar}] {value}/{max}</span>
    </div>
  );
}

export function Grid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('cy-grid', className)}>{children}</div>;
}

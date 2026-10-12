/**
 * Origin badge — shows whether a run (or team install) was initiated by
 * the Hub (`hub`) or the developer's CLI (`cli`). Null/undefined origin
 * renders nothing (pre-refactor data).
 */

const STYLE_HUB = 'inline-flex items-center gap-1 rounded-full border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--g-acc)]';
const STYLE_CLI = 'inline-flex items-center gap-1 rounded-full border border-[var(--g-line)] bg-[var(--g-soft)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--g-ink-3)]';

/** Compact origin pill: `Hub` or `Local`. */
export function Origin_badge({ origin }: { origin: string | null | undefined }) {
    if (!origin) return null;

    if (origin === 'hub') {
        return <span className={STYLE_HUB} title="Run dispatched by Hub">Hub</span>;
    }

    return <span className={STYLE_CLI} title="Run started from CLI">Local</span>;
}

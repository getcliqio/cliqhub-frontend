/**
 * One colour per kind of thing, everywhere in Graphite.
 *
 *   review  (HUG gate)     → pink    --g-hug
 *   input   (needs input)  → amber   --g-warn
 *   failed  (failed/crash) → red     --g-bad
 *   run     (running)      → blue    --g-run
 *   done    (completed)    → green   --g-ok
 *
 * "Waiting on you" totals mix reviews and inputs, so they use amber (the
 * attention colour) — never pink or blue. Row actions are always the
 * outlined button; lime is reserved for a page's single primary action.
 */
export type G_kind = 'review' | 'input' | 'failed' | 'run';

export const KIND_STYLE: Record<G_kind, { label: string; glyph: string; fg: string; bg: string; action: string }> = {
	review: { label: 'Review', glyph: 'H', fg: 'var(--g-hug)', bg: 'rgba(255,122,217,.13)', action: 'Review' },
	input: { label: 'Input needed', glyph: '?', fg: 'var(--g-warn-text)', bg: 'var(--g-warn-soft)', action: 'Provide input' },
	failed: { label: 'Failed', glyph: '!', fg: 'var(--g-bad)', bg: 'var(--g-bad-soft)', action: 'Investigate' },
	run: { label: 'Running', glyph: '▶', fg: 'var(--g-run)', bg: 'var(--g-run-soft)', action: 'Open' },
};

/** Stripe colour for stat tiles, by kind. */
export const KIND_STRIPE: Record<G_kind | 'attention', string> = {
	review: 'var(--g-hug)',
	input: 'var(--g-warn)',
	failed: 'var(--g-bad)',
	run: 'var(--g-run)',
	attention: 'var(--g-warn)',
};

export const ROW_ACTION_CLS = 'shrink-0 rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12px] font-semibold hover:border-[var(--g-line-strong)] hover:bg-[var(--g-soft)]';

export function Kind_icon({ kind }: { kind: G_kind }) {
	const k = KIND_STYLE[kind];
	return (
		<span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-[12px] font-extrabold" style={{ color: k.fg, background: k.bg }} data-kind={kind}>
			{k.glyph}
		</span>
	);
}

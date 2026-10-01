/** Graphite run / phase state pill + dot. */

const STATE_META: Record<string, { label: string; fg: string; bg: string }> = {
	running: { label: 'Running', fg: 'var(--g-run)', bg: 'var(--g-run-soft)' },
	awaiting_input: { label: 'Needs input', fg: 'var(--g-warn-text)', bg: 'var(--g-warn-soft)' },
	pending: { label: 'Pending', fg: 'var(--g-ink-3)', bg: 'var(--g-soft)' },
	completed: { label: 'Completed', fg: 'var(--g-ok)', bg: 'var(--g-ok-soft)' },
	failed: { label: 'Failed', fg: 'var(--g-bad)', bg: 'var(--g-bad-soft)' },
	crashed: { label: 'Crashed', fg: 'var(--g-bad)', bg: 'var(--g-bad-soft)' },
	cancelled: { label: 'Cancelled', fg: 'var(--g-ink-3)', bg: 'var(--g-soft)' },
	skipped: { label: 'Skipped', fg: 'var(--g-ink-3)', bg: 'var(--g-soft)' },
};

function meta(state: string) {
	const s = state.toLowerCase();
	if (STATE_META[s]) return STATE_META[s];
	if (s === 'done' || s === 'ok' || s === 'success' || s === 'succeeded' || s === 'complete') return STATE_META.completed;
	if (s === 'error' || s === 'failure') return STATE_META.failed;
	if (s === 'awaiting' || s === 'blocked') return STATE_META.awaiting_input;
	return { label: state.replace(/_/g, ' ') || 'Unknown', fg: 'var(--g-ink-3)', bg: 'var(--g-soft)' };
}

export function State_pill({ state }: { state: string }) {
	const m = meta(state);
	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
			style={{ color: m.fg, background: m.bg }}
			data-testid="state-pill"
		>
			<span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: m.fg }} />
			{m.label}
		</span>
	);
}

export function State_dot({ state, pulse = false }: { state: string; pulse?: boolean }) {
	const m = meta(state);
	return (
		<span
			aria-hidden
			className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
			style={{ background: m.fg, boxShadow: `0 0 0 3px ${m.bg}` }}
		/>
	);
}

export function state_label(state: string): string {
	return meta(state).label;
}

/**
 * One in-app notification row — used by the bell and the Inbox page.
 * Colours follow g_kinds (review pink, input amber, failed red…).
 */
import { Link } from 'react-router';
import { inbox_action, inbox_kind, type Inbox_item, type Inbox_kind } from '@/lib/inbox';
import { relative_time } from '@/lib/overview';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';

const STYLE: Record<Inbox_kind, { glyph: string; fg: string; bg: string; outline?: boolean }> = {
	failed: { glyph: '!', fg: 'var(--g-bad)', bg: 'var(--g-bad-soft)' },
	delivery: { glyph: '!', fg: 'var(--g-bad)', bg: 'transparent', outline: true },
	input: { glyph: '?', fg: 'var(--g-warn-text)', bg: 'var(--g-warn-soft)' },
	review: { glyph: 'H', fg: 'var(--g-hug)', bg: 'rgba(255,122,217,.13)' },
	daemon: { glyph: '◌', fg: 'var(--g-warn-text)', bg: 'var(--g-soft)' },
	done: { glyph: '✓', fg: 'var(--g-ok)', bg: 'rgba(62,207,142,.12)' },
	timeout: { glyph: '⏱', fg: 'var(--g-warn-text)', bg: 'var(--g-warn-soft)' },
	info: { glyph: 'i', fg: 'var(--g-ink-2)', bg: 'var(--g-soft)' },
};

export function Inbox_icon({ kind, size = 30 }: { kind: Inbox_kind; size?: number }) {
	const s = STYLE[kind];
	return (
		<span
			aria-hidden
			data-kind={kind}
			className="grid shrink-0 place-items-center rounded-lg text-[12px] font-extrabold"
			style={{ width: size, height: size, color: s.fg, background: s.bg, border: s.outline ? '1.5px solid var(--g-bad)' : undefined }}
		>
			{s.glyph}
		</span>
	);
}

export function Inbox_row({ item, is_new, compact = false, show_realm_org = true, org_chip, extra, on_open }: {
	item: Inbox_item;
	is_new: boolean;
	compact?: boolean;
	show_realm_org?: boolean;
	org_chip?: React.ReactNode;
	extra?: React.ReactNode;
	on_open?: () => void;
}) {
	const kind = inbox_kind(item.event);
	const action = inbox_action(item);
	const title = item.title || item.event;
	return (
		<div className={`grid grid-cols-[8px_auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--g-line-2)] px-4 py-3 last:border-b-0 ${is_new ? 'bg-[rgba(212,255,63,.025)]' : ''}`} data-testid={`inbox-item-${item.id}`} data-new={is_new || undefined}>
			<span className={`mt-3 h-[7px] w-[7px] rounded-full ${is_new ? 'bg-[var(--g-acc)]' : ''}`} aria-label={is_new ? 'New' : undefined} role={is_new ? 'img' : undefined} />
			<Inbox_icon kind={kind} size={compact ? 26 : 30} />
			<div className="min-w-0">
				<p className="truncate text-[13.5px] font-semibold text-[var(--g-ink)]">{title}</p>
				{!compact && item.message ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--g-ink-3)]">{item.message}</p> : null}
				<div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--g-ink-3)]">
					{item.realm_slug ? (
						<span className="g-mono inline-flex items-center gap-1.5 rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]">
							{show_realm_org ? org_chip : null}{item.realm_slug}
						</span>
					) : <span className="text-[11px]">Account</span>}
					{!compact && item.team ? <span>{item.team}</span> : null}
					{!compact && item.run_id ? <span className="g-mono">#{item.run_id.slice(0, 8)}</span> : null}
					{compact ? <span>{relative_time(item.at)}</span> : <span className="g-mono opacity-80">{item.event}</span>}
				</div>
				{extra}
			</div>
			<div className="flex flex-col items-end gap-1.5">
				{compact ? null : <span className="whitespace-nowrap text-[11.5px] text-[var(--g-ink-3)]">{relative_time(item.at)}</span>}
				{action ? (
					<Link
						to={action.href}
						onClick={on_open}
						className={kind === 'review' && action.label === 'Review'
							? 'shrink-0 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]'
							: `${ROW_ACTION_CLS} ${kind === 'delivery' ? 'border-[rgba(255,92,92,.45)] text-[var(--g-bad)]' : ''}`}
					>
						{action.label}
					</Link>
				) : null}
			</div>
		</div>
	);
}

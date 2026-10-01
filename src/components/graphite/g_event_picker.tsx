/**
 * Pick one or more events for a rule. Each family can be taken whole
 * ("Any run event" = `run.*`, which also covers future run events), or
 * event by event. "Every event" (`*`) covers everything.
 */
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { event_label } from '@/lib/notification_center';

export function covered_by(selector: string, picked: string[]): string | null {
	if (picked.includes('*') && selector !== '*') return '*';
	if (selector.endsWith('.*') || selector === '*') return null;
	const fam = `${selector.split('.')[0]}.*`;
	return picked.includes(fam) ? fam : null;
}

/** Drop events already covered by a picked wildcard. */
export function normalize_events(picked: string[]): string[] {
	const uniq = [...new Set(picked)];
	return uniq.filter((e) => !covered_by(e, uniq));
}

export function Event_picker({ groups, value, on_change }: {
	groups: Array<{ family: string; options: string[] }>;
	value: string[];
	on_change: (next: string[]) => void;
}) {
	const [q, set_q] = useState('');
	const s = q.trim().toLowerCase();
	const match = (e: string) => !s || e.toLowerCase().includes(s) || event_label(e).toLowerCase().includes(s);
	const toggle = (e: string) => on_change(normalize_events(value.includes(e) ? value.filter((x) => x !== e) : [...value, e]));

	return (
		<div className="rounded-md border border-[var(--g-line)] bg-[var(--g-bg)]">
			{value.length ? (
				<div className="flex flex-wrap gap-1.5 border-b border-[var(--g-line)] p-2" aria-label="Chosen events">
					{value.map((e) => (
						<span key={e} className="inline-flex items-center gap-1 rounded-full border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] py-0.5 pl-2.5 pr-1 text-[12px]">
							{event_label(e)}
							<button type="button" aria-label={`Remove ${event_label(e)}`} onClick={() => toggle(e)} className="grid h-4 w-4 place-items-center rounded-full text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-3 w-3" /></button>
						</span>
					))}
				</div>
			) : null}
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-2.5">
				<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
				<input aria-label="Search events" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search events…" className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--g-ink)] outline-none" />
			</div>
			<div className="max-h-[240px] overflow-y-auto py-1" role="group" aria-label="Events">
				{groups.map((g) => {
					const opts = g.options.filter(match);
					if (!opts.length) return null;
					return (
						<div key={g.family}>
							<div className="px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{g.family}</div>
							{opts.map((e) => {
								const by = covered_by(e, value);
								const checked = value.includes(e) || Boolean(by);
								const wild = e === '*' || e.endsWith('.*');
								return (
									<label key={e} className={`flex cursor-pointer items-center gap-2.5 px-3 py-1 text-[13px] hover:bg-[var(--g-soft)] ${by ? 'text-[var(--g-ink-3)]' : 'text-[var(--g-ink)]'}`}>
										<input type="checkbox" checked={checked} disabled={Boolean(by)} onChange={() => toggle(e)} aria-label={event_label(e)} />
										<span className={`min-w-0 flex-1 truncate ${wild ? 'font-semibold' : ''}`}>{event_label(e)}</span>
										<span className="g-mono shrink-0 text-[11px] text-[var(--g-ink-3)]">{by ? `via ${by}` : e}</span>
									</label>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}

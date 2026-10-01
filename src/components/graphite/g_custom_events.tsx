/**
 * Notifications › Custom events — `custom.*` event types a realm's teams emit
 * (declared here, or observed from runs) so rules can route them.
 * Core: events/custom/list {realm_id} · events/custom/create · events/custom/remove.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Empty_row, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Realm_picker, type Picked_realm } from '@/components/graphite/g_realm_picker';

interface Custom_event { id: string; event_type: string; source: 'declared' | 'observed'; realm_id: string | null; team_slug: string | null; label: string | null; created_at: number }

export function custom_type(name: string): string {
	const n = name.trim().replace(/^custom\./, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	return n ? `custom.${n}` : '';
}

export function Custom_events_panel({ org_id, initial }: { org_id: string | null; initial: Picked_realm | null }) {
	const post = use_post();
	const [realm, set_realm] = useState<Picked_realm | null>(initial);
	const [rows, set_rows] = useState<Custom_event[] | null>(null);
	const [err, set_err] = useState<string | null>(null);
	const [ok, set_ok] = useState<string | null>(null);
	const [f, set_f] = useState({ name: '', label: '' });
	const [confirm, set_confirm] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const realm_id = realm?.id ?? null;
	const load = useCallback(async () => {
		if (!realm_id) { set_rows(null); return; }
		const r = await post('/v1/events/custom/list', { realm_id });
		if (!r.ok) { set_err(r.error); set_rows([]); return; }
		const d = r.data as { events?: Custom_event[] } | Custom_event[];
		// Core returns this realm's types plus ones not tied to a realm (realm_id null).
		set_rows((Array.isArray(d) ? d : d.events ?? []).filter((e) => e.realm_id === realm_id || e.realm_id === null));
	}, [realm_id]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => { set_rows(null); set_err(null); void load(); }, [load]);

	async function create(e: FormEvent) {
		e.preventDefault();
		if (!realm_id) return;
		const event_type = custom_type(f.name);
		set_busy(true); set_err(null); set_ok(null);
		const r = await post('/v1/events/custom/create', { realm_id, event_type, ...(f.label.trim() ? { label: f.label.trim() } : {}) });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		set_ok(`${event_type} added — you can route it on the Rules tab.`);
		set_f({ name: '', label: '' });
		await load();
	}
	async function remove(ev: Custom_event) {
		set_busy(true); set_err(null); set_ok(null);
		const r = await post('/v1/events/custom/remove', { id: ev.id });
		set_busy(false); set_confirm(null);
		if (!r.ok) { set_err(r.error); return; }
		set_ok(`${ev.event_type} removed.`);
		await load();
	}
	const new_type = custom_type(f.name);
	return (
		<div className="flex flex-col gap-4" data-testid="custom-events">
			<p className="max-w-[760px] text-[13px] text-[var(--g-ink-3)]">Teams can emit their own events (<span className="g-mono">custom.&lt;name&gt;</span>). Ones seen in runs appear here automatically; declare one ahead of time to write a rule for it before it first fires.</p>
			<div className="w-[300px] max-w-full"><Realm_picker label="Realm" org_id={org_id} value={realm} on_change={set_realm} show_org={!org_id} /></div>
			{!realm_id ? <p className="text-[13px] text-[var(--g-ink-3)]">Pick a realm to see its custom events.</p> : (
				<>
					{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
					{ok ? <p role="status" className="text-[12.5px] text-[var(--g-ok)]">{ok}</p> : null}
					<form onSubmit={(e) => void create(e)} aria-label="Declare a custom event" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
						<label className="text-[12.5px] text-[var(--g-ink-2)]">Event name<input aria-label="Event name" value={f.name} onChange={(e) => set_f({ ...f, name: e.target.value })} placeholder="deploy.approved" className={`${G_INPUT} g-mono mt-1 block w-[240px]`} /></label>
						<label className="text-[12.5px] text-[var(--g-ink-2)]">Label <span className="text-[var(--g-ink-3)]">(optional)</span><input aria-label="Event label" value={f.label} onChange={(e) => set_f({ ...f, label: e.target.value })} placeholder="Deploy approved" className={`${G_INPUT} mt-1 block w-[220px]`} /></label>
						<button type="submit" disabled={busy || !new_type} className={G_PRIMARY}>Declare {new_type || 'event'}</button>
					</form>
					<div className={TABLE_WRAP}>
						<table className="w-full text-[12.5px]">
							<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Event</th><th className={TH}>Label</th><th className={TH}>Source</th><th className={TH}>Team</th><th className={TH} /></tr></thead>
							<tbody>
								{rows === null ? <Empty_row cols={5}>Loading…</Empty_row> : !rows.length ? <Empty_row cols={5}>No custom events in this realm yet.</Empty_row> : null}
								{(rows ?? []).map((ev) => (
									<tr key={ev.id} className={TR} data-testid={`custom-${ev.event_type}`}>
										<td className="g-mono px-4 py-2.5">{ev.event_type}</td>
										<td className="px-4 text-[var(--g-ink-2)]">{ev.label ?? '—'}</td>
										<td className="px-4"><Pill tone={ev.source === 'declared' ? 'ok' : 'muted'}>{ev.source}</Pill>{ev.realm_id === null ? <span className="ml-1.5 text-[11px] text-[var(--g-ink-3)]">all realms</span> : null}</td>
										<td className="g-mono px-4 text-[var(--g-ink-3)]">{ev.team_slug ?? '—'}</td>
										<td className="px-4 text-right">{ev.realm_id === null ? null : confirm === ev.id
											? <span className="inline-flex items-center gap-2 text-[12px]"><span className="text-[var(--g-ink-3)]">Rules for it stop matching.</span><button type="button" disabled={busy} onClick={() => void remove(ev)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 font-semibold text-[#160606]">Remove</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Keep</button></span>
											: <button type="button" onClick={() => set_confirm(ev.id)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove…</button>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
		</div>
	);
}

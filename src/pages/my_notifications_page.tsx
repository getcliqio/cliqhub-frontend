/**
 * My notifications (Graphite) — a read-only report of what reaches you in
 * the org you're in: for each event, which rule sends it, where, and whether
 * that is you (directly, your email, your inbox) or a shared place.
 *
 * Data: the org's rules and channels from `POST /v1/notification_center/get`
 * (one call). Org admins change rules on the Events page.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BellRing } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope, view_href } from '@/lib/view_scope';
import { event_family, event_label, scope_text, type Notification_center_data } from '@/lib/notification_center';
import { my_rule_rows, REACH_LABEL, type My_rule_row, type Reach } from '@/lib/my_notifications';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Scope_tag } from '@/pages/notification_center_page';

/** Realm rules are paged by the BFF; one big page covers almost every org. */
const REALM_LIMIT = 50;

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;

const REACH_TONE: Record<Reach, string> = {
	direct: 'var(--g-ok)',
	email: 'var(--g-ok)',
	inbox: 'var(--g-run)',
	about_you: 'var(--g-ink-2)',
	none: 'var(--g-ink-3)',
};

function Reach_badge({ reach }: { reach: Reach }) {
	const c = REACH_TONE[reach];
	return (
		<span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium" style={{ color: c, borderColor: c }} data-reach={reach}>
			{REACH_LABEL[reach]}
		</span>
	);
}

export function Component() {
	const { user } = useAuth();
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const org = scope.org ?? null;
	const multi_org = (overview.data?.orgs.length ?? 0) > 0;
	const [mine_only, set_mine_only] = useState(true);

	const body = useMemo(() => (org ? { org_id: org.id, realm_limit: REALM_LIMIT } : null), [org]);
	const center = use_bff_read<Notification_center_data>('/v1/notification_center/get', body, { fallback_error: 'Could not load notifications.' });
	const d = center.data;

	const rows = useMemo<My_rule_row[]>(() => {
		if (!d || !org || !user) return [];
		return my_rule_rows(d.rules, d.channels, { id: String(user.id), email: user.email ?? null, is_owner: org.role === 'owner' }, org.id);
	}, [d, org, user]);
	const reaching = new Set(rows.filter((r) => r.reach !== 'none').map((r) => r.rule.event));
	const shared_only = new Set(rows.map((r) => r.rule.event).filter((e) => !reaching.has(e)));
	const shown = mine_only ? rows.filter((r) => r.reach !== 'none') : rows;
	const groups: Array<{ family: string; rows: My_rule_row[] }> = [];
	for (const r of [...shown].sort((a, b) => event_family(a.rule.event).localeCompare(event_family(b.rule.event)))) {
		const fam = event_family(r.rule.event);
		if (groups.at(-1)?.family !== fam) groups.push({ family: fam, rows: [] });
		groups.at(-1)!.rows.push(r);
	}
	const more_realms = d && d.realm_page.total > d.realm_page.limit;
	const events_href = view_href('/notifications', scope, multi_org);
	const check_href = view_href('/notifications?tab=check', scope, multi_org);

	return (
		<Graphite_shell data={overview.data} title="My notifications">
			<div className="flex flex-col gap-[18px] px-7 py-6">
				<div>
					<h1 className="text-[24px] font-semibold tracking-[-0.02em]">My notifications</h1>
					<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">
						What reaches you{org ? <> in <b className="text-[var(--g-ink)]">{org.display_name || org.slug}</b></> : null}, and where. Org admins change the rules on the <Link to={events_href} className="underline decoration-dotted underline-offset-2 hover:text-[var(--g-ink)]">Events</Link> page.
					</p>
				</div>

				{center.status === 'loading' || overview.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : null}
				{center.status === 'error' && !d ? <p role="alert" className="text-[13px] text-[var(--g-bad)]">{center.error}</p> : null}

				{d ? (
					<>
						<div className="flex flex-wrap items-center gap-2" data-testid="my-summary">
							<span className="text-[13px]"><b>{reaching.size}</b> <span className="text-[var(--g-ink-3)]">{reaching.size === 1 ? 'event reaches' : 'events reach'} you</span></span>
							<span className="text-[var(--g-ink-3)]">·</span>
							<span className="text-[13px]"><b>{shared_only.size}</b> <span className="text-[var(--g-ink-3)]">only go to shared places</span></span>
							<div className="ml-auto flex gap-1.5">
								<button type="button" aria-pressed={mine_only} onClick={() => set_mine_only(true)} className={PILL(mine_only)}>Reaches me</button>
								<button type="button" aria-pressed={!mine_only} onClick={() => set_mine_only(false)} className={PILL(!mine_only)}>Everything</button>
							</div>
						</div>

						{d.partial ? <p role="status" className="text-[12.5px] text-[var(--g-warn)]">Some rules couldn’t be loaded; this may be incomplete.</p> : null}

						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{groups.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<th className="px-4 py-2.5 font-semibold">Event</th>
											<th className="px-4 py-2.5 font-semibold">Where</th>
											<th className="px-4 py-2.5 font-semibold">Reaches you</th>
											<th className="px-4 py-2.5 font-semibold">Also posted to</th>
										</tr>
									</thead>
									{groups.map((g) => (
										<tbody key={g.family}>
											<tr><td colSpan={4} className="border-b border-[var(--g-line-2)] bg-[#121316] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g.family}</td></tr>
											{g.rows.map((r) => (
												<tr key={r.rule.id} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`my-rule-${r.rule.id}`}>
													<td className="px-4 py-2.5">
														<b className="block truncate text-[13px] font-semibold">{event_label(r.rule.event)}</b>
														<span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{r.rule.event}</span>
													</td>
													<td className="px-4 py-2.5"><Scope_tag kind={r.rule.scope.kind} text={r.rule.scope.kind === 'org' ? 'every realm' : scope_text(r.rule.scope)} /></td>
													<td className="px-4 py-2.5"><Reach_badge reach={r.reach} /></td>
													<td className="px-4 py-2.5 text-[var(--g-ink-2)]">{r.shared.length ? r.shared.join(', ') : <span className="text-[var(--g-ink-3)]">—</span>}</td>
												</tr>
											))}
										</tbody>
									))}
								</table>
							) : (
								<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
									<BellRing aria-hidden className="h-6 w-6 text-[var(--g-ink-3)]" />
									<p className="text-[14px] font-semibold">{mine_only ? 'Nothing is set to reach you' : 'This org has no notification rules'}</p>
									<p className="text-[12.5px] text-[var(--g-ink-3)]">HUGs still show up in HUGs, and events in the inbox.</p>
								</div>
							)}
						</div>

						<p className="text-[12px] text-[var(--g-ink-3)]">
							{more_realms ? <>Covers rules for the first {d.realm_page.limit} of {d.realm_page.total} realms. </> : null}
							A realm or team rule can replace an org-wide one for that realm; <Link to={check_href} className="underline decoration-dotted underline-offset-2 hover:text-[var(--g-ink)]">check a realm</Link> for the exact result.
							“Your inbox” is the realm inbox everyone in that realm sees; Slack and webhooks reach whoever is in that channel.
						</p>
					</>
				) : null}
			</div>
		</Graphite_shell>
	);
}

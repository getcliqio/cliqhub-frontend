/**
 * Admin › Catalog › Teams (AD5) — what the Marketplace shows, and what shouldn't be there.
 * Read: `POST /v1/admin_list/get {kind:'teams', org_id?, realm_id?}` (listed | unlisted + counts;
 * org = owning scope's org, realm = installed on one of its daemons).
 * Writes: teams/unpublish (back to draft, off the Marketplace) · teams/publish (list publicly).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { team_href } from '@/lib/team_page';
import { ago, type Admin_list_data, type Admin_team_row } from '@/lib/admin';
import { Admin_header, Banner, Chips, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Org_filter, Realm_filter } from '@/components/graphite/g_lookup';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_BTN, G_INPUT, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { ROW_OPENS, Row_open, use_row_open } from '@/components/graphite/g_row';

type Filter = 'listed' | 'unlisted';
const LIMIT = 25;

function Market_cell({ t }: { t: Admin_team_row }) {
	if (t.listed_without_version) return <Pill tone="warn">! Listed · no version</Pill>;
	if (t.listed) return <Pill tone="ok">Listed</Pill>;
	if (t.visibility === 'draft') return <Pill tone="warn">Draft</Pill>;
	return <Pill tone="muted">{t.visibility === 'public' ? 'Public · unlisted' : 'Private'}</Pill>;
}

export function Component() {
	const row = use_row_open();
	const [sp, set_sp] = useSearchParams();
	const filter = (sp.get('filter') === 'unlisted' ? 'unlisted' : 'listed') as Filter;
	const q = sp.get('q') ?? '';
	const org_id = sp.get('org') ?? '';
	const realm_id = sp.get('realm') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const [draft, set_draft] = useState(q);
	const [busy, set_busy] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const post = use_post();
	const sort = use_table_sort({ keys: ['name', 'install_count', 'created_at', 'updated_at'], default_sort: { by: 'updated_at', dir: 'desc' }, first_dir: { install_count: 'desc', updated_at: 'desc', created_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_team_row>>('/v1/admin_list/get', { kind: 'teams', filter, ...sort.body, limit: LIMIT, offset, ...(q ? { query: q } : {}), ...(org_id ? { org_id } : {}), ...(realm_id ? { realm_id } : {}) }, { fallback_error: 'Could not load teams.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		set_sp(n, { replace: true });
	};
	const full = (t: Admin_team_row) => (t.scope ? `@${t.scope}/${t.name}` : t.name);

	async function toggle(t: Admin_team_row) {
		set_busy(t.id); set_msg(null);
		const r = t.listed ? await post('/v1/teams/unpublish', { team_id: t.id }) : await post('/v1/teams/publish', { team_id: t.id, visibility: 'public' });
		set_busy(null);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_msg({ tone: 'ok', text: t.listed ? `${full(t)} is off the Marketplace (back to draft)` : `${full(t)} is listed` });
		void read.reload();
	}

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Teams" sub="Every team in the catalog. Listed teams show in the Marketplace." />
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Filter> value={filter} on_change={(k) => set({ filter: k === 'listed' ? null : k, offset: null })} options={[
					{ key: 'listed', label: 'Listed', count: d?.counts.listed },
					{ key: 'unlisted', label: 'Private & drafts', count: d?.counts.unlisted },
				]} />
				<Org_filter value={org_id} on_change={(v) => set({ org: v || null, realm: null, offset: null })} />
				<Realm_filter key={org_id} value={realm_id} org_id={org_id || undefined} on_change={(v) => set({ realm: v || null, offset: null })} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search teams" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Name or description" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="catalog" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="name" className={TH}>Team</Sort_th><th className={TH}>Org</th><th className={TH}>Author</th><th className={TH}>Versions</th><th className={TH}>Marketplace</th><Sort_th sort={cols} k="install_count" className={TH}>Installs</Sort_th><Sort_th sort={cols} k="updated_at" className={TH}>Updated</Sort_th><th className={TH} /></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={8}>Loading…</Empty_row> : null}
						{d && !d.items.length ? <Empty_row cols={8}>{q ? `No teams match “${q}”.` : 'Nothing here.'}</Empty_row> : null}
						{d?.items.map((t) => (
							<tr key={t.id} {...row({ to: team_href(t.scope, t.name) })} className={`${TR} ${ROW_OPENS}`} data-testid={`team-${t.name}`}>
								<td className="px-4 py-2.5"><Link to={team_href(t.scope, t.name)} className="g-mono font-semibold hover:underline">{full(t)}</Link>{t.description ? <div className="max-w-[360px] truncate text-[12px] text-[var(--g-ink-3)]">{t.description}</div> : null}</td>
								<td className="g-mono px-4 text-[12px] text-[var(--g-ink-2)]">{t.org_slug ?? '—'}</td>
								<td className="px-4 text-[var(--g-ink-2)]">{t.author_username ?? '—'}</td>
								<td className="g-mono px-4">{t.version_count ?? '—'}</td>
								<td className="px-4"><Market_cell t={t} /></td>
								<td className="g-mono px-4">{t.install_count.toLocaleString('en-US')}</td>
								<td className="px-4 text-[var(--g-ink-3)]">{t.updated_at ? `${ago(t.updated_at)} ago` : '—'}</td>
								<td className="px-4 text-right">
									<span className="mr-2 inline-block"><Row_open to={team_href(t.scope, t.name)} label={`Open ${full(t)}`} /></span>
									{t.listed || t.version_count ? <button type="button" disabled={busy === t.id} onClick={() => void toggle(t)} className={G_BTN}>{t.listed ? 'Unlist' : 'List'}</button> : null}
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
			</div>
			<p className="text-[12px] text-[var(--g-ink-3)]">Unlisting returns a team to draft; its versions and installs are kept. Every change here is audited.</p>
		</div>
	);
}

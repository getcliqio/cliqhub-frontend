/**
 * Marketplace › one scope (Graphite) — every team in `@scope`, listed or not.
 * Read: `POST /v1/teams/get` with `{ scope, mine: true }`, paged.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { team_href } from '@/lib/team_page';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';

const PAGE_SIZE = 20;

interface TeamRow {
	name: string;
	scope: string | null;
	description: string;
	latest_version: string;
	install_count: number;
	tags: string[];
	listed?: boolean;
}

export function Component() {
	const slug = useParams().slug as string;
	const { user, scopes } = useAuth();
	const auth_fetch = useOrgFetch();

	const [teams, set_teams] = useState<TeamRow[]>([]);
	const [total, set_total] = useState(0);
	const [offset, set_offset] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState('');

	const scope_info = scopes.find((s) => s.slug === slug);

	const load = useCallback(async () => {
		set_loading(true);
		set_error('');
		try {
			const res = await auth_fetch('/v1/teams/get', {
				method: 'POST',
				body: JSON.stringify({ scope: slug, mine: true, limit: PAGE_SIZE, offset }),
			});
			const data = await res.json();
			if (data.ok) {
				set_teams(data.data.teams);
				set_total(data.data.total ?? data.data.teams.length);
			} else {
				set_error(data.error?.message || 'Failed to load teams');
			}
		} catch {
			set_error('Network error');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, slug, offset]);

	useEffect(() => { set_offset(0); }, [slug]);
	useEffect(() => { void load(); }, [load]);

	const href = (t: TeamRow) => (user ? team_href(t.scope, t.name) : `/browse/${encodeURIComponent(t.scope || '_')}/${encodeURIComponent(t.name)}`);
	const to = Math.min(offset + PAGE_SIZE, total);

	return (
		<div className={`flex flex-col gap-4 py-6 ${user ? 'px-7' : 'mx-auto w-full max-w-6xl px-6'}`}>
			<div>
				<Link to="/browse" className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">← Marketplace</Link>
				<div className="mt-1 flex flex-wrap items-center gap-2.5">
					<h1 className="g-mono text-[22px] font-semibold tracking-tight">@{slug}</h1>
					{scope_info && scope_info.display_name !== slug ? <span className="text-[15px] text-[var(--g-ink-3)]">{scope_info.display_name}</span> : null}
					{scope_info ? (
						<span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${scope_info.visibility === 'public' ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]'}`}>{scope_info.visibility}</span>
					) : null}
				</div>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{loading ? '…' : `${total} team${total === 1 ? '' : 's'}`}</p>
			</div>

			{error ? (
				<div role="alert" className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[13px] text-[var(--g-bad)]">{error}</div>
			) : (
				<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
					{loading && !teams.length ? <div className="h-[240px] animate-pulse" aria-busy="true" aria-label="Loading teams" /> : null}
					{!loading && teams.length === 0 ? (
						<div className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">
							No teams in this scope yet.{user ? <> <Link to="/builder" className="text-[var(--g-acc)] hover:underline">Build one</Link>.</> : null}
						</div>
					) : null}
					{teams.map((t) => {
						const listed = t.listed !== false;
						return (
							<div key={`${t.scope}/${t.name}`} className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-3 last:border-b-0">
								<Team_avatar name={t.name} />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<Link to={href(t)} className="text-[13.5px] font-semibold text-[var(--g-ink)] hover:underline">{t.name}</Link>
										{t.latest_version ? <span className="g-mono rounded-[5px] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]">v{t.latest_version}</span> : null}
										<span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${listed ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]'}`}>
											<i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{listed ? 'Listed' : 'Unlisted'}
										</span>
									</div>
									<p className="truncate text-[12px] text-[var(--g-ink-3)]">{t.description || '—'}</p>
									<p className="mt-0.5 text-[11.5px] text-[var(--g-ink-3)]">{t.install_count.toLocaleString()} installs{t.tags.length ? ` · ${t.tags.join(', ')}` : ''}</p>
								</div>
								<Link to={href(t)} className={ROW_ACTION_CLS}>Open</Link>
							</div>
						);
					})}
					{total > PAGE_SIZE ? (
						<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
							<span>{offset + 1}–{to} of {total}</span>
							<button type="button" aria-label="Previous page" disabled={offset === 0} onClick={() => set_offset(Math.max(0, offset - PAGE_SIZE))} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
							<button type="button" aria-label="Next page" disabled={to >= total} onClick={() => set_offset(offset + PAGE_SIZE)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

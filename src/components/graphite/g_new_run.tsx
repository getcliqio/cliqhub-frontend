/**
 * New run — a right-hand drawer used everywhere a run is started (team page,
 * realm Teams, realm Runs, Run again). Closes with Esc; ⌘↵ starts the run.
 *
 * Reads:  team_page/get { view: 'run' } — the realms that have the team (with
 *         daemon counts), its inputs, human phases, and the chosen realm's
 *         people and notification channels. realm_teams/get when the team is
 *         picked here (realm Runs).
 * Writes: runs/enqueue { realm_id, payload, reviewers?, notify_channels? }.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, Plus, X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { run_href } from '@/lib/realm_inbox';
import { parse_run_inputs_text } from '@/lib/realm_teams_coverage';
import type { Team_input, Team_page_data } from '@/lib/team_page';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { G_drawer } from '@/components/graphite/g_team_get';

const PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const INPUT = 'h-9 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const LABEL = 'mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-semibold';

/** Inputs, run name and workspace to start from (Run again). */
export interface New_run_prefill {
	inputs: Record<string, unknown>;
	run_name?: string | null;
	workspace_path?: string | null;
	source_run_id?: string | null;
}

type Realm_ref = { id: string; slug: string; org_slug: string | null };

const as_text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
const shell_quote = (v: string): string => (/^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

/** The `cliq run` command that starts the same run from a terminal. */
export function cli_command(label: string, inputs: Record<string, string>, run_name: string): string {
	const parts = ['cliq run', '-t', label];
	for (const [k, v] of Object.entries(inputs)) if (v.trim()) parts.push('-i', shell_quote(`${k}=${v.trim()}`));
	if (run_name.trim()) parts.push('--name', shell_quote(run_name.trim()));
	return parts.join(' ');
}

function Field({ label, hint, required, children }: { label: ReactNode; hint?: string | null; required?: boolean; children: ReactNode }) {
	return (
		<label className="block">
			<span className={LABEL}>{label}{required ? <span className="text-[var(--g-bad)]" title="Required">*</span> : null}{hint ? <span className="font-normal text-[var(--g-ink-3)]">{hint}</span> : null}</span>
			{children}
		</label>
	);
}

/** People chips with an add menu; empty means "the team's default reviewers". */
function People_picker({ label, value, people, on_change, placeholder }: { label: string; value: string[]; people: string[]; on_change: (v: string[]) => void; placeholder: string }) {
	const [adding, set_adding] = useState(false);
	const left = people.filter((p) => !value.includes(p));
	return (
		<div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1.5" role="group" aria-label={label}>
			{value.map((p) => (
				<span key={p} className="inline-flex items-center gap-1 rounded-full bg-[var(--g-soft)] py-0.5 pl-1 pr-1.5 text-[12px]">
					<i aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-[var(--g-acc-soft)] text-[9px] font-bold not-italic text-[var(--g-acc)]">{p.slice(0, 2).toUpperCase()}</i>{p}
					<button type="button" aria-label={`Remove ${p}`} onClick={() => on_change(value.filter((x) => x !== p))} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X aria-hidden className="h-3 w-3" /></button>
				</span>
			))}
			{!value.length && !adding ? <span className="text-[12px] text-[var(--g-ink-3)]">{placeholder}</span> : null}
			{adding ? (
				<select autoFocus aria-label={`Add to ${label}`} value="" onBlur={() => set_adding(false)} onChange={(e) => { if (e.target.value) on_change([...value, e.target.value]); set_adding(false); }} className="h-6 rounded border border-[var(--g-line)] bg-[var(--g-bg)] text-[12px]">
					<option value="">Pick…</option>
					{left.map((p) => <option key={p} value={p}>{p}</option>)}
				</select>
			) : left.length ? <button type="button" onClick={() => set_adding(true)} className="ml-auto inline-flex items-center gap-0.5 text-[12px] text-[var(--g-acc)]"><Plus aria-hidden className="h-3 w-3" />add</button> : null}
		</div>
	);
}

/**
 * Start a run of a team in a realm that has it.
 *
 * @param team - The team, or null to pick one of the realm's teams here.
 * @param realm - Fix the realm (realm pages, Run again); otherwise pick among realms that have the team.
 * @param on_add_to_realm - Shown when no realm has the team yet (team page opens its Add drawer).
 */
export function New_run_drawer({ team, realm, prefill, on_close, on_add_to_realm }: {
	team: { scope: string; slug: string } | null;
	realm?: Realm_ref | null;
	prefill?: New_run_prefill | null;
	on_close: () => void;
	on_add_to_realm?: () => void;
}) {
	const auth_fetch = useAuthFetch();
	const navigate = useNavigate();
	const [picked, set_picked] = useState(team ? `${team.scope}/${team.slug}` : '');
	const [scope, slug] = picked ? [picked.slice(0, picked.indexOf('/')), picked.slice(picked.indexOf('/') + 1)] : ['', ''];
	const [realm_id, set_realm_id] = useState<string | null>(realm?.id ?? null);

	// Teams of the realm, when the team is picked here.
	const teams = use_bff_read<{ items: Array<{ scope: string | null; slug: string; label: string; version: string | null; in_team_list: boolean; installed_count: number; online_daemon_count: number }> }>(
		'/v1/realm_teams/get', !team && realm?.org_slug ? { org_slug: realm.org_slug, slug: realm.slug, limit: 100 } : null, { fallback_error: 'Could not load the realm’s teams.' },
	);
	const form_read = use_bff_read<Team_page_data>('/v1/team_page/get', picked ? { scope, name: slug, view: 'run', ...(realm_id ? { realm_id } : {}) } : null, { fallback_error: 'Could not load the run form.' });
	const data = form_read.data?.run ?? null;
	const header = form_read.data?.team ?? null;
	const realms = data?.realms ?? [];
	const chosen = realms.find((r) => r.realm_id === (realm_id ?? data?.realm_id)) ?? null;
	const label = header?.label ?? (picked ? `@${scope}/${slug}` : '');

	const [values, set_values] = useState<Record<string, string>>({});
	const [extras, set_extras] = useState('');
	const [reviewers, set_reviewers] = useState<Record<string, string[]>>({});
	const [channels, set_channels] = useState<string[]>([]);
	const [run_name, set_run_name] = useState(prefill?.run_name ?? '');
	const [where, set_where] = useState<'any' | 'workspace'>(prefill?.workspace_path ? 'workspace' : 'any');
	const [workspace, set_workspace] = useState(prefill?.workspace_path ?? '');
	const [advanced, set_advanced] = useState(false);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const seeded = useRef<string | null>(null);

	// Seed the fields once per team: Run again's inputs, else defaults.
	useEffect(() => {
		if (!data || seeded.current === picked) return;
		seeded.current = picked;
		const next: Record<string, string> = {};
		const declared = new Set(data.inputs.map((i) => i.name));
		for (const i of data.inputs) next[i.name] = prefill && i.name in prefill.inputs ? as_text(prefill.inputs[i.name]) : i.default ?? '';
		set_values(next);
		set_extras(prefill ? Object.entries(prefill.inputs).filter(([k]) => !declared.has(k)).map(([k, v]) => `${k}=${as_text(v)}`).join('\n') : '');
		if (prefill && Object.keys(prefill.inputs).some((k) => !declared.has(k))) set_advanced(true);
		set_reviewers({});
		set_channels([]);
	}, [data, picked, prefill]); // eslint-disable-line react-hooks/exhaustive-deps

	const missing = (data?.inputs ?? []).filter((i) => i.required && !(values[i.name] ?? '').trim()).map((i) => i.name);
	const people = useMemo(() => (data?.people ?? []).map((p) => p.username), [data]);
	const can_start = Boolean(chosen && data && !missing.length && !busy && (where === 'any' || workspace.trim()));
	const inputs_for_cli = useMemo(() => ({ ...values, ...Object.fromEntries(Object.entries(parse_run_inputs_text(extras)).map(([k, v]) => [k, as_text(v)])) }), [values, extras]);

	const start = useCallback(async () => {
		if (!chosen || !data || !can_start) return;
		set_busy(true); set_err(null);
		const inputs: Record<string, unknown> = {};
		for (const i of data.inputs) {
			const v = (values[i.name] ?? '').trim();
			if (!v) continue;
			inputs[i.name] = i.type === 'channel' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
		}
		Object.assign(inputs, parse_run_inputs_text(extras));
		const payload: Record<string, unknown> = { team_id: `${scope}/${slug}`, inputs };
		if (run_name.trim()) payload.run_name = run_name.trim();
		if (where === 'workspace' && workspace.trim()) payload.workspace_path = workspace.trim();
		const picked_reviewers = Object.fromEntries(Object.entries(reviewers).filter(([, v]) => v.length));
		const body: Record<string, unknown> = { realm_id: chosen.realm_id, payload };
		if (Object.keys(picked_reviewers).length) body.reviewers = picked_reviewers;
		if (channels.length) body.notify_channels = channels;
		try {
			const res = await auth_fetch('/v1/runs/enqueue', { method: 'POST', body: JSON.stringify(body) });
			const p = await res.json().catch(() => null);
			if (!res.ok || !p?.ok) {
				const field = p?.details?.field ?? p?.error?.details?.field;
				const unknown: string[] = p?.details?.unknown ?? p?.details?.unknown_phases ?? [];
				set_err(field === 'reviewers' ? `Reviewers not found: ${unknown.join(', ')}` : field === 'notify_channels' ? `Channels not found: ${unknown.join(', ')}` : api_message(p, 'Couldn’t start the run.'));
				return;
			}
			const item = (p.data?.item ?? p.item ?? null) as { status?: string; error?: string | null; run_id?: string | null } | null;
			if (item?.status === 'failed') { set_err(item.error?.trim() || 'No daemon could start the run.'); return; }
			if (item?.status === 'queued' || item?.status === 'offered') {
				set_err(`Queued, but no daemon has picked it up yet. Check that a daemon in ${chosen.realm_slug} is online.`);
				return;
			}
			if (item?.run_id && chosen.org_slug) navigate(run_href(chosen.org_slug, chosen.realm_slug, item.run_id));
			on_close();
		} catch {
			set_err('Network error — the run was not started.');
		} finally {
			set_busy(false);
		}
	}, [auth_fetch, can_start, channels, chosen, data, extras, navigate, on_close, reviewers, run_name, scope, slug, values, where, workspace]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void start(); } };
		document.addEventListener('keydown', h);
		return () => document.removeEventListener('keydown', h);
	}, [start]);

	const input_field = (i: Team_input) => {
		const v = values[i.name] ?? '';
		const set = (x: string) => set_values((prev) => ({ ...prev, [i.name]: x }));
		const long = (i.description ?? '').length > 140 || /prompt|description|body|instructions|notes|yaml|json/.test(i.name);
		return (
			<Field key={i.name} label={<span className="g-mono">{i.name}</span>} hint={i.description} required={i.required}>
				{long
					? <textarea aria-label={i.name} rows={3} value={v} onChange={(e) => set(e.target.value)} className={`${INPUT} h-auto py-2`} />
					: <input aria-label={i.name} value={v} onChange={(e) => set(e.target.value)} placeholder={i.type === 'channel' ? 'names, comma separated' : i.default ?? ''} className={INPUT} />}
			</Field>
		);
	};

	const human_gates = data?.human_phases.length ?? 0;
	const where_title = chosen ? <>in <b>{chosen.realm_slug}</b></> : realm ? <>in <b>{realm.slug}</b></> : null;

	return (
		<G_drawer
			label="New run"
			width={560}
			title="New run"
			sub={where_title}
			on_close={on_close}
			footer={
				<div className="grid w-full gap-2.5">
					{label && data ? <pre className="g-mono overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-[var(--g-line)] bg-[#0e0f11] px-3 py-2 text-[11.5px] text-[#b5e27a]" data-testid="cli-preview">$ {cli_command(label, inputs_for_cli, run_name)}</pre> : null}
					<div className="flex items-center gap-2">
						<span className="text-[12px] text-[var(--g-ink-3)]">{data ? (human_gates ? `${human_gates} human review${human_gates === 1 ? '' : 's'} on the way` : 'No human reviews — runs straight through') : ''}</span>
						<button type="button" onClick={on_close} className={`${ROW_ACTION_CLS} ml-auto`}>Cancel</button>
						<button type="button" disabled={!can_start} onClick={() => void start()} className={PRIMARY} title={missing.length ? `Fill in ${missing.join(', ')}` : undefined}>{busy ? 'Starting…' : 'Start run'} <span className="g-mono text-[11px] opacity-70">⌘↵</span></button>
					</div>
				</div>
			}
		>
			<div className="grid gap-4">
				{prefill?.source_run_id ? <p className="rounded-md bg-[var(--g-acc-soft)] px-3 py-1.5 text-[12px] text-[var(--g-ink-2)]" data-testid="prefill-source-hint">Inputs copied from run <span className="g-mono">{prefill.source_run_id.slice(0, 8)}</span> — change anything before starting.</p> : null}

				<Field label="Team">
					{team ? (
						<div className="flex h-10 items-center gap-2.5 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-3">
							<span className="g-mono truncate text-[13px] font-semibold">{label}</span>
							{header?.latest_version ? <span className="g-mono text-[12px] text-[var(--g-ink-3)]">v{chosen?.version ?? header.latest_version}</span> : null}
							{chosen ? <Daemon_pill installed={chosen.installed_count} online={chosen.online_daemon_count} /> : null}
						</div>
					) : (
						<select aria-label="Team" value={picked} onChange={(e) => { set_picked(e.target.value); set_err(null); }} className={INPUT}>
							<option value="">{teams.status === 'loading' ? 'Loading teams…' : 'Pick a team…'}</option>
							{(teams.data?.items ?? []).filter((t) => t.in_team_list && t.scope).map((t) => <option key={t.label} value={`${t.scope}/${t.slug}`}>{t.label}{t.version ? ` · v${t.version}` : ''} · {t.installed_count}/{t.online_daemon_count} daemons</option>)}
						</select>
					)}
				</Field>

				{!picked ? null : form_read.status === 'error' ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{form_read.error}</p> : !data ? (
					<div className="h-40 animate-pulse rounded-lg bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />
				) : realms.length === 0 ? (
					<div className="rounded-xl border border-dashed border-[var(--g-line)] px-4 py-5 text-[13px] text-[var(--g-ink-2)]">
						<p><b className="g-mono">{label}</b> isn’t in any of your realms yet, so there is nowhere to run it.</p>
						{on_add_to_realm ? <button type="button" onClick={on_add_to_realm} className={`${PRIMARY} mt-3`}><Plus aria-hidden className="h-3.5 w-3.5" />Add to a realm</button> : null}
					</div>
				) : (
					<>
						{!realm && realms.length > 1 ? (
							<Field label="Realm">
								<select aria-label="Realm" value={chosen?.realm_id ?? ''} onChange={(e) => set_realm_id(e.target.value)} className={INPUT}>
									{realms.map((r) => <option key={r.realm_id} value={r.realm_id}>{r.org_slug ? `${r.org_slug} › ` : ''}{r.realm_slug} · {r.installed_count}/{r.online_daemon_count} daemons</option>)}
								</select>
							</Field>
						) : null}
						{realm && !chosen ? <p role="alert" className="text-[12.5px] text-[var(--g-warn-text)]">{label} isn’t on {realm.slug}’s team list.</p> : null}

						{data.inputs.length ? data.inputs.map(input_field) : <p className="text-[12.5px] text-[var(--g-ink-3)]">This team takes no inputs.</p>}

						{data.human_phases.map((h) => (
							<div key={h.name}>
								<p className={LABEL}>Reviewers <span className="font-normal text-[var(--g-ink-3)]">for <span className="g-mono">{h.name}</span></span></p>
								<People_picker label={`Reviewers for ${h.name}`} value={reviewers[h.name] ?? []} people={people} on_change={(v) => set_reviewers((prev) => ({ ...prev, [h.name]: v }))}
									placeholder={h.default_reviewers ? `Team default: ${h.default_reviewers}` : 'Team default reviewers'} />
							</div>
						))}

						<div>
							<p className={LABEL}>Where to run</p>
							<div role="radiogroup" aria-label="Where to run" className="grid gap-2">
								<label className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 ${where === 'any' ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}>
									<input type="radio" name="where" checked={where === 'any'} onChange={() => set_where('any')} className="mt-0.5 accent-[var(--g-acc)]" />
									<span><b className="block text-[13px]">Any daemon that has it</b>
										<span className="text-[12px] text-[var(--g-ink-3)]">{chosen ? (chosen.installed_count ? `Offered to the ${chosen.installed_count} online daemon${chosen.installed_count === 1 ? '' : 's'} in ${chosen.realm_slug} with the team installed; the first free one takes it.` : `No daemon in ${chosen.realm_slug} has it installed and online right now; the run waits until one does.`) : ''}</span></span>
								</label>
								<label className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 ${where === 'workspace' ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}>
									<input type="radio" name="where" checked={where === 'workspace'} onChange={() => set_where('workspace')} className="mt-0.5 accent-[var(--g-acc)]" />
									<span className="min-w-0 flex-1"><b className="block text-[13px]">In a folder on the daemon</b>
										<span className="text-[12px] text-[var(--g-ink-3)]">Run against an existing checkout, e.g. ~/src/payments-api.</span>
										{where === 'workspace' ? <input aria-label="Workspace path" autoFocus value={workspace} onChange={(e) => set_workspace(e.target.value)} placeholder="~/src/payments-api" className={`${INPUT} g-mono mt-2`} /> : null}
									</span>
								</label>
							</div>
						</div>

						<div>
							<button type="button" aria-expanded={advanced} onClick={() => set_advanced(!advanced)} className="inline-flex items-center gap-1 text-[12.5px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
								<ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform ${advanced ? 'rotate-90' : ''}`} />More options — run name, who gets notified, extra inputs
							</button>
							{advanced ? (
								<div className="mt-3 grid gap-4 border-l border-[var(--g-line)] pl-4">
									<Field label="Run name" hint="shown in lists; leave blank to name it after the inputs">
										<input aria-label="Run name" value={run_name} onChange={(e) => set_run_name(e.target.value)} className={INPUT} />
									</Field>
									<div>
										<p className={LABEL}>Notify <span className="font-normal text-[var(--g-ink-3)]">instead of the realm’s usual rules, for when this run finishes, fails or needs someone</span></p>
										<People_picker label="Notify channels" value={channels} people={(data.channels ?? []).filter((c) => c.enabled).map((c) => c.name)} on_change={set_channels} placeholder="The realm’s notification rules" />
									</div>
									<Field label="Extra inputs" hint="key=value, one per line">
										<textarea aria-label="Extra inputs" rows={3} value={extras} onChange={(e) => set_extras(e.target.value)} placeholder={'region=us-west'} className={`${INPUT} g-mono h-auto py-2`} />
									</Field>
								</div>
							) : null}
						</div>
					</>
				)}
				{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
			</div>
		</G_drawer>
	);
}

function Daemon_pill({ installed, online }: { installed: number; online: number }) {
	const ok = installed > 0;
	return <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${ok ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]'}`}><i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{installed}/{online} daemons</span>;
}

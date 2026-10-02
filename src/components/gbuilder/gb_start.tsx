/**
 * Builder start screen: every way in on one page.
 *   · describe it → Core `teams/build` generate (+ status polling)
 *   · blank canvas · template · fork (Marketplace) · import team.yml / JSON / paste
 *   · continue a draft — one read: `POST /v1/team_list/get {status: 'draft'}`.
 */
import { useRef, useState } from 'react';
import yaml from 'js-yaml';
import { Link } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import type { GeneratedTeam } from '@/lib/builder/store';
import { SAMPLE_TEAMS } from '@/lib/builder/sample_teams';
import { empty_builder_team } from '@/lib/builder/empty_team';
import { normalize_builder_team } from '@/lib/builder/session_restore';
import { parse_yaml } from '@/lib/builder/yaml_tools';
import { KINDS, kind_of, role_need, starter_role } from '@/lib/builder/kinds';
import type { Team_list_data } from '@/lib/team_page';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';

export const STAGES: Array<{ id: string; label: string }> = [
	{ id: 'designing', label: 'Designing phases' },
	{ id: 'filling_roles', label: 'Writing role briefs' },
	{ id: 'validating', label: 'Validating' },
];

export const EXAMPLES: Array<[string, string]> = [
	['Ticket → PR with sign-off', 'Take a Jira ticket to a reviewed pull request: an architect writes the design, a human signs it off, tests and a security scan run in parallel, implementation must pass lint + tests (max 3 tries), then open a PR.'],
	['Nightly ledger reconciliation', 'Every night, reconcile the ledger export in S3 against the bank statement and post a summary of mismatches.'],
	['Summarise KYC packets', 'Summarise each KYC packet from Google Drive into a one-page brief and have a compliance reviewer approve it.'],
	['Docs from a Confluence spec', 'Turn a feature spec in Confluence into user docs, check links and spelling, and publish back to Confluence.'],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Missing role briefs get a starter, so a template opens without red. */
export function with_starter_roles(team: GeneratedTeam): GeneratedTeam {
	const have = new Set(team.roles.map((r) => r.name));
	const add = team.phases.filter((p) => role_need(p) === 'required' && !have.has(p.name)).map((p) => ({ name: p.name, content: starter_role(kind_of(p), p.name) }));
	return add.length ? { ...team, roles: [...team.roles, ...add] } : team;
}

/** parse_yaml keeps the base identity; for a new team take name/version from the text (scope dropped — you publish to yours). */
function with_identity(text: string, team: GeneratedTeam): GeneratedTeam {
	try {
		const doc = yaml.load(text) as { name?: unknown; version?: unknown } | null;
		const name = typeof doc?.name === 'string' && doc.name.trim() ? doc.name.trim().replace(/^@[^/]+\//, '') : team.name;
		const version = typeof doc?.version === 'string' ? doc.version : team.version;
		return { ...team, name, version };
	} catch { return team; }
}

export function template_team(i: number): GeneratedTeam | null {
	const t = SAMPLE_TEAMS[i];
	const r = parse_yaml(t.yaml, empty_builder_team());
	if (!r.ok) return null;
	return with_starter_roles(with_identity(t.yaml, { ...r.team, description: r.team.description || t.description }));
}

/** team.yml text or builder JSON → a team, or an error to show. */
export function import_text(text: string): { team: GeneratedTeam } | { error: string } {
	const t = text.trim();
	if (!t) return { error: 'Nothing to import.' };
	if (t.startsWith('{')) {
		try {
			const team = normalize_builder_team(JSON.parse(t));
			return team ? { team } : { error: 'That JSON isn’t a team (it needs a name and phases).' };
		} catch { return { error: 'That JSON doesn’t parse.' }; }
	}
	const r = parse_yaml(t, empty_builder_team());
	if (!r.ok) return { error: `Line ${r.line ?? '?'}: ${r.error}` };
	if (!r.team.phases.length) return { error: 'No phases found — is this a team.yml?' };
	return { team: with_starter_roles(with_identity(t, r.team)) };
}

function Shape({ team }: { team: GeneratedTeam | null }) {
	if (!team) return null;
	return (
		<span className="mt-2 flex gap-[3px]" aria-hidden>
			{team.phases.slice(0, 12).map((p) => <i key={p.name} className="block h-1.5 w-5 rounded-full" style={{ background: KINDS[kind_of(p)].color }} />)}
		</span>
	);
}

export function Gb_start({ on_team }: { on_team: (team: GeneratedTeam, how: 'blank' | 'generated' | 'template' | 'import') => void }) {
	const auth_fetch = useAuthFetch();
	const { user } = useAuth();
	const [intent, set_intent] = useState('');
	const [stage, set_stage] = useState<string | null>(null);
	const [error, set_error] = useState<string | null>(null);
	const [paste, set_paste] = useState<string | null>(null);
	const [import_err, set_import_err] = useState<string | null>(null);
	const [drag_over, set_drag_over] = useState(false);
	const file_ref = useRef<HTMLInputElement>(null);
	const templates_ref = useRef<HTMLDivElement>(null);
	const cancelled = useRef(false);
	const drafts = use_bff_read<Team_list_data>('/v1/team_list/get', user ? { status: 'draft', limit: 5 } : null, { fallback_error: 'Couldn’t load drafts.' });

	async function generate() {
		const text = intent.trim();
		if (!text || stage) return;
		cancelled.current = false;
		set_error(null); set_stage('queued');
		try {
			const res = await auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({ action: 'generate', intent: text }) });
			const start = await res.json().catch(() => null);
			if (!res.ok || !start?.ok || !start.data?.job_id) { set_error(api_message(start, res.status === 401 ? 'Sign in to generate teams.' : 'Couldn’t start generation.')); set_stage(null); return; }
			const job_id = start.data.job_id as string;
			if (start.data.stage) set_stage(start.data.stage);
			const deadline = Date.now() + 10 * 60 * 1000;
			while (Date.now() < deadline) {
				await sleep(1500);
				if (cancelled.current) return;
				const poll = await auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({ action: 'status', job_id }) });
				const body = await poll.json().catch(() => null);
				if (!poll.ok) { set_error(api_message(body, 'Generation failed.')); set_stage(null); return; }
				const job = body?.data;
				if (!job) continue;
				if (job.stage) set_stage(job.stage);
				if (job.status === 'done' && job.team) {
					const team = normalize_builder_team(job.team);
					if (!team) { set_error('The builder returned an empty team — try rephrasing.'); set_stage(null); return; }
					set_stage(null); on_team(team, 'generated'); return;
				}
				if (job.status === 'error') { set_error(job.error?.message || 'Generation failed.'); set_stage(null); return; }
			}
			set_error('Generation is taking too long — try again in a moment.'); set_stage(null);
		} catch {
			set_error('Couldn’t reach the builder (network error).'); set_stage(null);
		}
	}

	function load_import(text: string) {
		const r = import_text(text);
		if ('error' in r) { set_import_err(r.error); return; }
		set_import_err(null); set_paste(null); on_team(r.team, 'import');
	}
	async function read_file(f: File | undefined) {
		if (!f) return;
		if (/\.zip$/i.test(f.name)) { set_import_err('Zip packages aren’t supported here yet — drop the team.yml instead.'); return; }
		load_import(await f.text());
	}

	if (stage) {
		const at = STAGES.findIndex((s) => s.id === stage);
		return (
			<div className="grid h-full place-items-center px-6" data-testid="generating">
				<div className="w-full max-w-[520px] text-center">
					<div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-2 border-[var(--g-line)] border-t-[#9b8cff]" aria-hidden />
					<h2 className="text-[20px] font-semibold tracking-tight">Building your team…</h2>
					<p className="mt-1 line-clamp-2 text-[12.5px] text-[var(--g-ink-3)]">“{intent.trim()}”</p>
					<ol className="mx-auto mt-6 grid max-w-[300px] gap-2 text-left" role="status" aria-live="polite">
						{STAGES.map((s, i) => {
							const state = at === -1 ? 'todo' : i < at ? 'done' : i === at ? 'now' : 'todo';
							return (
								<li key={s.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] ${state === 'now' ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)]'}`}>
									<span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${state === 'done' ? 'bg-[var(--g-ok)] text-black' : state === 'now' ? 'animate-pulse bg-[#9b8cff]' : 'border border-[var(--g-line)]'}`}>{state === 'done' ? '✓' : ''}</span>
									{s.label}{state === 'done' ? <span className="sr-only"> done</span> : null}
								</li>
							);
						})}
					</ol>
					<p className="mt-5 text-[12px] text-[var(--g-ink-3)]">Usually under a minute. The canvas opens when it’s ready.</p>
					<button type="button" onClick={() => { cancelled.current = true; set_stage(null); }} className="mt-3 text-[12.5px] text-[var(--g-ink-3)] underline hover:text-[var(--g-ink)]">Cancel</button>
				</div>
			</div>
		);
	}

	const draft_items = drafts.data?.items ?? [];
	return (
		<div className="h-full overflow-y-auto" data-testid="builder-start" style={{ background: 'radial-gradient(900px 380px at 50% -60px, rgba(124,108,255,.18), transparent 70%)' }}>
			<div className="mx-auto max-w-[900px] px-6 pb-16 pt-12">
				<div className="text-center">
					<span className="inline-block rounded-full border border-[rgba(155,140,255,.4)] bg-[rgba(155,140,255,.1)] px-3 py-0.5 text-[12px] font-semibold text-[#cfc7ff]">✦ cliq builder</span>
					<h1 className="mt-4 text-[34px] font-semibold tracking-tight">What should your team do?</h1>
					<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">Describe the job. We’ll design the phases, write every role brief and validate it — then you shape it on the canvas.</p>
				</div>
				<form onSubmit={(e) => { e.preventDefault(); void generate(); }} className="mt-7 rounded-2xl p-px" style={{ background: 'linear-gradient(135deg,rgba(124,108,255,.8),rgba(255,122,217,.45),rgba(45,212,191,.55))' }}>
					<div className="rounded-[15px] bg-[#121316] p-4">
						<textarea aria-label="Describe your team" value={intent} onChange={(e) => set_intent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }} rows={3} placeholder="e.g. Take a Jira ticket to a reviewed pull request…" className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--g-ink)] outline-none placeholder:text-[#5d616b]" />
						<div className="mt-2 flex items-center gap-2">
							<span className="text-[11.5px] text-[var(--g-ink-3)]">Mention reviews, retries, parallel steps, tools — the more concrete, the better.</span>
							<span className="ml-auto g-mono text-[11px] text-[var(--g-ink-3)]">⌘↵</span>
							<button type="submit" disabled={!intent.trim()} className="rounded-lg bg-[var(--g-acc)] px-4 py-2 text-[13px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">✦ Generate team</button>
						</div>
					</div>
				</form>
				{error ? <p role="alert" className="mt-2 text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
				<div className="mt-3 flex flex-wrap justify-center gap-2">
					{EXAMPLES.map(([label, x]) => (
						<button key={label} type="button" onClick={() => set_intent(x)} className="rounded-full border border-[var(--g-line)] px-3 py-1 text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]" title={x}>{label}</button>
					))}
				</div>

				<p className="mb-2 mt-10 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Or start another way</p>
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					<button type="button" onClick={() => on_team(empty_builder_team(), 'blank')} className="rounded-xl border border-[var(--g-line)] bg-[#141518] p-4 text-left hover:border-[var(--g-acc-line)]">
						<span className="grid h-9 w-9 place-items-center rounded-lg bg-[rgba(155,140,255,.14)] text-[#9b8cff]">✥</span>
						<b className="mt-3 block text-[14px]">Blank canvas</b>
						<span className="mt-1 block text-[12px] text-[var(--g-ink-3)]">Drag phases onto the canvas and wire them up.</span>
						<span className="mt-2 block text-[12.5px] font-semibold text-[#9b8cff]">Open canvas →</span>
					</button>
					<button type="button" onClick={() => templates_ref.current?.scrollIntoView?.({ behavior: 'smooth' })} className="rounded-xl border border-[var(--g-line)] bg-[#141518] p-4 text-left hover:border-[var(--g-acc-line)]">
						<span className="grid h-9 w-9 place-items-center rounded-lg bg-[rgba(45,212,191,.14)] text-[#2dd4bf]">▤</span>
						<b className="mt-3 block text-[14px]">From a template</b>
						<span className="mt-1 block text-[12px] text-[var(--g-ink-3)]">Proven shapes: gates, pipelines, fan-out.</span>
						<span className="mt-2 block text-[12.5px] font-semibold text-[#2dd4bf]">Browse templates →</span>
					</button>
					<Link to="/marketplace" className="rounded-xl border border-[var(--g-line)] bg-[#141518] p-4 text-left hover:border-[var(--g-acc-line)]">
						<span className="grid h-9 w-9 place-items-center rounded-lg bg-[rgba(91,157,255,.14)] text-[#5b9dff]">⑂</span>
						<b className="mt-3 block text-[14px]">Fork a team</b>
						<span className="mt-1 block text-[12px] text-[var(--g-ink-3)]">Start from any team in the Marketplace, then make it yours.</span>
						<span className="mt-2 block text-[12.5px] font-semibold text-[#5b9dff]">Pick a team →</span>
					</Link>
					<div
						data-testid="import-drop"
						onDragOver={(e) => { e.preventDefault(); set_drag_over(true); }}
						onDragLeave={() => set_drag_over(false)}
						onDrop={(e) => { e.preventDefault(); set_drag_over(false); void read_file(e.dataTransfer.files?.[0]); }}
						className={`flex flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center ${drag_over ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}
					>
						<span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--g-soft)]">⤓</span>
						<b className="mt-2 block text-[14px]">Import</b>
						<span className="mt-1 block text-[12px] text-[var(--g-ink-3)]">Drop a <span className="g-mono">team.yml</span> here</span>
						<span className="mt-2 flex gap-2 text-[12.5px] font-semibold">
							<button type="button" onClick={() => file_ref.current?.click()} className="text-[var(--g-acc)]">Choose file</button>
							<span className="text-[var(--g-ink-3)]">·</span>
							<button type="button" onClick={() => { set_paste(''); set_import_err(null); }} className="text-[var(--g-acc)]">Paste YAML</button>
						</span>
						<input ref={file_ref} type="file" accept=".yml,.yaml,.json,.zip" aria-label="Import file" className="hidden" onChange={(e) => void read_file(e.target.files?.[0])} />
					</div>
				</div>
				{import_err && paste === null ? <p role="alert" className="mt-2 text-[12.5px] text-[var(--g-bad)]">{import_err}</p> : null}
				{paste !== null ? (
					<div className="mt-3 rounded-xl border border-[var(--g-line)] bg-[#121316] p-3" data-testid="paste-box">
						<textarea aria-label="Paste team.yml" autoFocus value={paste} onChange={(e) => set_paste(e.target.value)} rows={9} placeholder={'name: my-team\nphases:\n  - name: design\n    type: standard'} className="g-mono w-full resize-y bg-transparent text-[12.5px] text-[var(--g-ink)] outline-none placeholder:text-[#5d616b]" />
						{import_err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{import_err}</p> : null}
						<div className="mt-2 flex justify-end gap-2">
							<button type="button" onClick={() => { set_paste(null); set_import_err(null); }} className="rounded-md border border-[var(--g-line)] px-3 py-1 text-[12.5px]">Cancel</button>
							<button type="button" disabled={!paste.trim()} onClick={() => load_import(paste)} className="rounded-md bg-[var(--g-acc)] px-3 py-1 text-[12.5px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">Open in builder</button>
						</div>
					</div>
				) : null}

				<div className="mt-10 grid gap-6 md:grid-cols-[1.35fr_1fr]">
					<div ref={templates_ref}>
						<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Templates</p>
						<div className="grid grid-cols-2 gap-2.5">
							{SAMPLE_TEAMS.map((t, i) => {
								const team = template_team(i);
								return (
									<button key={t.label} type="button" disabled={!team} onClick={() => team && on_team(team, 'template')} className="rounded-xl border border-[var(--g-line)] bg-[#141518] p-3 text-left hover:border-[var(--g-acc-line)] disabled:opacity-40" data-testid="template">
										<b className="block text-[13.5px]">{t.label}</b>
										<span className="mt-0.5 block line-clamp-2 text-[12px] text-[var(--g-ink-3)]">{t.description}</span>
										<Shape team={team} />
									</button>
								);
							})}
						</div>
					</div>
					<div>
						<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Continue a draft</p>
						{!user ? <p className="text-[12.5px] text-[var(--g-ink-3)]">Sign in to keep drafts.</p>
							: drafts.status === 'loading' ? <p className="text-[12.5px] text-[var(--g-ink-3)]">Loading…</p>
								: drafts.status === 'error' && !drafts.data ? <p className="text-[12.5px] text-[var(--g-ink-3)]">{drafts.error}</p>
									: !draft_items.length ? <p className="text-[12.5px] text-[var(--g-ink-3)]">No drafts yet — anything you start here autosaves.</p>
										: (
											<div className="grid gap-2">
												{draft_items.filter((d) => d.id).map((d) => (
													<Link key={d.id} to={`/builder?draft=${encodeURIComponent(d.id!)}`} className="flex items-center gap-3 rounded-xl border border-[var(--g-line)] bg-[#141518] px-3 py-2.5 hover:border-[var(--g-acc-line)]" data-testid="draft-row">
														<Team_avatar name={d.name} size={32} />
														<span className="min-w-0 flex-1"><b className="block truncate text-[13.5px]">{d.name}</b><span className="text-[12px] text-[var(--g-ink-3)]">{d.phase_types ? `${d.phase_types.length} phases` : 'draft'}{d.scope ? ` · @${d.scope}` : ''}</span></span>
														<span aria-hidden className="text-[var(--g-ink-3)]">›</span>
													</Link>
												))}
												{drafts.data && drafts.data.total > draft_items.length ? <Link to="/teams?status=draft" className="text-[12.5px] text-[var(--g-acc)]">All {drafts.data.total} drafts →</Link> : null}
											</div>
										)}
					</div>
				</div>
			</div>
		</div>
	);
}

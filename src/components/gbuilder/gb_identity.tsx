/**
 * The identity step (PLAN-team-bundle S3, §2.9): before a new team (or a fork) is made, ask for its scope (required,
 * no silent default; fixed afterwards), its name (checked live in that scope), its visibility (Private preselected)
 * and its first version (0.1.0, editable). An imported team.yml fills the fields; the person confirms them.
 *
 * Reads: `POST /v1/teams/get_versions {scope, name}` while the name is typed (a 404 means it's free).
 * The caller makes the team with what is confirmed (`teams/create`).
 */
import { useEffect, useState } from 'react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';

/** What the identity step confirms. */
export interface Team_identity {
	scope: string;
	name: string;
	visibility: 'private' | 'public';
	version: string;
}

const NAME = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/** A team name from any text: lowercase letters, digits and hyphens, starting with a letter. */
export function slug_of(text: string): string {
	return text.replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
}

type Name_check = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

export function Gb_identity({ title, initial, busy, error, on_confirm, on_cancel }: {
	title: string;
	/** Prefill (from an imported team.yml, a template or the team being forked). */
	initial: Partial<Team_identity>;
	busy: boolean;
	/** Core's answer when making the team failed (e.g. no `teams.publish` in that scope). */
	error: string | null;
	on_confirm: (identity: Team_identity) => void;
	on_cancel: () => void;
}) {
	const auth_fetch = useAuthFetch();
	const { scopes } = useAuth();
	// Only a scope the person can use is preselected, never a silent default.
	const [scope, set_scope] = useState(initial.scope && scopes.some((s) => s.slug === initial.scope) ? initial.scope : '');
	const [name, set_name] = useState(slug_of(initial.name ?? ''));
	const [visibility, set_visibility] = useState<'private' | 'public'>(initial.visibility ?? 'private');
	const [version, set_version] = useState(initial.version && SEMVER.test(initial.version) ? initial.version : '0.1.0');
	const [check, set_check] = useState<Name_check>('idle');

	useEffect(() => {
		if (!scope || !NAME.test(name)) { set_check('idle'); return; }
		let live = true;
		set_check('checking');
		const h = window.setTimeout(() => {
			auth_fetch('/v1/teams/get_versions', { method: 'POST', body: JSON.stringify({ scope, name, latest_only: true }) })
				.then((res) => { if (live) set_check(res.ok ? 'taken' : res.status === 404 ? 'free' : 'unknown'); })
				.catch(() => { if (live) set_check('unknown'); });
		}, 350);
		return () => { live = false; window.clearTimeout(h); };
	}, [auth_fetch, scope, name]);

	const name_problem = !name ? 'Give the team a name.' : !NAME.test(name) ? 'Lowercase letters, digits and hyphens, starting with a letter.' : check === 'taken' ? `@${scope}/${name} is taken.` : null;
	const version_problem = SEMVER.test(version) ? null : 'A version like 0.1.0.';
	const ready = Boolean(scope) && !name_problem && !version_problem && check !== 'checking' && !busy;

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[var(--g-backdrop)] p-4 backdrop-blur-[2px]">
			<form
				role="dialog" aria-modal="true" aria-label={title}
				onSubmit={(e) => { e.preventDefault(); if (ready) on_confirm({ scope, name, visibility, version }); }}
				className="w-full max-w-[520px] rounded-2xl border border-[var(--g-line)] bg-[var(--g-panel)] shadow-[var(--g-pop-shadow)]"
			>
				<div className="border-b border-[var(--g-line)] px-5 py-3.5"><b className="text-[16px]">{title}</b>
					<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">The scope and name are fixed once the team is made.</p></div>
				<div className="grid gap-4 px-5 py-4">
					<label className="grid gap-1 text-[12.5px]">Scope
						<select aria-label="Scope" required value={scope} onChange={(e) => set_scope(e.target.value)} className="rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1.5 text-[13px] text-[var(--g-ink)]">
							<option value="">Choose a scope…</option>
							{scopes.map((s) => <option key={s.slug} value={s.slug}>@{s.slug}{s.display_name && s.display_name !== s.slug ? ` — ${s.display_name}` : ''}</option>)}
						</select>
					</label>
					<label className="grid gap-1 text-[12.5px]">Name
						<span className="flex items-center gap-1"><span className="g-mono text-[13px] text-[var(--g-ink-3)]">@{scope || '…'}/</span>
							<input aria-label="Name" value={name} onChange={(e) => set_name(e.target.value.toLowerCase())} className="g-mono flex-1 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]" /></span>
						<span role="status" className={`text-[11.5px] ${name_problem ? 'text-[var(--g-bad)]' : 'text-[var(--g-ink-3)]'}`}>
							{name_problem ?? (!scope ? 'Choose a scope to check the name.' : check === 'checking' ? 'Checking…' : check === 'free' ? `@${scope}/${name} is free.` : check === 'unknown' ? 'Couldn’t check the name; it’s checked again when the team is made.' : '')}
						</span>
					</label>
					<fieldset className="grid gap-1 text-[12.5px]"><legend className="mb-1">Visibility</legend>
						<label className="flex items-center gap-2"><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => set_visibility('private')} className="accent-[var(--g-acc)]" />Private <span className="text-[11.5px] text-[var(--g-ink-3)]">only the scope’s members see and install it</span></label>
						<label className="flex items-center gap-2"><input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => set_visibility('public')} className="accent-[var(--g-acc)]" />Public <span className="text-[11.5px] text-[var(--g-ink-3)]">everyone, on the marketplace</span></label>
					</fieldset>
					<label className="grid gap-1 text-[12.5px]">First version
						<input aria-label="First version" value={version} onChange={(e) => set_version(e.target.value.trim())} className="g-mono w-[140px] rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]" />
						{version_problem ? <span className="text-[11.5px] text-[var(--g-bad)]">{version_problem}</span> : <span className="text-[11.5px] text-[var(--g-ink-3)]">Published when you first publish; every later version is higher.</span>}
					</label>
					{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
				</div>
				<div className="flex justify-end gap-2 border-t border-[var(--g-line)] px-5 py-3">
					<button type="button" onClick={on_cancel} disabled={busy} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[13px]">Cancel</button>
					<button type="submit" disabled={!ready} className="rounded-md bg-[var(--g-acc)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">{busy ? 'Making…' : `Make @${scope || '…'}/${name || '…'}`}</button>
				</div>
			</form>
		</div>
	);
}

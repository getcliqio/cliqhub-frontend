/**
 * A person in a list cell (who started a run, who published a team version): initials + name.
 * Core sends `{ id, username, display_name }` (API 8+); older rows have none and show "—".
 */

export interface Person_ref {
	id: string;
	username: string | null;
	display_name: string | null;
}

/** The name to show: display name, else username, else null. */
export function person_name(p: Person_ref | null | undefined): string | null {
	return p ? (p.display_name?.trim() || p.username?.trim() || null) : null;
}

/** Up to two initials from the name ("Sapan Shah" → "SS", "sapan" → "S"). */
export function person_initials(name: string): string {
	const parts = name.split(/[\s._-]+/).filter(Boolean);
	return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/** Initials + name, or `fallback` (default "—") when there is no person. */
export function Person({ p, fallback = '—' }: { p: Person_ref | null | undefined; fallback?: React.ReactNode }) {
	const name = person_name(p);
	if (!name) return <span className="text-[var(--g-ink-3)]">{fallback}</span>;
	return (
		<span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={p?.username ? `@${p.username}` : undefined}>
			<span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[var(--g-soft)] text-[9.5px] font-semibold text-[var(--g-ink-2)]">{person_initials(name)}</span>
			<span className="min-w-0 truncate">{name}</span>
		</span>
	);
}

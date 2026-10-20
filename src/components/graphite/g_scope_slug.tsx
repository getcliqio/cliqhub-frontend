/**
 * A new scope's slug inside an org: Core takes `<org>` or `<org>-<name>` (orgs/new_scope → 422
 * otherwise), so the `@<org>-` part is shown read-only and only the rest is typed.
 */
import { G_INPUT } from '@/components/graphite/g_agents';

/** What may follow `<org>-`: lowercase letters, digits and hyphens, starting with a letter or digit. */
export const SCOPE_REST = /^[a-z0-9][a-z0-9-]*$/;

/** The full slug sent to Core for `rest` typed after `@<org>-` (empty while nothing valid is typed). */
export function scope_slug(org_slug: string, rest: string): string {
	const r = rest.trim().toLowerCase();
	return org_slug && SCOPE_REST.test(r) ? `${org_slug}-${r}` : '';
}

/**
 * @param org_slug - The org the scope belongs to; nothing to type until it's known.
 * @param value - What's typed after the prefix.
 */
export function Scope_slug_field({ org_slug, value, on_change, label = 'Slug' }: {
	org_slug: string; value: string; on_change: (rest: string) => void; label?: string;
}) {
	return (
		<label className="text-[12.5px] text-[var(--g-ink-2)]">{label}
			<span className="mt-1 flex items-stretch">
				<span className="g-mono flex items-center rounded-l-md border border-r-0 border-[var(--g-line)] bg-[var(--g-soft)] px-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="scope-prefix">
					@{org_slug || '…'}-
				</span>
				<input
					aria-label="Scope slug"
					value={value}
					disabled={!org_slug}
					onChange={(e) => on_change(e.target.value.toLowerCase())}
					placeholder="data"
					style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
					className={`${G_INPUT} block w-[160px]`}
				/>
			</span>
		</label>
	);
}

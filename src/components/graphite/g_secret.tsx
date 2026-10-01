/**
 * Show-once secret (new or rotated token). Copy, copy as an export line, and an
 * explicit "I've saved it" before it can be dismissed.
 */
import { useState } from 'react';
import { G_BTN, G_PRIMARY } from '@/components/graphite/g_agents';

export function Secret_reveal({ title, secret, env_name, note, on_done }: { title: string; secret: string; env_name?: string; note?: string; on_done: () => void }) {
	const [saved, set_saved] = useState(false);
	const [copied, set_copied] = useState<string | null>(null);
	async function copy(text: string, what: string) {
		try { await navigator.clipboard.writeText(text); set_copied(what); setTimeout(() => set_copied(null), 1500); } catch { /* clipboard unavailable */ }
	}
	return (
		<div role="status" data-testid="secret-reveal" className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--g-acc-line)] bg-[linear-gradient(90deg,var(--g-acc-soft),transparent)] px-4 py-3.5">
			<b className="text-[13.5px]">{title} — copy it now, it won’t be shown again</b>
			<div className="flex flex-wrap gap-2">
				<code className="g-mono min-w-0 flex-1 truncate rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-1.5 text-[12.5px]" data-testid="secret-value">{secret}</code>
				<button type="button" onClick={() => void copy(secret, 'value')} className={G_BTN}>{copied === 'value' ? 'Copied' : 'Copy'}</button>
				{env_name ? <button type="button" onClick={() => void copy(`export ${env_name}=${secret}`, 'export')} className={G_BTN}>{copied === 'export' ? 'Copied' : 'Copy export line'}</button> : null}
			</div>
			{note ? <p className="text-[12px] text-[var(--g-ink-3)]">{note}</p> : null}
			<div className="flex items-center gap-2 text-[12.5px]">
				<label className="flex items-center gap-2"><input type="checkbox" checked={saved} onChange={(e) => set_saved(e.target.checked)} /> I’ve saved this token</label>
				<button type="button" disabled={!saved} onClick={on_done} className={`${G_PRIMARY} ml-auto`}>Done</button>
			</div>
		</div>
	);
}

/**
 * The answers so far: who, through which channel, what they decided (approved / rejected and where
 * to, or couldn't answer), their inputs, their words (a reason or a comment), and when.
 */
import { artifact_download_href } from '@/lib/artifact_view';
import { answer_summary, choice_label, hug_inputs, input_label, TEMPLATE_KEYS, type File_ref, type Hug, type Hug_response, type Requested_input } from '@/lib/hug';
import { Md } from '@/components/graphite/g_md';

function Value({ input, value }: { input: Requested_input | undefined; value: unknown }) {
	if (input?.type === 'file') {
		const files = (Array.isArray(value) ? value : [value]) as File_ref[];
		return <>{files.map((f) => <a key={f.artifact_id} href={artifact_download_href(f.artifact_id)} className="g-mono mr-2 underline">{f.name ?? f.artifact_id}</a>)}</>;
	}
	return <>{input ? choice_label(input, value) : String(value)}</>;
}

/** A response's words: a rejection's reason, a declined answer's reason, or a comment. */
function words(r: Hug_response): string | null {
	for (const k of ['reason', 'declined', 'comment']) {
		const v = r.values[k];
		if (typeof v === 'string' && v.trim()) return v;
	}
	return null;
}

export function Hug_responses({ hug, me }: { hug: Pick<Hug, 'responses' | 'params'>; me?: string | null }) {
	if (!hug.responses.length) return <p className="text-[12.5px] text-[var(--g-ink-3)]">No answers yet.</p>;
	const inputs = hug_inputs(hug);
	return (
		<ul className="flex flex-col gap-3" aria-label="Answers">
			{hug.responses.map((r: Hug_response) => {
				const summary = answer_summary(hug, r.values);
				const shown = Object.entries(r.values).filter(([k]) => !(TEMPLATE_KEYS as readonly string[]).includes(k));
				const said = words(r);
				return (
					<li key={r.response_id} className="flex flex-col gap-1" data-testid="hug-response">
						<div className="flex flex-wrap items-center gap-2 text-[12.5px]">
							<b>{r.responder.name}{me && r.responder.user_id === me ? ' (you)' : ''}</b>
							{summary ? <span className="rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] font-semibold" data-testid="hug-decision">{summary}</span> : null}
							{r.via.length ? <span className="text-[11.5px] text-[var(--g-ink-3)]">via {r.via.join(', ')}</span> : null}
							<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{new Date(r.responded_at).toLocaleString()}</span>
						</div>
						{shown.length ? (
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
								{shown.map(([k, v]) => {
									const input = inputs.find((i) => i.name === k);
									return [
										<dt key={`${k}-k`} className="text-[var(--g-ink-3)]">{input ? input_label(input) : k}</dt>,
										<dd key={`${k}-v`} className="min-w-0 break-words"><Value input={input} value={v} /></dd>,
									];
								})}
							</dl>
						) : null}
						{said ? <Md class_name="text-[12.5px] text-[var(--g-ink-2)]">{said}</Md> : null}
					</li>
				);
			})}
		</ul>
	);
}

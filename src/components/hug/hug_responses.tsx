/** The answers so far: who, through which channel, what they answered and when. */
import { artifact_download_href } from '@/lib/artifact_view';
import { choice_label, input_label, type File_ref, type Hug, type Hug_response } from '@/lib/hug';
import { Md } from '@/components/graphite/g_md';

function Value({ hug, name, value }: { hug: Pick<Hug, 'requested_inputs'>; name: string; value: unknown }) {
	const input = hug.requested_inputs.find((i) => i.name === name);
	if (input?.type === 'file') {
		const files = (Array.isArray(value) ? value : [value]) as File_ref[];
		return <>{files.map((f) => <a key={f.artifact_id} href={artifact_download_href(f.artifact_id)} className="g-mono mr-2 underline">{f.name ?? f.artifact_id}</a>)}</>;
	}
	return <>{input ? choice_label(input, value) : String(value)}</>;
}

export function Hug_responses({ hug, me }: { hug: Pick<Hug, 'responses' | 'requested_inputs'>; me?: string | null }) {
	if (!hug.responses.length) return <p className="text-[12.5px] text-[var(--g-ink-3)]">No answers yet.</p>;
	return (
		<ul className="flex flex-col gap-3" aria-label="Answers">
			{hug.responses.map((r: Hug_response) => {
				const comment_input = typeof r.values.comment === 'string' ? r.values.comment : null;
				const shown = Object.entries(r.values).filter(([k]) => k !== 'comment');
				return (
					<li key={r.response_id} className="flex flex-col gap-1" data-testid="hug-response">
						<div className="flex flex-wrap items-center gap-2 text-[12.5px]">
							<b>{r.responder.name}{me && r.responder.user_id === me ? ' (you)' : ''}</b>
							{r.via.length ? <span className="text-[11.5px] text-[var(--g-ink-3)]">via {r.via.join(', ')}</span> : null}
							<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{new Date(r.responded_at).toLocaleString()}</span>
						</div>
						{shown.length ? (
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
								{shown.map(([k, v]) => {
									const input = hug.requested_inputs.find((i) => i.name === k);
									return [
										<dt key={`${k}-k`} className="text-[var(--g-ink-3)]">{input ? input_label(input) : k}</dt>,
										<dd key={`${k}-v`} className="min-w-0 break-words"><Value hug={hug} name={k} value={v} /></dd>,
									];
								})}
							</dl>
						) : null}
						{comment_input || r.comment ? <Md class_name="text-[12.5px] text-[var(--g-ink-2)]">{comment_input ?? r.comment ?? ''}</Md> : null}
					</li>
				);
			})}
		</ul>
	);
}

/**
 * The answers so far (PLAN-hug-widgets §6.4, states 4 and 5): the chrome shows who answered ("(you)" for the
 * viewer), the answer's summary as a badge, the channels that reached them and when; the hug draws each answer in
 * its own view frame, loaded as it scrolls into view. Without a frame (`content_url` null — a Hug opened before
 * hugs, or its bundle is gone) the values are shown as key-values: the fallback view.
 */
import { artifact_download_href } from '@/lib/artifact_view';
import { value_text, type File_ref, type Hug, type Hug_response } from '@/lib/hug';
import { Hug_host } from './hug_host';

/** A value: files as links (the viewer's permissions apply), the rest as text. */
function Value({ value }: { value: unknown }) {
	const refs = (Array.isArray(value) ? value : [value]) as unknown[];
	const files = refs.every((x) => x && typeof x === 'object' && 'artifact_id' in x) ? refs as File_ref[] : null;
	if (files?.length) {
		return <>{files.map((f) => <a key={f.artifact_id} href={artifact_download_href(f.artifact_id)} className="g-mono mr-2 underline">{f.name ?? f.artifact_id}</a>)}</>;
	}
	return <span className="whitespace-pre-wrap">{value_text(value)}</span>;
}

/** One response's values as key-values (the fallback view). */
export function Response_values({ values }: { values: Record<string, unknown> }) {
	const shown = Object.entries(values);
	if (!shown.length) return null;
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]" data-testid="hug-values">
			{shown.map(([k, v]) => [
				<dt key={`${k}-k`} className="text-[var(--g-ink-3)]">{k}</dt>,
				<dd key={`${k}-v`} className="min-w-0 break-words"><Value value={v} /></dd>,
			])}
		</dl>
	);
}

/** The viewer's own answer first, then the others oldest first. */
function in_order(responses: readonly Hug_response[], me: string | null | undefined): Hug_response[] {
	const mine = responses.filter((r) => me && r.responder.user_id === me);
	return [...mine, ...responses.filter((r) => !mine.includes(r))];
}

export function Hug_responses({ hug, content_url, me, viewer }: {
	hug: Hug;
	content_url: string | null;
	me?: string | null;
	viewer: { name: string; via: string[] };
}) {
	if (!hug.responses.length) return <p className="text-[12.5px] text-[var(--g-ink-3)]">No answers yet.</p>;
	return (
		<ul className="flex flex-col gap-3" aria-label="Answers">
			{in_order(hug.responses, me).map((r) => (
				<li key={r.response_id} className="flex flex-col gap-1.5" data-testid="hug-response">
					<div className="flex flex-wrap items-center gap-2 text-[12.5px]">
						<b>{r.responder.name}{me && r.responder.user_id === me ? ' (you)' : ''}</b>
						{r.summary ? <span className="rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] font-semibold" data-testid="hug-decision">{r.summary}</span> : null}
						{r.via.length ? <span className="text-[11.5px] text-[var(--g-ink-3)]">via {r.via.join(', ')}</span> : null}
						<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{new Date(r.responded_at).toLocaleString()}</span>
					</div>
					{content_url
						? <Hug_host hug={hug} content_url={content_url} mode="view" mine={null} viewing={r} viewer={viewer} loading="lazy" label={`${r.responder.name}'s answer`} />
						: <Response_values values={r.values} />}
				</li>
			))}
		</ul>
	);
}

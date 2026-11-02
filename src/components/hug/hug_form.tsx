/**
 * The response form — the page's renderer of the Hug's template (PLAN-hug-templates §3):
 *
 *   form     — the requested inputs, Required then Optional, and a comment; or "Can't answer" with a
 *              reason (nothing else required)
 *   approval — Approve (the inputs, Required then Optional, and a comment) or a red Reject (a reason,
 *              and a choice such as "Send back to …" when the Hug offers some — the inputs never
 *              required); labels from `approve_label` / `reject_label`, the comment hidden with
 *              `show_comment: false`
 *
 * Values are checked before sending (the SDK's rules, for messages); Core has the template check them
 * again and its problems are shown the same way, per key. Submitting again replaces the caller's
 * response. A template this page doesn't know is shown as such.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { G_BTN, G_INPUT, G_PRIMARY } from '@/components/graphite/g_agents';
import {
	hug_inputs, hug_template, initial_values, missing_required, problems_from_message, reject_choices, respond, split_inputs, to_values, value_problems,
	type File_ref, type Form_value, type Form_values, type Hug, type Hug_response, type Requested_input,
} from '@/lib/hug';
import { Text_input } from './inputs/text_input';
import { Number_input } from './inputs/number_input';
import { Boolean_input } from './inputs/boolean_input';
import { Enum_input } from './inputs/enum_input';
import { File_input } from './inputs/file_input';
import { Channel_input } from './inputs/channel_input';

const G_DANGER = 'inline-flex shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md bg-[var(--g-bad)] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40';

export function Hug_input({ input, value, on_change, error, hug, on_busy }: {
	input: Requested_input; value: Form_value; on_change: (v: Form_value) => void; error?: string | null; hug: Pick<Hug, 'id' | 'realm_id'>; on_busy?: (busy: boolean) => void;
}) {
	switch (input.type) {
		case 'text': return <Text_input input={input} value={typeof value === 'string' ? value : ''} on_change={on_change} error={error} />;
		case 'number': return <Number_input input={input} value={typeof value === 'string' ? value : ''} on_change={on_change} error={error} />;
		case 'boolean': return <Boolean_input input={input} value={value === true} on_change={on_change} error={error} />;
		case 'enum': return <Enum_input input={input} value={value as string | string[]} on_change={on_change} error={error} />;
		case 'channel': return <Channel_input input={input} value={Array.isArray(value) ? (value as string[]) : []} on_change={on_change} error={error} realm_id={hug.realm_id} />;
		case 'file': return <File_input input={input} value={Array.isArray(value) ? (value as File_ref[]) : []} on_change={on_change} error={error} hug_id={hug.id} on_busy={on_busy} />;
	}
}

/** What the person chose: answer with the inputs, or say no (reject / can't answer). */
type Mode = 'answer' | 'refuse';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The mode the caller's earlier answer was in. */
function mode_of(mine: Hug_response | null): Mode {
	return mine && (mine.values.decision === 'reject' || typeof mine.values.declined === 'string') ? 'refuse' : 'answer';
}

export function Hug_form({ hug, mine, on_sent }: { hug: Hug; mine: Hug_response | null; on_sent: () => void }) {
	const template = hug_template(hug);
	if (!template) {
		return <p role="alert" className="text-[12.5px] text-[var(--g-ink-3)]">This Hug uses a template this page can’t show ({hug.template}@{hug.template_version}).</p>;
	}
	return <Template_form hug={hug} template={template} mine={mine} on_sent={on_sent} />;
}

function Template_form({ hug, template, mine, on_sent }: { hug: Hug; template: 'form' | 'approval'; mine: Hug_response | null; on_sent: () => void }) {
	const auth_fetch = useAuthFetch();
	const inputs = hug_inputs(hug);
	const choices = reject_choices(hug);
	const approval = template === 'approval';
	const show_comment = !(approval && hug.params.show_comment === false);
	const start = useMemo(() => initial_values(inputs, mine), [inputs, mine]);
	const [mode, set_mode] = useState<Mode>(mode_of(mine));
	const [form, set_form] = useState<Form_values>(start);
	const [comment, set_comment] = useState(str(mine?.values.comment));
	const [reason, set_reason] = useState(str(mine?.values.reason) || str(mine?.values.declined));
	const [choice, set_choice] = useState(str(mine?.values.choice));
	const [problems, set_problems] = useState<Record<string, string>>({});
	const [busy, set_busy] = useState(false);
	const [uploading, set_uploading] = useState<Record<string, boolean>>({});
	const any_uploading = Object.values(uploading).some(Boolean);
	const { required, optional } = split_inputs(inputs);
	const left = missing_required(inputs, form);
	const approve_label = str(hug.params.approve_label) || 'Approve';
	const reject_label = str(hug.params.reject_label) || 'Reject';

	/** The answer's values, or the problems found before sending. */
	function answer(): { values: Record<string, unknown> } | { problems: Record<string, string> } {
		if (mode === 'refuse') {
			if (!reason.trim()) return { problems: { [approval ? 'reason' : 'declined']: 'required' } };
			return { values: approval ? { decision: 'reject', reason: reason.trim(), ...(choice ? { choice } : {}) } : { declined: reason.trim() } };
		}
		const values = to_values(inputs, form);
		const found = value_problems(inputs, values);
		if (Object.keys(found).length) return { problems: found };
		const note = show_comment && comment.trim() ? { comment: comment.trim() } : {};
		return { values: { ...(approval ? { decision: 'approve' } : {}), ...values, ...note } };
	}

	async function send() {
		const a = answer();
		if ('problems' in a) { set_problems(a.problems); return; }
		set_problems({});
		set_busy(true);
		try {
			const r = await respond(auth_fetch, hug.id, a.values);
			if (r.ok) { on_sent(); return; }
			set_problems(r.status === 422 ? problems_from_message(r.message, inputs) : { '': r.message });
		} catch {
			set_problems({ '': 'Network error — try again.' });
		} finally {
			set_busy(false);
		}
	}

	const control = (i: Requested_input) => (
		<Hug_input
			key={i.name}
			input={i}
			hug={hug}
			value={form[i.name]}
			error={problems[i.name]}
			on_change={(v) => { set_form((f) => ({ ...f, [i.name]: v })); set_problems(({ [i.name]: _gone, ...rest }) => rest); }}
			on_busy={(b) => set_uploading((u) => ({ ...u, [i.name]: b }))}
		/>
	);
	const group = (label: string, body: ReactNode) => (
		<div role="group" aria-label={label} className="flex flex-col gap-3.5">
			<p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{label}</p>
			{body}
		</div>
	);
	const pick = (m: Mode) => { set_mode(m); set_problems({}); };

	let hint = 'You can change it while the Hug is open';
	if (any_uploading) hint = 'Waiting for uploads…';
	else if (mode === 'answer' && left > 0) hint = `${left} required left · ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`;

	const answer_fields = (
		<>
			{required.length ? group('Required', required.map(control)) : null}
			{optional.length || show_comment ? (
				<div className={required.length ? 'border-t border-[var(--g-line)] pt-4' : ''}>
					{group('Optional', (
						<>
							{optional.map(control)}
							{show_comment ? (
								<label className="flex flex-col gap-1.5">
									<span className="text-[13px] text-[var(--g-ink)]">Comment</span>
									<textarea aria-label="Comment" rows={3} value={comment} placeholder="Add a note for the team" onChange={(e) => set_comment(e.target.value)} className={`${G_INPUT} w-full`} />
								</label>
							) : null}
						</>
					))}
				</div>
			) : null}
		</>
	);
	const reason_key = approval ? 'reason' : 'declined';
	const refuse_fields = (
		<div className="flex flex-col gap-3.5">
			{approval && choices.length ? (
				<div role="radiogroup" aria-label="What should happen" className="flex flex-col gap-1.5">
					{[...choices, { value: '', label: reject_label }].map((c) => (
						<label key={c.value || '-'} className="flex items-center gap-2 text-[13px]">
							<input type="radio" name="reject-choice" checked={choice === c.value} onChange={() => set_choice(c.value)} />
							{c.label ?? c.value}
						</label>
					))}
				</div>
			) : null}
			<label className="flex flex-col gap-1.5">
				<span className="text-[13px] text-[var(--g-ink)]">{approval ? 'Reason' : 'Why can’t you answer?'}</span>
				<textarea aria-label="Reason" rows={3} value={reason} onChange={(e) => { set_reason(e.target.value); set_problems(({ [reason_key]: _gone, ...rest }) => rest); }} className={`${G_INPUT} w-full`} />
				{problems[reason_key] ? <span role="alert" className="text-[12.5px] text-[var(--g-bad)]">{problems[reason_key]}</span> : null}
			</label>
		</div>
	);

	return (
		<form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label="Your response" noValidate>
			{approval ? (
				<div role="radiogroup" aria-label="Decision" className="flex gap-2">
					<button type="button" role="radio" aria-checked={mode === 'answer'} className={mode === 'answer' ? G_PRIMARY : G_BTN} onClick={() => pick('answer')}>{approve_label}</button>
					<button type="button" role="radio" aria-checked={mode === 'refuse'} className={mode === 'refuse' ? G_DANGER : G_BTN} onClick={() => pick('refuse')}>{reject_label}</button>
				</div>
			) : null}
			{mode === 'answer' ? answer_fields : refuse_fields}
			{problems[''] ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{problems['']}</p> : null}
			<div className="flex flex-wrap items-center gap-3 border-t border-[var(--g-line)] pt-3">
				<span className="text-[12px] text-[var(--g-ink-3)]" data-testid="response-hint">{hint}</span>
				{!approval ? (
					<button type="button" className="text-[12px] text-[var(--g-ink-3)] underline hover:text-[var(--g-ink)]" onClick={() => pick(mode === 'answer' ? 'refuse' : 'answer')}>
						{mode === 'answer' ? 'Can’t answer' : 'Answer instead'}
					</button>
				) : null}
				<button type="submit" disabled={busy || any_uploading} className={`${mode === 'refuse' && approval ? G_DANGER : G_PRIMARY} ml-auto`}>
					{mine ? 'Update response' : 'Submit response'}
				</button>
			</div>
		</form>
	);
}

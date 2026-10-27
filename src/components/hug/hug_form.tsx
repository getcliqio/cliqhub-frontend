/**
 * The response form: the requested inputs grouped as Required and Optional (a free comment joins
 * the optional ones when the Hug doesn't ask for one), and Submit response at the bottom with how
 * many required inputs are still empty. Values are checked before sending (the SDK's rules, for
 * messages); Core checks them again and its problems are shown the same way, per input. Submitting
 * again replaces the caller's response.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { G_INPUT, G_PRIMARY } from '@/components/graphite/g_agents';
import {
	initial_values, missing_required, problems_from_message, respond, split_inputs, to_values, value_problems,
	type File_ref, type Form_value, type Form_values, type Hug, type Hug_response, type Requested_input,
} from '@/lib/hug';
import { Text_input } from './inputs/text_input';
import { Number_input } from './inputs/number_input';
import { Boolean_input } from './inputs/boolean_input';
import { Enum_input } from './inputs/enum_input';
import { File_input } from './inputs/file_input';
import { Channel_input } from './inputs/channel_input';

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

export function Hug_form({ hug, mine, on_sent }: { hug: Hug; mine: Hug_response | null; on_sent: () => void }) {
	const auth_fetch = useAuthFetch();
	const inputs = hug.requested_inputs;
	const start = useMemo(() => initial_values(inputs, mine), [inputs, mine]);
	const [form, set_form] = useState<Form_values>(start);
	const [comment, set_comment] = useState(mine?.comment ?? '');
	const [problems, set_problems] = useState<Record<string, string>>({});
	const [busy, set_busy] = useState(false);
	const [uploading, set_uploading] = useState<Record<string, boolean>>({});
	const any_uploading = Object.values(uploading).some(Boolean);
	const { required, optional } = split_inputs(inputs);
	const left = missing_required(inputs, form);
	const ask_comment = !inputs.some((i) => i.name === 'comment');

	async function send() {
		const values = to_values(inputs, form);
		const found = value_problems(inputs, values);
		set_problems(found);
		if (Object.keys(found).length) return;
		set_busy(true);
		try {
			const r = await respond(auth_fetch, hug.id, values, comment);
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
	let hint = 'You can change it while the Hug is open';
	if (any_uploading) hint = 'Waiting for uploads…';
	else if (left > 0) hint = `${left} required left · ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`;

	return (
		<form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label="Your response" noValidate>
			{required.length ? group('Required', required.map(control)) : null}
			{optional.length || ask_comment ? (
				<div className={required.length ? 'border-t border-[var(--g-line)] pt-4' : ''}>
					{group('Optional', (
						<>
							{optional.map(control)}
							{ask_comment ? (
								<label className="flex flex-col gap-1.5">
									<span className="text-[13px] text-[var(--g-ink)]">Comment</span>
									<textarea aria-label="Comment" rows={3} value={comment} placeholder="Add a note for the team" onChange={(e) => set_comment(e.target.value)} className={`${G_INPUT} w-full`} />
								</label>
							) : null}
						</>
					))}
				</div>
			) : null}
			{problems[''] ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{problems['']}</p> : null}
			<div className="flex flex-wrap items-center gap-3 border-t border-[var(--g-line)] pt-3">
				<span className="text-[12px] text-[var(--g-ink-3)]" data-testid="response-hint">{hint}</span>
				<button type="submit" disabled={busy || any_uploading} className={`${G_PRIMARY} ml-auto`}>{mine ? 'Update response' : 'Submit response'}</button>
			</div>
		</form>
	);
}

/** The frame every Hug input shares: label (required mark), help, the control and its problem. */
import type { ReactNode } from 'react';
import { input_label, type Requested_input } from '@/lib/hug';

export interface Input_props<V> {
	input: Requested_input;
	value: V;
	on_change: (v: V) => void;
	/** Why the value isn't accepted (shown under the control). */
	error?: string | null;
	disabled?: boolean;
}

export const control_id = (name: string) => `hug-input-${name}`;

export function Field({ input, error, children, as_label = true }: { input: Requested_input; error?: string | null; children: ReactNode; as_label?: boolean }) {
	const id = control_id(input.name);
	const head = (
		<span id={`${id}-label`} className="text-[12.5px] text-[var(--g-ink-2)]">
			{input_label(input)}
			{input.required !== false && input.type !== 'boolean' ? <span aria-hidden className="ml-1 text-[var(--g-bad)]">*</span> : null}
		</span>
	);
	const foot = (
		<>
			{input.help ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{input.help}</span> : null}
			{error ? <span role="alert" id={`${id}-error`} className="text-[11.5px] text-[var(--g-bad)]">{error}</span> : null}
		</>
	);
	return as_label
		? <label htmlFor={id} className="flex flex-col gap-1.5">{head}{children}{foot}</label>
		: <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">{head}{children}{foot}</div>;
}

export const invalid_cls = (error?: string | null) => (error ? 'border-[var(--g-bad-line)]' : '');

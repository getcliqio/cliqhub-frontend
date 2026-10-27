/** A `channel` input: channels or people, one (or several with `multiple`). */
import { ChannelUserPicker } from '@/components/channel_user_picker';
import { Field, type Input_props } from './field';

export function Channel_input({ input, value, on_change, error, disabled, realm_id }: Input_props<string[]> & { realm_id?: string }) {
	if (input.type !== 'channel') return null;
	return (
		<Field input={input} error={error} as_label={false}>
			{disabled
				? <p className="text-[13px] text-[var(--g-ink-2)]">{value.join(', ') || '—'}</p>
				: <ChannelUserPicker
					selected={value}
					realm_id={realm_id}
					on_change={(next) => on_change(input.multiple ? next : next.slice(-1))}
					placeholder={typeof input.ui?.placeholder === 'string' ? input.ui.placeholder : 'Search channels or people…'}
				/>}
		</Field>
	);
}

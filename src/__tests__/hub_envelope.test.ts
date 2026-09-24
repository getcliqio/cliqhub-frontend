import { describe, expect, it } from 'vitest';
import { hub_list, hub_payload, hub_setting_source } from '@/lib/hub_envelope';

describe('hub_envelope', () => {
	it('prefers data array over flat agents', () => {
		expect(hub_list({ ok: true, data: [{ name: 'a' }], agents: [{ name: 'b' }] }, 'agents'))
			.toEqual([{ name: 'a' }]);
	});

	it('falls back to flat agents when data missing', () => {
		expect(hub_list({ ok: true, agents: [{ name: 'b' }] }, 'agents'))
			.toEqual([{ name: 'b' }]);
	});

	it('unwraps data payload objects', () => {
		expect(hub_payload<{ items: number[] }>({ ok: true, data: { items: [1] } }))
			.toEqual({ items: [1] });
	});

	it('maps setting source org/global/realm', () => {
		expect(hub_setting_source('org')).toBe('org');
		expect(hub_setting_source('global')).toBe('org');
		expect(hub_setting_source('realm')).toBe('realm');
		expect(hub_setting_source(null)).toBe(null);
	});
});

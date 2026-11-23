/** lib/hug — the Hub's link to a Hug, and opening getHugs signed in (PLAN-gethugs-step7-sign-in.md). */
import { describe, it, expect, vi } from 'vitest';
import { gethugs_open_url, hug_href } from '@/lib/hug';

describe('hug_href', () => {
	it('the Hub path of a Hug (which opens it in getHugs)', () => {
		expect(hug_href('h 1')).toBe('/hugs/h%201');
	});
});

describe('gethugs_open_url (PLAN-gethugs-step7-sign-in.md)', () => {
	it('the sign-in link when Core gives one; the plain page on any refusal or error', async () => {
		const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { url: 'https://g/sign-in/statement#x' } })));
		expect(await gethugs_open_url(ok, { hug_id: 'h1' }, 'https://g/hugs/hug_1')).toBe('https://g/sign-in/statement#x');
		expect(ok).toHaveBeenCalledWith('/v1/hugs/create_sign_in_link', { method: 'POST', body: JSON.stringify({ hug_id: 'h1' }) });
		const refused = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 403 }));
		expect(await gethugs_open_url(refused, { org_id: 'o1' }, 'https://g/hugs')).toBe('https://g/hugs');
		const broken = vi.fn().mockRejectedValue(new Error('offline'));
		expect(await gethugs_open_url(broken, { org_id: 'o1' }, 'https://g/hugs')).toBe('https://g/hugs');
	});
});

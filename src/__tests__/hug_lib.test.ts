/** lib/hug — upload-slot checks, reading a Hug, answering (with the hug's summary), the fallback view's values, drafts, upload. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	file_problem, is_answerable, load_draft, my_response, outcome_tone, respond, save_draft, status_label, upload_file, value_text,
	type Hug_file_slot, type Hug_response,
} from '@/lib/hug';

const mine: Hug_response = {
	response_id: 'r1', responder: { user_id: 'u1', name: 'Ann' }, via: ['legal'], responded_at: '2026-10-26T10:00:00Z',
	values: { decision: 'approve' }, summary: 'Approved',
};

describe('upload-slot checks', () => {
	const input: Hug_file_slot = { name: 'contract', accept: ['application/pdf', '.md'], max_bytes: 1000 };
	it('size (the smaller of the Hub limit and the slot), then accept (types and extensions)', () => {
		expect(file_problem(input, { name: 'a.pdf', type: 'application/pdf', size: 2000 }, 50)).toBe('a.pdf is larger than 1000 bytes');
		expect(file_problem(input, { name: 'a.png', type: 'image/png', size: 10 }, 50)).toBe("a.png isn't one of: application/pdf, .md");
		expect(file_problem(input, { name: 'NOTES.MD', type: '', size: 10 }, 50)).toBeNull();
		expect(file_problem({ ...input, max_bytes: undefined }, { name: 'a.pdf', type: 'application/pdf', size: 60 * 1024 * 1024 }, 50)).toBe('a.pdf is larger than 50 MB');
	});
});

describe('answering', () => {
	afterEach(() => vi.restoreAllMocks());
	it("sends the values and the hug's summary; Core's refusal comes back with its message", async () => {
		const sent: unknown[] = [];
		const fetch_ok = vi.fn(async (_u: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, data: { response_id: 'r9' } })); });
		expect(await respond(fetch_ok, 'h-1', { decision: 'approve' }, 'Approved')).toEqual({ ok: true, response_id: 'r9' });
		expect(await respond(fetch_ok, 'h-1', { n: 1 })).toEqual({ ok: true, response_id: 'r9' });
		expect(sent).toEqual([{ hug_id: 'h-1', values: { decision: 'approve' }, summary: 'Approved' }, { hug_id: 'h-1', values: { n: 1 } }]);
		const refuse = async () => new Response(JSON.stringify({ ok: false, error: { message: 'summary is one line' } }), { status: 422 });
		expect(await respond(refuse, 'h-1', {}, 'a')).toEqual({ ok: false, status: 422, message: 'summary is one line' });
	});
});

describe('the fallback view and drafts', () => {
	it('values as text: strings as they are, files by name, the rest as JSON', () => {
		expect(value_text('autumn')).toBe('autumn');
		expect(value_text(3)).toBe('3');
		expect(value_text(null)).toBe('—');
		expect(value_text({ artifact_id: 'a', name: 'MSA.pdf' })).toBe('MSA.pdf');
		expect(value_text([{ artifact_id: 'a', name: 'a.pdf' }, { artifact_id: 'b', name: 'b.pdf' }])).toBe('a.pdf, b.pdf');
		expect(value_text({ verdicts: [{ ok: true }] })).toBe('{"verdicts":[{"ok":true}]}');
	});

	it('outcome tone: an approval approved is good, rejected bad; anything else neutral (live run: "Rejected" was green)', () => {
		const r = (decision: string, at: string) => ({ values: { decision }, responded_at: at }) as never;
		const approval = { name: 'approval', sha256: 'x' };
		expect(outcome_tone({ status: 'closed', hug: approval, responses: [r('reject', '2026-11-10T21:55:00Z')] })).toBe('bad');
		expect(outcome_tone({ status: 'closed', hug: approval, responses: [r('reject', '2026-11-10T21:55:00Z'), r('approve', '2026-11-10T21:57:00Z')] })).toBe('good');
		expect(outcome_tone({ status: 'closed', hug: { name: 'form', sha256: 'x' }, responses: [r('reject', '2026-11-10T21:55:00Z')] })).toBe('neutral');
		expect(outcome_tone({ status: 'expired', hug: approval, responses: [] })).toBe('neutral');
		expect(outcome_tone({ status: 'closed', hug: null, responses: [] })).toBe('neutral');
	});

	it('a draft is kept per viewer and Hug, and dropped with null; nothing without a viewer', () => {
		save_draft('h-1', 'u1', { n: 1 });
		expect(load_draft('h-1', 'u1')).toEqual({ n: 1 });
		expect(load_draft('h-1', 'u2')).toBeNull();
		expect(load_draft('h-2', 'u1')).toBeNull();
		save_draft('h-1', 'u1', null);
		expect(load_draft('h-1', 'u1')).toBeNull();
		save_draft('h-1', null, { n: 1 });
		expect(load_draft('h-1', null)).toBeNull();
	});
});

describe('reading a Hug', () => {
	it('answerable while open and not past its expiry; my answer; how it ended', () => {
		const now = Date.parse('2026-10-26T12:00:00Z');
		expect(is_answerable({ status: 'open', expires_at: '2026-10-26T13:00:00Z' }, now)).toBe(true);
		expect(is_answerable({ status: 'open', expires_at: '2026-10-26T11:00:00Z' }, now)).toBe(false);
		expect(is_answerable({ status: 'closed', expires_at: '2026-10-26T13:00:00Z' }, now)).toBe(false);
		expect(my_response({ responses: [mine] }, 'u1')).toBe(mine);
		expect(my_response({ responses: [mine] }, 'u2')).toBeNull();
		expect(status_label({ status: 'closed', outcome: 'Approved' })).toBe('Approved');
		expect(status_label({ status: 'cancelled', outcome: 'run ended' })).toBe('Cancelled — run ended');
	});
});

/** A fake XMLHttpRequest the test drives. */
class Fake_xhr {
	static last: Fake_xhr;
	upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	status = 0;
	responseText = '';
	url = '';
	headers: Record<string, string> = {};
	body: unknown = null;
	withCredentials = false;
	constructor() { Fake_xhr.last = this; }
	open(_m: string, url: string) { this.url = url; }
	setRequestHeader(k: string, v: string) { this.headers[k] = v; }
	send(body: unknown) { this.body = body; }
	abort() { this.onabort?.(); }
	reply(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
}

describe('upload_file', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends the file as the raw body with its metadata in the query, reports progress, resolves with the stored file', async () => {
		vi.stubGlobal('XMLHttpRequest', Fake_xhr);
		const file = new File(['%PDF'], 'MSA v2.pdf', { type: 'application/pdf' });
		const progress: number[] = [];
		const up = upload_file('h-1', 'contract', file, (f) => progress.push(f));
		const x = Fake_xhr.last;
		expect(x.url).toBe('/v1/artifacts/upload?hug_id=h-1&requested_input=contract&name=MSA+v2.pdf');
		expect(x.body).toBe(file);
		expect(x.headers).toEqual({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/pdf' });
		x.upload.onprogress!({ lengthComputable: true, loaded: 2, total: 4 });
		x.reply(201, { ok: true, data: { artifact_id: 'a9', name: 'MSA v2.pdf', size: 4, content_type: 'application/pdf' } });
		await expect(up.done).resolves.toEqual({ artifact_id: 'a9', name: 'MSA v2.pdf', size: 4, content_type: 'application/pdf', sha256: '' });
		expect(progress).toEqual([0.5, 1]);
	});

	it("413 and other refusals reject with Core's message; cancel rejects as cancelled", async () => {
		vi.stubGlobal('XMLHttpRequest', Fake_xhr);
		const file = new File(['x'], 'big.bin');
		const a = upload_file('h-1', 'contract', file, () => {});
		Fake_xhr.last.reply(413, { ok: false, error: { code: 'ARTIFACT_TOO_LARGE', message: 'File is larger than the 50 MB limit' } });
		await expect(a.done).rejects.toThrow('File is larger than the 50 MB limit');
		const b = upload_file('h-1', 'contract', file, () => {});
		b.abort();
		await expect(b.done).rejects.toThrow('Upload cancelled');
	});
});

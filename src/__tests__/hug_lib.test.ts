/** lib/hug — form values, checks for messages, Core's problems per input, file checks, upload. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	file_problem, initial_values, is_answerable, my_response, problems_from_message, status_label, to_values, upload_file, value_problems,
	type Hug_response, type Requested_input,
} from '@/lib/hug';

const INPUTS: Requested_input[] = [
	{ name: 'decision', type: 'enum', required: true, choices: [{ value: 'approve', label: 'Approve' }, { value: 'reject' }] },
	{ name: 'risk', type: 'number', min: 1, max: 5, integer: true },
	{ name: 'notes', type: 'text', required: false, max_length: 10 },
	{ name: 'urgent', type: 'boolean', default: true },
	{ name: 'tags', type: 'enum', multiple: true, required: false, choices: [{ value: 'a' }, { value: 'b' }] },
	{ name: 'contract', type: 'file', required: false, accept: ['application/pdf', '.md'], max_bytes: 1000 },
	{ name: 'notify', type: 'channel', multiple: true, required: false },
];

const mine: Hug_response = {
	response_id: 'r1', responder: { user_id: 'u1', name: 'Ann' }, via: ['legal'], comment: 'ok', responded_at: '2026-10-26T10:00:00Z',
	values: { decision: 'approve', risk: 3, tags: ['b'], contract: { artifact_id: 'a1', name: 'c.pdf', size: 10, content_type: 'application/pdf' } },
};

describe('form values', () => {
	it('start from defaults, or from my own answer', () => {
		expect(initial_values(INPUTS)).toEqual({ decision: '', risk: '', notes: '', urgent: true, tags: [], contract: [], notify: [] });
		expect(initial_values(INPUTS, mine)).toMatchObject({ decision: 'approve', risk: '3', tags: ['b'], contract: [{ artifact_id: 'a1' }] });
	});

	it('become wire values: numbers parsed, empty ones left out, one file as a ref, several as a list', () => {
		const form = { ...initial_values(INPUTS, mine), notes: '', notify: ['ops'] };
		expect(to_values(INPUTS, form)).toEqual({ decision: 'approve', risk: 3, urgent: true, tags: ['b'], contract: { artifact_id: 'a1' }, notify: ['ops'] });
		expect(to_values(INPUTS, initial_values(INPUTS))).toEqual({ urgent: true });
	});
});

describe('value_problems (the SDK rules, for messages)', () => {
	it('names what is wrong per input', () => {
		expect(value_problems(INPUTS, { urgent: true })).toEqual({ decision: 'required', risk: 'required' });
		expect(value_problems(INPUTS, { decision: 'maybe', risk: 2.5, notes: 'x'.repeat(11), urgent: true })).toEqual({
			decision: "'maybe' is not one of the choices", risk: 'must be a whole number', notes: 'must be at most 10 characters',
		});
		expect(value_problems(INPUTS, { decision: 'approve', risk: 9, urgent: true })).toEqual({ risk: 'must be at most 5' });
		expect(value_problems(INPUTS, { decision: 'approve', risk: 1, urgent: true })).toEqual({});
	});

	it("Core's refusal is split per input; the rest stays general", () => {
		expect(problems_from_message('decision: required; risk: must be at least 1; Hug is closed', INPUTS))
			.toEqual({ decision: 'required', risk: 'must be at least 1', '': 'Hug is closed' });
	});
});

describe('file checks', () => {
	const input = INPUTS[5] as Extract<Requested_input, { type: 'file' }>;
	it('size (the smaller of the Hub limit and the input), then accept (types and extensions)', () => {
		expect(file_problem(input, { name: 'a.pdf', type: 'application/pdf', size: 2000 }, 50)).toBe('a.pdf is larger than 1000 bytes');
		expect(file_problem(input, { name: 'a.png', type: 'image/png', size: 10 }, 50)).toBe("a.png isn't one of: application/pdf, .md");
		expect(file_problem(input, { name: 'NOTES.MD', type: '', size: 10 }, 50)).toBeNull();
		expect(file_problem({ ...input, max_bytes: undefined }, { name: 'a.pdf', type: 'application/pdf', size: 60 * 1024 * 1024 }, 50)).toBe('a.pdf is larger than 50 MB');
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
		await expect(up.done).resolves.toEqual({ artifact_id: 'a9', name: 'MSA v2.pdf', size: 4, content_type: 'application/pdf' });
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

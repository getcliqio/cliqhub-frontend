/**
 * Showing a file in the browser: what kind it is, small parsers for the kinds shown inline, and its
 * download link. Stored files stream from the Hub (`/v1/artifacts/download`, same origin — the session
 * cookie authorizes it), so a link never expires.
 */

export type Artifact_bucket = 'markdown' | 'json' | 'csv' | 'image' | 'pdf' | 'html' | 'text';

export function artifact_bucket(mime: string | null | undefined, name: string): Artifact_bucket {
	const m = (mime ?? '').toLowerCase();
	const n = name.toLowerCase();
	if (m.includes('json') || n.endsWith('.json')) return 'json';
	if (m.includes('markdown') || /\.(md|mdx|markdown)$/.test(n)) return 'markdown';
	if (m.includes('csv') || n.endsWith('.csv') || n.endsWith('.tsv')) return 'csv';
	if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return 'image';
	if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
	if (m.includes('html') || /\.html?$/.test(n)) return 'html';
	return 'text';
}

/** The Hub link that streams a stored file. */
export function artifact_download_href(artifact_id: string): string {
	return `/v1/artifacts/download?artifact_id=${encodeURIComponent(artifact_id)}`;
}

export function pretty_json(raw: string): string | null {
	try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return null; }
}

/** Minimal CSV/TSV parser (quotes, escaped quotes, commas/newlines in quotes). Caps rows. */
export function parse_csv(text: string, max_rows = 500): string[][] {
	const sep = text.split('\n', 1)[0].includes('\t') && !text.split('\n', 1)[0].includes(',') ? '\t' : ',';
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (q) {
			if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
			continue;
		}
		if (ch === '"') q = true;
		else if (ch === sep) { row.push(cell); cell = ''; }
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell); rows.push(row); row = []; cell = '';
			if (rows.length >= max_rows) return rows;
		} else cell += ch;
	}
	if (cell || row.length) { row.push(cell); rows.push(row); }
	return rows;
}

export function format_bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

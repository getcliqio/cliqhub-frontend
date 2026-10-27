/**
 * A `file` input: pick files, each streamed to the Hub as it is picked (progress, cancel, retry);
 * the value is the uploaded files. Size and `accept` are checked first, for messages — Core checks
 * them again.
 */
import { useRef, useState } from 'react';
import { G_BTN } from '@/components/graphite/g_agents';
import { format_bytes } from '@/lib/artifact_view';
import { MAX_FILES_PER_INPUT, UPLOAD_MAX_MB, file_problem, upload_file, type File_ref, type Upload } from '@/lib/hug';
import { Field, control_id, type Input_props } from './field';

interface Pending { key: string; file: File; progress: number; error: string | null; upload: Upload | null }

export function File_input({ input, value, on_change, error, disabled, hug_id, max_mb = UPLOAD_MAX_MB, on_busy }: Input_props<File_ref[]> & { hug_id: string; max_mb?: number; on_busy?: (busy: boolean) => void }) {
	const picker = useRef<HTMLInputElement>(null);
	const [pending, set_pending] = useState<Pending[]>([]);
	const latest = useRef(value);
	latest.current = value;
	if (input.type !== 'file') return null;
	const file_input = input;
	const limit = input.multiple ? MAX_FILES_PER_INPUT : 1;

	const update = (key: string, patch: Partial<Pending>) => set_pending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
	const settle = (list: Pending[]) => on_busy?.(list.some((p) => p.upload && !p.error));

	function start(p: Pending) {
		const upload = upload_file(hug_id, file_input.name, p.file, (fraction) => update(p.key, { progress: fraction }));
		update(p.key, { upload, error: null, progress: 0 });
		upload.done.then((ref) => {
			on_change(file_input.multiple ? [...latest.current, ref] : [ref]);
			set_pending((list) => { const next = list.filter((x) => x.key !== p.key); settle(next); return next; });
		}, (err: Error) => {
			set_pending((list) => { const next = list.map((x) => (x.key === p.key ? { ...x, upload: null, error: err.message } : x)); settle(next); return next; });
		});
	}

	function pick(files: FileList | null) {
		if (!files?.length) return;
		const room = limit - value.length - pending.length;
		const chosen = [...files].slice(0, Math.max(0, file_input.multiple ? room : 1));
		const added: Pending[] = chosen.map((file, n) => ({ key: `${Date.now()}-${n}-${file.name}`, file, progress: 0, error: file_problem(file_input, file, max_mb), upload: null }));
		set_pending((list) => [...(file_input.multiple ? list : []), ...added]);
		on_busy?.(added.some((p) => !p.error));
		for (const p of added) if (!p.error) setTimeout(() => start(p), 0);
		if (picker.current) picker.current.value = '';
	}

	function cancel(p: Pending) {
		p.upload?.abort();
		set_pending((list) => { const next = list.filter((x) => x.key !== p.key); settle(next); return next; });
	}

	return (
		<Field input={input} error={error} as_label={false}>
			<ul className="flex flex-col gap-1.5" aria-label={`${input.name} files`}>
				{value.map((f) => (
					<li key={f.artifact_id} className="flex items-center gap-2 text-[12.5px]">
						<span className="g-mono truncate">{f.name}</span>
						<span className="text-[var(--g-ink-3)]">{format_bytes(f.size)}</span>
						{!disabled ? <button type="button" onClick={() => on_change(value.filter((x) => x.artifact_id !== f.artifact_id))} className="ml-auto text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove</button> : null}
					</li>
				))}
				{pending.map((p) => (
					<li key={p.key} className="flex flex-col gap-1 text-[12.5px]" data-testid="upload-row">
						<div className="flex items-center gap-2">
							<span className="g-mono truncate">{p.file.name}</span>
							<span className="text-[var(--g-ink-3)]">{format_bytes(p.file.size)}</span>
							<span className="ml-auto flex gap-2">
								{p.error && p.upload === null && !file_problem(file_input, p.file, max_mb) ? <button type="button" onClick={() => start(p)} className="text-[12px] text-[var(--g-acc)]">Retry</button> : null}
								<button type="button" onClick={() => cancel(p)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">{p.error ? 'Dismiss' : 'Cancel'}</button>
							</span>
						</div>
						{p.error
							? <span role="alert" className="text-[11.5px] text-[var(--g-bad)]">{p.error}</span>
							: <progress aria-label={`Uploading ${p.file.name}`} max={1} value={p.progress} className="h-1.5 w-full" />}
					</li>
				))}
			</ul>
			{!disabled && value.length + pending.length < limit ? (
				<span>
					<input
						ref={picker}
						id={control_id(input.name)}
						type="file"
						multiple={Boolean(input.multiple)}
						accept={input.accept?.join(',')}
						className="sr-only"
						aria-label={`Choose ${input.multiple ? 'files' : 'a file'}`}
						onChange={(e) => pick(e.target.files)}
					/>
					<button type="button" onClick={() => picker.current?.click()} className={G_BTN}>{input.multiple ? 'Add files…' : value.length ? 'Replace file…' : 'Choose file…'}</button>
				</span>
			) : null}
		</Field>
	);
}

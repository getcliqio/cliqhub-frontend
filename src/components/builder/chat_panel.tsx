import { useState, useRef, useEffect, useCallback } from 'react';
import { useBuilder, useBuilderDispatch, type BuilderAction } from '@/lib/builder/store';

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	actions?: BuilderAction[];
}

const SAFE_ACTION_TYPES = new Set([
	'ADD_PHASE', 'REMOVE_PHASE', 'UPDATE_PHASE',
	'ADD_ROLE', 'UPDATE_ROLE', 'REMOVE_ROLE',
	'ADD_DEPENDENCY', 'REMOVE_DEPENDENCY',
	'UPDATE_TEAM',
]);

export function ChatPanel() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState('');
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const dragging_ref = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
	const scroll_ref = useRef<HTMLDivElement>(null);
	const input_ref = useRef<HTMLInputElement>(null);
	const panel_ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scroll_ref.current) {
			scroll_ref.current.scrollTop = scroll_ref.current.scrollHeight;
		}
	}, [messages]);

	useEffect(() => {
		if (open && input_ref.current) {
			input_ref.current.focus();
		}
	}, [open]);

	const on_drag_start = useCallback((e: React.MouseEvent) => {
		if ((e.target as HTMLElement).closest('button')) return;
		const rect = panel_ref.current?.getBoundingClientRect();
		if (!rect) return;
		dragging_ref.current = {
			startX: e.clientX,
			startY: e.clientY,
			origX: rect.left,
			origY: rect.top,
		};
		e.preventDefault();
	}, []);

	useEffect(() => {
		function on_move(e: MouseEvent) {
			const d = dragging_ref.current;
			if (!d) return;
			setPosition({
				x: d.origX + (e.clientX - d.startX),
				y: d.origY + (e.clientY - d.startY),
			});
		}
		function on_up() {
			dragging_ref.current = null;
		}
		window.addEventListener('mousemove', on_move);
		window.addEventListener('mouseup', on_up);
		return () => {
			window.removeEventListener('mousemove', on_move);
			window.removeEventListener('mouseup', on_up);
		};
	}, []);

	async function handle_send() {
		const text = input.trim();
		if (!text || !state.team || loading) return;

		const user_msg: ChatMessage = { role: 'user', content: text };
		const updated = [...messages, user_msg];
		setMessages(updated);
		setInput('');
		setLoading(true);

		try {
			const history = updated.map(m => ({ role: m.role, content: m.content }));

			const res = await fetch('/v1/teams/build', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
				body: JSON.stringify({
					action: 'chat',
					team: state.team,
					message: text,
					history: history.slice(0, -1),
				}),
			});

			const data = await res.json();

			if (!data.ok) {
				setMessages([...updated, {
					role: 'assistant',
					content: data.error?.message || 'Something went wrong.',
				}]);
				return;
			}

			const actions: BuilderAction[] = (data.data.actions || []).filter(
				(a: BuilderAction) => SAFE_ACTION_TYPES.has(a.type),
			);

			for (const action of actions) {
				dispatch(action);
			}

			setMessages([...updated, {
				role: 'assistant',
				content: data.data.reply,
				actions,
			}]);
		} catch {
			setMessages([...updated, {
				role: 'assistant',
				content: 'Network error — please try again.',
			}]);
		} finally {
			setLoading(false);
		}
	}

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="fixed bottom-16 right-80 z-50 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-700"
			>
				<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
				</svg>
				Build Assistant
			</button>
		);
	}

	const panel_style: React.CSSProperties = position
		? { top: position.y, left: position.x, bottom: 'auto', right: 'auto', height: 420 }
		: { bottom: 48, right: 320, height: 420 };

	return (
		<div
			ref={panel_ref}
			className="fixed z-50 flex w-96 flex-col rounded-xl border border-slate-200 bg-white shadow-2xl"
			style={panel_style}
		>
			{/* Header — drag handle */}
			<div
				onMouseDown={on_drag_start}
				className="flex cursor-grab items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-50 px-4 py-2 active:cursor-grabbing select-none"
			>
				<span className="text-sm font-bold text-slate-700">Build Assistant</span>
				<div className="flex items-center gap-2">
					{messages.length > 0 && (
						<button
							onClick={() => setMessages([])}
							className="text-xs text-slate-400 hover:text-slate-600"
						>
							Clear
						</button>
					)}
					<button
						onClick={() => setOpen(false)}
						className="text-slate-400 hover:text-slate-600"
					>
						<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				</div>
			</div>

			{/* Messages */}
			<div ref={scroll_ref} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
				{messages.length === 0 && (
					<div className="flex h-full items-center justify-center text-center">
					<p className="text-sm text-slate-500 leading-relaxed">
						Describe changes to your team in natural language.<br />
						<span className="text-slate-600 font-medium">
								&ldquo;Add a security gate after the developer phase&rdquo;
							</span>
						</p>
					</div>
				)}
				{messages.map((msg, i) => (
					<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
						<div
							className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
								msg.role === 'user'
									? 'bg-indigo-600 text-white'
									: 'bg-slate-100 text-slate-700'
							}`}
						>
							<p className="whitespace-pre-wrap">{msg.content}</p>
							{msg.actions && msg.actions.length > 0 && (
								<p className={`mt-1 text-xs ${
									msg.role === 'user' ? 'text-indigo-200' : 'text-slate-500'
								}`}>
									{msg.actions.length} change{msg.actions.length !== 1 ? 's' : ''} applied
								</p>
							)}
						</div>
					</div>
				))}
				{loading && (
					<div className="flex justify-start">
						<div className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2">
							<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
							<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
							<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
						</div>
					</div>
				)}
			</div>

			{/* Input */}
			<div className="border-t border-slate-200 px-3 py-2">
				<div className="flex gap-2">
					<input
						ref={input_ref}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handle_send()}
						placeholder="Describe a change..."
						disabled={loading || !state.team}
						className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-indigo-400 disabled:opacity-50"
					/>
					<button
						onClick={handle_send}
						disabled={!input.trim() || loading || !state.team}
						className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Lightweight markdown renderer for displaying role content, READMEs, etc.
 * Supports headings, fenced code blocks, lists, task lists, tables,
 * bold (**text**), and inline code (`text`).
 */
export function RenderedMarkdown({ content }: { content: string }) {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let in_code_block = false;
    let code_lines: string[] = [];
    let code_lang = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('```') && !in_code_block) {
            in_code_block = true;
            code_lang = line.slice(3).trim();
            code_lines = [];
            continue;
        }

        if (line.startsWith('```') && in_code_block) {
            in_code_block = false;
            elements.push(
                <pre key={`code-${i}`} className="my-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
                    {code_lang && <div className="mb-2 text-xs text-slate-400">{code_lang}</div>}
                    <code>{code_lines.join('\n')}</code>
                </pre>,
            );
            continue;
        }

        if (in_code_block) {
            code_lines.push(line);
            continue;
        }

        if (line.startsWith('### ')) {
            elements.push(<h4 key={i} className="mb-2 mt-6 text-sm font-bold text-slate-800">{line.slice(4)}</h4>);
            continue;
        }
        if (line.startsWith('## ')) {
            elements.push(<h3 key={i} className="mb-2 mt-6 text-base font-bold text-slate-800">{line.slice(3)}</h3>);
            continue;
        }
        if (line.startsWith('# ')) {
            elements.push(<h2 key={i} className="mb-3 mt-6 text-lg font-bold text-slate-900">{line.slice(2)}</h2>);
            continue;
        }
        if (line.startsWith('- [ ] ')) {
            elements.push(
                <div key={i} className="flex items-start gap-2 py-0.5 pl-2 text-sm text-slate-700">
                    <span className="mt-0.5 text-slate-400">&#9744;</span>
                    <span>{line.slice(6)}</span>
                </div>,
            );
            continue;
        }
        if (line.startsWith('- **') || line.startsWith('- ')) {
            elements.push(
                <div key={i} className="py-0.5 pl-4 text-sm text-slate-700" dangerouslySetInnerHTML={{
                    __html: '&bull; ' + line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5 text-xs">$1</code>'),
                }} />
            );
            continue;
        }
        if (line.startsWith('| ') && line.includes('|')) {
            const cells = line.split('|').slice(1, -1).map((c) => c.trim());
            const is_separator = cells.every((c) => /^[-:]+$/.test(c));
            if (!is_separator) {
                elements.push(
                    <div key={i} className="flex gap-4 border-b border-slate-100 py-1 text-xs text-slate-700">
                        {cells.map((cell, j) => (
                            <span key={j} className="flex-1" dangerouslySetInnerHTML={{
                                __html: cell.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5">$1</code>'),
                            }} />
                        ))}
                    </div>,
                );
            }
            continue;
        }
        if (line.trim() === '') {
            elements.push(<div key={i} className="h-2" />);
            continue;
        }
        elements.push(
            <p key={i} className="text-sm leading-relaxed text-slate-700" dangerouslySetInnerHTML={{
                __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="rounded bg-slate-100 px-1 py-0.5 text-xs">$1</code>'),
            }} />,
        );
    }

    return <div>{elements}</div>;
}

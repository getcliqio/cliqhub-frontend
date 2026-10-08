import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { Row_open, use_row_open } from '@/components/graphite/g_row';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }

function Table({ on_delete, on_open }: { on_delete: () => void; on_open?: () => void }) {
	const row = use_row_open();
	return (
		<table><tbody>
			<tr data-testid="row" {...row(on_open ? { on_open } : { to: '/things/1' })}>
				<td data-testid="cell">Thing one</td>
				<td>
					<Row_open {...(on_open ? { on_open } : { to: '/things/1' })} />
					<button type="button" onClick={on_delete}>Delete</button>
					<span role="button" data-testid="menu">⋯</span>
				</td>
			</tr>
		</tbody></table>
	);
}

function setup(over: { on_open?: () => void } = {}) {
	const on_delete = vi.fn();
	render(<MemoryRouter initialEntries={['/']}><Routes><Route path="*" element={<><Table on_delete={on_delete} {...over} /><Where /></>} /></Routes></MemoryRouter>);
	return { on_delete };
}

afterEach(() => vi.restoreAllMocks());

describe('row interaction standard', () => {
	it('a row click does the default action; the same action is a visible control', () => {
		setup();
		expect(screen.getByTestId('row-open')).toHaveAttribute('href', '/things/1');
		fireEvent.click(screen.getByTestId('cell'));
		expect(screen.getByTestId('where')).toHaveTextContent('/things/1');
	});

	it('a button in the row does only its own thing, without stopPropagation', () => {
		const { on_delete } = setup();
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByTestId('menu'));
		expect(on_delete).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
	});

	it('selecting text does not open; Cmd/Ctrl-click opens a new tab; an action row runs its action', () => {
		setup();
		vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Thing' } as Selection);
		fireEvent.click(screen.getByTestId('cell'));
		expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
		vi.restoreAllMocks();
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		fireEvent.click(screen.getByTestId('cell'), { metaKey: true });
		expect(open).toHaveBeenCalledWith('/things/1', '_blank', 'noopener');
	});

	it('a row that opens something in place runs on_open (from the row and from its Open button)', () => {
		const on_open = vi.fn();
		document.body.innerHTML = '';
		setup({ on_open });
		fireEvent.click(screen.getByTestId('cell'));
		fireEvent.click(screen.getByTestId('row-open'));
		expect(on_open).toHaveBeenCalledTimes(2);
	});
});

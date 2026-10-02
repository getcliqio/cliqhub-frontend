/** Sortable table headers: URL state, aria-sort, paging reset, server gating, client sort. */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { Sort_th, sort_rows, use_table_sort, type Table_sort_opts } from '@/components/graphite/g_sort';

function Where() { const l = useLocation(); return <div data-testid="where">{l.search}</div>; }

/** A two-column table; `server` = the server's `sortable` answer (undefined → client mode). */
function Table({ opts, server }: { opts: Table_sort_opts; server?: { sortable: string[] | null } }) {
	const sort = use_table_sort(opts);
	const cols = server ? sort.with_sortable(server.sortable) : sort;
	return (
		<>
			<table><thead><tr>
				<Sort_th sort={cols} k="name">Name</Sort_th>
				<Sort_th sort={cols} k="created_at">Created</Sort_th>
				<Sort_th sort={cols} k="other">Other</Sort_th>
			</tr></thead></table>
			<div data-testid="body">{JSON.stringify(sort.body)}</div>
		</>
	);
}

function at(path: string, el: React.ReactNode) {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{el}<Where /></>} /></Routes></MemoryRouter>);
}
const th = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('use_table_sort + Sort_th', () => {
	it('client mode: every key is a button; first click asc, second desc; aria-sort follows; paging resets', () => {
		at('/x?q=a&offset=50&page=2', <Table opts={{ keys: ['name', 'created_at'], mode: 'client' }} />);
		expect(th('Name')).toHaveAttribute('aria-sort', 'none');
		expect(th('Other')).not.toHaveAttribute('aria-sort');
		expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
		expect(screen.getByTestId('body')).toHaveTextContent('{}');

		fireEvent.click(screen.getByRole('button', { name: 'Name' }));
		expect(th('Name')).toHaveAttribute('aria-sort', 'ascending');
		expect(th('Created')).toHaveAttribute('aria-sort', 'none');
		expect(screen.getByTestId('where')).toHaveTextContent('?q=a&sort=name&dir=asc');
		expect(screen.getByTestId('body')).toHaveTextContent('{"sort_by":"name","sort_dir":"asc"}');

		fireEvent.click(screen.getByRole('button', { name: 'Name' }));
		expect(th('Name')).toHaveAttribute('aria-sort', 'descending');
		expect(screen.getByTestId('where')).toHaveTextContent('?q=a&sort=name&dir=desc');
	});

	it('shows the default order, starts a column at its first direction, ignores unknown URL keys', () => {
		at('/x?sort=password&dir=asc', <Table opts={{ keys: ['name', 'created_at'], mode: 'client', default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { created_at: 'desc' } }} />);
		expect(th('Created')).toHaveAttribute('aria-sort', 'descending');
		expect(screen.getByTestId('body')).toHaveTextContent('{}');
		// The default column flips; a new date column would start desc.
		fireEvent.click(screen.getByRole('button', { name: 'Created' }));
		expect(screen.getByTestId('where')).toHaveTextContent('sort=created_at&dir=asc');
	});

	it('server mode: only the server\'s sortable keys get a button; none before the first answer', () => {
		const { rerender } = at('/x', <Table opts={{ keys: ['name', 'created_at'] }} server={{ sortable: null }} />);
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		rerender(<MemoryRouter initialEntries={['/x']}><Routes><Route path="*" element={<Table opts={{ keys: ['name', 'created_at'] }} server={{ sortable: [] }} />} /></Routes></MemoryRouter>);
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		expect(th('Name')).not.toHaveAttribute('aria-sort');
	});

	it('server mode: lights up the listed keys and keeps them while the next page loads', () => {
		function Harness() {
			const sort = use_table_sort({ keys: ['name', 'created_at'] });
			// Simulates a read whose data is null while a re-sorted page loads.
			const cols = sort.with_sortable(sort.body.sort_by ? null : ['created_at']);
			return <table><thead><tr><Sort_th sort={cols} k="name">Name</Sort_th><Sort_th sort={cols} k="created_at">Created</Sort_th></tr></thead></table>;
		}
		at('/x', <Harness />);
		expect(screen.queryByRole('button', { name: 'Name' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Created' }));
		expect(screen.getByRole('button', { name: 'Created' })).toBeInTheDocument();
		expect(th('Created')).toHaveAttribute('aria-sort', 'ascending');
	});
});

describe('sort_rows', () => {
	const rows = [
		{ n: 'b10', v: 3 }, { n: 'B2', v: null }, { n: 'a', v: 1 }, { n: 'c', v: 3 },
	];
	const values = { name: (r: typeof rows[number]) => r.n, v: (r: typeof rows[number]) => r.v };

	it('strings: locale + numeric aware, case-insensitive', () => {
		expect(sort_rows(rows, { by: 'name', dir: 'asc' }, values).map((r) => r.n)).toEqual(['a', 'B2', 'b10', 'c']);
		expect(sort_rows(rows, { by: 'name', dir: 'desc' }, values).map((r) => r.n)).toEqual(['c', 'b10', 'B2', 'a']);
	});

	it('numbers: stable for ties, nulls last both ways; no sort → same order (copy)', () => {
		expect(sort_rows(rows, { by: 'v', dir: 'asc' }, values).map((r) => r.n)).toEqual(['a', 'b10', 'c', 'B2']);
		expect(sort_rows(rows, { by: 'v', dir: 'desc' }, values).map((r) => r.n)).toEqual(['b10', 'c', 'a', 'B2']);
		const same = sort_rows(rows, { by: null, dir: 'asc' }, values);
		expect(same).toEqual(rows);
		expect(same).not.toBe(rows);
	});
});

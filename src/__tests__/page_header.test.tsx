import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from '@/components/ui/page_header';

describe('PageHeader', () => {
  it('puts help tip next to the title and keeps docs inside the tip', () => {
    render(
      <PageHeader
        title="Scopes"
        description="Package namespaces for teams."
        help="Scopes do not enroll machines."
        docs_href="https://docs.getcliq.io/auth"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Scopes' })).toBeInTheDocument();
    expect(screen.getByText('Package namespaces for teams.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Docs →' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('About Scopes'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scopes do not enroll machines.');
    expect(screen.getByRole('link', { name: 'Docs →' })).toHaveAttribute(
      'href',
      'https://docs.getcliq.io/auth',
    );
  });
});

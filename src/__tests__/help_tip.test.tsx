import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpTip } from '@/components/ui/help_tip';

describe('HelpTip', () => {
  it('toggles tooltip content on click and closes on outside click', () => {
    render(<HelpTip label="scopes">Scopes explain access.</HelpTip>);
    const button = screen.getByLabelText('About scopes');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scopes explain access.');

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a docs link when docs_href is set', () => {
    render(
      <HelpTip label="auth" docs_href="https://docs.getcliq.io/auth">
        Auth explains tokens.
      </HelpTip>,
    );
    fireEvent.click(screen.getByLabelText('About auth'));
    const docs = screen.getByRole('link', { name: 'Docs →' });
    expect(docs).toHaveAttribute('href', 'https://docs.getcliq.io/auth');
  });
});

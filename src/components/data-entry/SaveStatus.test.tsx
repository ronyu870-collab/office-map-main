import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SaveStatus } from './SaveStatus';

describe('SaveStatus', () => {
  it('keeps failed state visible and exposes retry', () => {
    const retry = vi.fn();
    render(<SaveStatus state="error" message="Network unavailable" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveAttribute('data-save-state', 'error');
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit submitted state', () => {
    render(<SaveStatus state="submitted" message="Written to database" savedAt="2026-08-25T02:00:00Z" />);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });
});

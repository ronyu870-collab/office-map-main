import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SaveStatus } from './SaveStatus';

describe('SaveStatus', () => {
  it('keeps failed state visible and exposes retry', () => {
    const retry = vi.fn();
    render(<SaveStatus state="error" message="网络不可用" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveAttribute('data-save-state', 'error');
    expect(screen.getByText('保存失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit submitted state', () => {
    render(<SaveStatus state="submitted" message="已写入数据库" savedAt="2026-08-25T02:00:00Z" />);
    expect(screen.getByText('已提交')).toBeInTheDocument();
  });
});

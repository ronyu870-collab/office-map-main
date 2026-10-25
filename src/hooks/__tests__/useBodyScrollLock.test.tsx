import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog } from '@/src/components/ui/Dialog';
import { useBodyScrollLock } from '../useBodyScrollLock';

function Drawer({ open, child }: { open: boolean; child: boolean }) {
  useBodyScrollLock(open);
  return <Dialog open={child} onOpenChange={() => {}} title="Confirmation">Content</Dialog>;
}
afterEach(() => { cleanup(); document.body.style.overflow = ''; });
describe('body scroll lock ownership', () => {
  it('restores the original value when a drawer and its confirmation close together', () => {
    document.body.style.overflow = 'auto';
    const view = render(<Drawer open child={false} />);
    view.rerender(<Drawer open child />);
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<Drawer open={false} child={false} />);
    expect(document.body.style.overflow).toBe('auto');
  });
  it('keeps another dialog locked when its sibling closes and restores overflow on unmount', () => {
    const view = render(<><Dialog open onOpenChange={() => {}} title="First">Content</Dialog><Dialog open onOpenChange={() => {}} title="Second">Content</Dialog></>);
    view.rerender(<><Dialog open={false} onOpenChange={() => {}} title="First">Content</Dialog><Dialog open onOpenChange={() => {}} title="Second">Content</Dialog></>);
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

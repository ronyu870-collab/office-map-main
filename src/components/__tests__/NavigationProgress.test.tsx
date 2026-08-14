import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Mock NProgress before importing the component
const mockNProgress = {
  configure: vi.fn(),
  start: vi.fn(),
  done: vi.fn(),
};

vi.mock('nprogress', () => ({
  default: mockNProgress,
}));

// Mock next/navigation
const mockUsePathname = vi.fn(() => '/');
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

// Import component after mocks are set up
const { NavigationProgress } = await import('../NavigationProgress');

describe('NavigationProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/');
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should render without crashing', () => {
    render(<NavigationProgress />);
    // Component returns null, so we just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('should start progress bar after 300ms delay when link is clicked', async () => {
    vi.useFakeTimers();
    render(<NavigationProgress />);

    // Create a mock link element
    const link = document.createElement('a');
    link.href = window.location.origin + '/test';
    document.body.appendChild(link);

    // Click the link
    link.click();

    // Progress should not start immediately
    expect(mockNProgress.start).not.toHaveBeenCalled();

    // Fast-forward 300ms
    vi.advanceTimersByTime(300);

    // Now progress should start
    expect(mockNProgress.start).toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });

  it('should not show progress bar for fast navigations (< 300ms)', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<NavigationProgress />);

    // Create a mock link element
    const link = document.createElement('a');
    link.href = window.location.origin + '/test';
    document.body.appendChild(link);

    // Click the link
    link.click();

    // Fast-forward only 200ms (less than 300ms threshold)
    vi.advanceTimersByTime(200);

    // Simulate pathname change (navigation completed)
    mockUsePathname.mockReturnValue('/test');
    rerender(<NavigationProgress />);

    // Progress should not have started
    expect(mockNProgress.start).not.toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });

  it('should complete progress bar when pathname changes', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<NavigationProgress />);

    // Create a mock link element
    const link = document.createElement('a');
    link.href = window.location.origin + '/test';
    document.body.appendChild(link);

    // Click the link
    link.click();

    // Fast-forward past 300ms to start progress
    vi.advanceTimersByTime(300);
    expect(mockNProgress.start).toHaveBeenCalled();

    // Simulate pathname change (navigation completed)
    mockUsePathname.mockReturnValue('/test');
    rerender(<NavigationProgress />);

    // Progress should be completed
    expect(mockNProgress.done).toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });

  it('should not trigger for external links', () => {
    vi.useFakeTimers();
    render(<NavigationProgress />);

    // Create an external link
    const link = document.createElement('a');
    link.href = 'https://external.com/test';
    document.body.appendChild(link);

    // Click the link
    link.click();

    // Fast-forward past 300ms
    vi.advanceTimersByTime(300);

    // Progress should not start for external links
    expect(mockNProgress.start).not.toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });

  it('should not trigger for links with target attribute', () => {
    vi.useFakeTimers();
    render(<NavigationProgress />);

    // Create a link with target="_blank"
    const link = document.createElement('a');
    link.href = window.location.origin + '/test';
    link.target = '_blank';
    document.body.appendChild(link);

    // Click the link
    link.click();

    // Fast-forward past 300ms
    vi.advanceTimersByTime(300);

    // Progress should not start for links with target
    expect(mockNProgress.start).not.toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });
});

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock('next/dynamic', () => ({ default: (_loader: unknown, options: { loading: () => React.ReactNode }) => options.loading }));
import ComparePage from '../page';

it('preserves the map project and resume address while comparison code is loading', () => {
  const back = '/map?building=project-a&resume=return-token';
  state.search = new URLSearchParams({ back }).toString();
  render(<ComparePage />);
  expect(screen.getByRole('link', { name: '返回地图' })).toHaveAttribute('href', back);
  expect(screen.getByRole('status')).toHaveTextContent('正在加载楼宇对比');
});
it('rejects an external return address while comparison code is loading', () => {
  state.search = new URLSearchParams({ back: 'https://external.invalid/map' }).toString();
  render(<ComparePage />);
  expect(screen.getByRole('link', { name: '返回地图' })).toHaveAttribute('href', '/map');
});

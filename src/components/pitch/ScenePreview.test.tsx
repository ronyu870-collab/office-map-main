import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideScene } from '@/src/lib/pitch/contracts/scene';
vi.mock('next/image', () => ({ default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => { void _unoptimized; return <img {...props} alt={props.alt ?? ''} />; } })); // eslint-disable-line @next/next/no-img-element
vi.mock('@/src/components/ui', () => ({ Button: ({ variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => { void _variant; return <button {...props} />; } }));
import { ScenePreview } from './ScenePreview';
const scene: SlideScene = { protocol: 'colliers-pitch/1', rendererVersion: 'pitch-scene/2', width: 13.333333, height: 7.5, layoutId: 'two-columns', layoutVersion: 2, themeId: 'colliers-default-v1', themeVersion: 2, variant: 'standard', elements: [{ kind: 'text', text: 'TEST DATA', role: 'title', bold: true, x: .6, y: .6, w: 10, h: .7 }] };
const slides = [0, 1].map(i => ({ id: `slide-${i}`, asset_id: '22222222-2222-4222-8222-222222222222', scene }));
const project = { id: '11111111-1111-4111-8111-111111111111', title: '测试提案' }, themes = [{ id: 'colliers-default-v1', current_version: 2 }, { id: 'colliers-render-verification', current_version: 1 }];
const response = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><text>TEST DATA</text></svg>', pageCount: 1, font: 'Noto Sans SC', quality: [] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Pitch shared-scene preview and durable export interaction', () => {
  it('shows actual thumbnails and zoom while parameter changes refresh only the selected content group', async () => {
    const user = userEvent.setup(), call = vi.fn(async (_input: Record<string, unknown>, _write?: boolean) => { void _input; void _write; return response; });
    render(<ScenePreview project={project} slides={slides} themes={themes} call={call} canGenerate onSaved={async () => {}} />);
    fireEvent.load(await screen.findByAltText('第 1 页实际内容预览')); expect(screen.getByText(/字体与图片已加载/)).toBeInTheDocument(); expect(screen.getAllByRole('button', { name: /第 [12] 页/ })).toHaveLength(2);
    const before = call.mock.calls.length; await user.selectOptions(screen.getByLabelText('变体'), 'alternate');
    await waitFor(() => expect(call).toHaveBeenCalledTimes(before + 1));
    expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'preview', projectId: project.id, page: 0, variant: 'alternate' });
    await user.selectOptions(screen.getByLabelText('缩放'), '150'); expect(screen.getByLabelText('缩放')).toHaveValue('150');
    await user.click(screen.getByRole('button', { name: '第 2 页' })); await screen.findByAltText('第 2 页实际内容预览');
    expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1 });
  });
  it('polls durable progress, downloads the chosen format with its filename and exposes failed retry', async () => {
    const user = userEvent.setup(), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}), saved = vi.fn(async () => {});
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:synthetic'), revokeObjectURL: vi.fn() }));
    let fail = true;
    const call = vi.fn(async (input: Record<string, unknown>) => input.action === 'export_status' ? { id: '33333333-3333-4333-8333-333333333333', state: fail ? 'failed' : 'ready', progress: fail ? 30 : 100, format: 'png', filename: '测试提案-01.png', error_code: 'PITCH_WORKER_TIMEOUT' } : input.action === 'download' ? new Blob(['synthetic']) : response);
    render(<ScenePreview project={project} slides={slides} themes={themes} call={call} canGenerate onSaved={saved} />);
    await screen.findByAltText('第 1 页实际内容预览'); await user.selectOptions(screen.getByLabelText('文件格式'), 'png');
    await user.click(screen.getByRole('button', { name: '导出已保存页面' })); expect(await screen.findByRole('alert')).toHaveTextContent('PITCH_WORKER_TIMEOUT');
    fail = false; await user.click(screen.getByRole('button', { name: '重试导出' })); await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ action: 'export_start', format: 'png', page: 0 }), true); expect(saved).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('测试提案-01.png');
  });
});

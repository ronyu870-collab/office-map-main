import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Examples } from './Examples';
import { DECK_KITS } from '@/src/lib/pitch/templates/deckKits';
import { ECOSYSTEM_TEMPLATES } from '@/src/lib/pitch/templates/ecosystem';
import type { Call } from './client';
const templates = ECOSYSTEM_TEMPLATES.map(t => ({ id: t.id, name: t.names.zh, description: t.description, kind: 'custom', group: t.group }));
afterEach(cleanup);
const props = () => ({ call: vi.fn(async () => ({ svg: '<svg/>', items: [], next: null })) as unknown as Call, templates, busy: false, onExample: vi.fn(async () => { }), onBundle: vi.fn(async () => { }), buildingIds: [], period: '2026-Q1' });
describe('Examples and deck kits', () => {
    it('copies an actual selected example and keeps search editable', async () => { const user = userEvent.setup(), p = props(); render(<Examples {...p}/>); const search = screen.getByRole('searchbox', { name: '搜索模板' }); await user.type(search, '委托任务'); await user.click(screen.getByRole('button', { name: /委托任务摘要.*复制示例/ })); expect(p.onExample).toHaveBeenCalledWith(['mandate-summary'], undefined, false); expect(search).toBeInTheDocument(); });
    it('uses all sections or a chosen subset in stable kit order, and creates a separate demo', async () => { const user = userEvent.setup(), p = props(); render(<Examples {...p}/>); await user.click(screen.getByRole('tab', { name: '提案套装' })); const boxes = screen.getAllByRole('checkbox'); expect(boxes).toHaveLength(10); await user.click(boxes[1]); await user.click(screen.getByRole('button', { name: '加入选中示例页面' })); expect(p.onExample).toHaveBeenLastCalledWith(DECK_KITS[0].sections.filter((_, i) => i !== 1).map(s => s.templateId), { id: DECK_KITS[0].id, version: 1 }, false); await user.click(screen.getByRole('button', { name: '创建演示 Pitch' })); expect(p.onExample).toHaveBeenLastCalledWith(expect.any(Array), { id: DECK_KITS[0].id, version: 1 }, true); expect(screen.getByRole('button', { name: '使用已配置正式素材生成' })).toBeDisabled(); await user.selectOptions(screen.getByLabelText('提案套装'), 'market-review'); expect(screen.getAllByRole('checkbox').every(e => (e as HTMLInputElement).checked)).toBe(true); });
    it('reports real failure, prevents duplicate operations while busy and never enables an unavailable section', async () => { const user = userEvent.setup(), p = props(); p.onExample.mockRejectedValueOnce(new Error('权限已撤销')); const view = render(<Examples {...p}/>); await user.click(screen.getByRole('tab', { name: '提案套装' })); await user.click(screen.getByRole('button', { name: '创建演示 Pitch' })); expect(await screen.findByRole('alert')).toHaveTextContent('权限已撤销'); view.rerender(<Examples {...p} busy/>); expect(screen.getByRole('button', { name: '创建演示 Pitch' })).toBeDisabled(); });
    it('blocks incomplete kits after a recipe is withdrawn and lets users omit unavailable sections', async () => {
        const user = userEvent.setup(), p = props();
        p.templates = p.templates.filter(t => t.id !== DECK_KITS[0].sections[0].templateId);
        render(<Examples {...p}/>);
        await user.click(screen.getByRole('tab', { name: '提案套装' }));
        expect(screen.getByRole('button', { name: '创建演示 Pitch' })).toBeDisabled();
        await user.click(screen.getAllByRole('checkbox')[0]);
        expect(screen.getByRole('button', { name: '创建演示 Pitch' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: '创建演示 Pitch' }));
        expect(p.onExample).toHaveBeenCalledWith(DECK_KITS[0].sections.slice(1).map(s => s.templateId), expect.any(Object), true);
    });

});

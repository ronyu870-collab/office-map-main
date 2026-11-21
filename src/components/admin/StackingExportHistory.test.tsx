import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {StackingExportHistory} from './StackingExportHistory';
vi.mock('@/src/services/Auth',()=>({getSessionFast:async()=>({session:{access_token:'synthetic-admin'}})}));
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({records:[],has_next:false})));sessionStorage.clear();});
it('loads dedicated historical evidence only on explicit request and never treats a failed query as empty history',async()=>{
 render(<StackingExportHistory/>);expect(fetch).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('历史 Stacking Plan 导出凭据'));
 const input=screen.getByRole('textbox',{name:'历史导出楼宇 ID'});
 fireEvent.change(input,{target:{value:'11111111-1111-4111-8111-111111111111'}});
 fireEvent.click(screen.getByRole('button',{name:'查询历史导出'}));
 await screen.findByText('未查到历史导出记录。');
 expect(fetch).toHaveBeenCalledWith('/api/stacking-plan/11111111-1111-4111-8111-111111111111?export_history=1',expect.objectContaining({signal:expect.any(AbortSignal)}));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'读取权限已变更'},{status:403}));
 fireEvent.click(screen.getByRole('button',{name:'查询历史导出'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('读取权限已变更'));
 expect(screen.queryByText('未查到历史导出记录。')).not.toBeInTheDocument();
});

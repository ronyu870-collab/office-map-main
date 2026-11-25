import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { ControlConfiguration,defaultConfiguration } from './ControlConfiguration';
import type { RegisteredModel } from '@/src/lib/intelligence/control/config';
import type { ManagementRead } from '@/src/lib/intelligence/control/managementView';
const model:RegisteredModel={id:'synthetic',provider:'deepseek',model:'deepseek-flash',name:'合成模型',enabled:true,verification:'environment_legacy',verifiedAt:null,tools:true,structured:true,streaming:true,reasoning:null,continuation:false,contextLimit:null,outputLimit:null,inputRate:.3,cachedInputRate:null,outputRate:1.2,currency:'USD',priceSource:'synthetic fixture',priceDate:'2026-11-25'};
const config=defaultConfiguration(model),revision=crypto.randomUUID();
const read:ManagementRead={allowed:true,capabilities:['models:write','budgets:write'],state:{version:null,revision,paused:false,disabled_providers:[],disabled_models:[],changed_at:new Date().toISOString()},config,models:[model],drafts:[]};
afterEach(cleanup);
it('requires validated preview, saved draft and reason; successful publication advances the edit revision',async()=>{
 const next=crypto.randomUUID(),draftId=crypto.randomUUID(),dirty=vi.fn(),act=vi.fn(async(input)=>input.action==='draft'?{draft:{id:draftId}}:input.action==='publish'?{state:{revision:next}}:{diff:[]});
 render(<ControlConfiguration read={read} initial={config} onDirty={dirty} act={act} busy={false}/>);
 expect(screen.getByRole('button',{name:'保存草稿'})).toBeDisabled();expect(screen.getByRole('button',{name:'发布配置'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'校验并预览'}));await waitFor(()=>expect(screen.getByRole('button',{name:'保存草稿'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));fireEvent.change(screen.getByLabelText('发布原因'),{target:{value:'合成发布验证'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'发布配置'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'发布配置'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'发布配置'})).toBeDisabled());expect(dirty).toHaveBeenCalledWith(false);
 fireEvent.change(screen.getAllByLabelText('最多模型尝试')[0],{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'校验并预览'}));
 await waitFor(()=>expect(act).toHaveBeenLastCalledWith(expect.objectContaining({action:'validate',expectedRevision:next})));
});
it('retains draft values and original revision on validation conflict and concurrent read refresh',async()=>{
 const act=vi.fn(async()=>{throw Error('synthetic conflict');}),props={initial:config,onDirty:vi.fn(),act,busy:false};
 const view=render(<ControlConfiguration {...props} read={read}/>);fireEvent.change(screen.getAllByLabelText('最多模型尝试')[0],{target:{value:'2'}});
 view.rerender(<ControlConfiguration {...props} read={{...read,state:{...read.state,revision:crypto.randomUUID()}}}/>);
 fireEvent.click(screen.getByRole('button',{name:'校验并预览'}));await waitFor(()=>expect(act).toHaveBeenCalled());
 expect(act).toHaveBeenLastCalledWith(expect.objectContaining({expectedRevision:revision}));expect(screen.getAllByLabelText('最多模型尝试')[0]).toHaveValue(2);expect(screen.getByRole('button',{name:'保存草稿'})).toBeDisabled();
});

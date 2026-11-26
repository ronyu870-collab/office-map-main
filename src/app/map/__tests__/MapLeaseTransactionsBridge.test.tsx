import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapLeaseTransactionsBridge } from '../MapLeaseTransactionsBridge';

const auth=vi.hoisted(()=>({session:{user:{id:'reader'},role:'admin',sessionId:'session-one',session:{access_token:'isolated-token'}},targetUserId:null as string|null}));
vi.mock('@/src/components/SessionProvider',()=>({useAppSession:()=>({session:auth.session,status:'authenticated'})}));
vi.mock('@/src/contexts/ImpersonationContext',()=>({useImpersonation:()=>({targetUserId:auth.targetUserId})}));
vi.mock('@/src/services/Auth',()=>({getSessionFast:async()=>auth.session}));
vi.mock('@/src/services/impersonationHeaders',()=>({withImpersonationHeaders:(headers:HeadersInit)=>new Headers(headers)}));
vi.mock('../workspace/continuity',()=>({currentMapReturnHref:()=>'/map?resume=isolated'}));
let sequence=0;
beforeEach(()=>{
  auth.session={user:{id:'reader'},role:'admin',sessionId:'session-one',session:{access_token:'isolated-token'}};auth.targetUserId=null;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({count:1,records:[{read_id:'one',record_source:'history',building_match_scope:'project',company:'历史公司',effective_rent:0,transaction_year:2025,transaction_quarter:'Q4'}]})));
});
afterEach(()=>vi.unstubAllGlobals());
function setup(){
  const id=`test-${++sequence}`;
  const ui=()=><><div className="building-popup" data-building-id={id} data-building-name="甲楼"><button data-map-action="related-leases">关联成交</button></div><MapLeaseTransactionsBridge/></>;
  const view=render(ui());
  const trigger=screen.getByRole('button',{name:'关联成交'});trigger.focus();fireEvent.click(trigger);return {...view,trigger,rerenderScope:()=>view.rerender(ui())};
}
it('claims Escape for this task and restores its entry without closing the workspace',async()=>{
 const {trigger}=setup();await screen.findByText('历史公司');
 const parent=vi.fn();const handler=(event:KeyboardEvent)=>{if(!event.defaultPrevented)parent();};window.addEventListener('keydown',handler);
 try{fireEvent.keyDown(screen.getByRole('button',{name:'关闭关联成交'}),{key:'Escape'});expect(parent).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();}
 finally{window.removeEventListener('keydown',handler);}
});
it('leaves a child modal in control of Escape',async()=>{
 setup();await screen.findByText('历史公司');const child=document.createElement('div');child.setAttribute('aria-modal','true');document.body.appendChild(child);
 try{fireEvent.keyDown(child,{key:'Escape'});expect(screen.getByRole('dialog',{name:'甲楼关联成交'})).toBeVisible();}finally{child.remove();}
});
it.each(['user','role','sessionId','impersonation'])('removes old transaction content when %s scope changes',async kind=>{
 const view=setup();await screen.findByText('历史公司');
 if(kind==='user')auth.session={...auth.session,user:{id:'another'}};
 if(kind==='role')auth.session={...auth.session,role:'viewer'};
 if(kind==='sessionId')auth.session={...auth.session,sessionId:'another-session'};
 if(kind==='impersonation')auth.targetUserId='another-reader';
 view.rerenderScope();
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('preserves historic scope, original zero and missing terms in the expanded record',async()=>{
 setup();await screen.findByText('历史公司');fireEvent.click(screen.getByRole('article').querySelector('button')!);
 expect(screen.getByText('来源：历史成交库')).toBeVisible();expect(screen.getByText('项目级关联，历史记录无法精确到具体塔楼')).toBeVisible();
 expect(screen.getAllByText('净有效 ¥0/㎡/月')).toHaveLength(2);
});

it('aborts a closed read and never reopens from its late response',async()=>{
 let resolve!:(response:Response)=>void;
 vi.mocked(fetch).mockImplementation(()=>new Promise(done=>{resolve=done;}));
 setup();await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
 const signal=vi.mocked(fetch).mock.calls[0][1]?.signal;
 fireEvent.click(screen.getByRole('button',{name:'关闭关联成交'}));expect(signal?.aborted).toBe(true);
 await act(async()=>{resolve(Response.json({count:1,records:[{read_id:'late',company:'过期响应'}]}));});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText('过期响应')).not.toBeInTheDocument();
});
it('retries a denied read in the same project without changing its source identity',async()=>{
 const reader=vi.mocked(fetch);reader.mockResolvedValueOnce(Response.json({error:'当前账号无权读取'},{status:403}));
 setup();await screen.findByRole('alert');expect(screen.getByText('没有权限读取关联成交')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'重新加载'}));
 await screen.findByText('历史公司');expect(reader).toHaveBeenCalledTimes(2);expect(reader.mock.calls[1][0]).toBe(reader.mock.calls[0][0]);
});

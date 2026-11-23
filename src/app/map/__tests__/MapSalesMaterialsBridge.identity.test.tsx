import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MapSalesMaterialsBridge } from '../MapSalesMaterialsBridge';
const scope=vi.hoisted(()=>({status:'authenticated',session:{user:{id:'reader'},role:'admin',sessionId:'one'},targetUserId:null as string|null,targetRole:null as string|null,disposed:vi.fn()}));
vi.mock('@/src/components/SessionProvider',()=>({useAppSession:()=>scope}));
vi.mock('@/src/contexts/ImpersonationContext',()=>({useImpersonation:()=>scope}));
vi.mock('next/dynamic',()=>({default:()=>function Panel({buildingName,onClose}:{buildingName:string;onClose:()=>void}){useEffect(()=>()=>scope.disposed(),[]);return <div role="dialog" aria-label={buildingName}><p>旧身份项目资料</p><button onClick={onClose}>关闭</button></div>;}}));
beforeEach(()=>{scope.status='authenticated';scope.session={user:{id:'reader'},role:'admin',sessionId:'one'};scope.targetUserId=null;scope.targetRole=null;scope.disposed.mockClear();});
function setup(){
 const ui=()=><><button data-map-action="building-sales-control" data-building-id="building-a" data-building-name="甲楼">查看资料</button><MapSalesMaterialsBridge/></>;
 const view=render(ui());fireEvent.click(screen.getByText('查看资料'));return {...view,refresh:()=>view.rerender(ui())};
}
it.each(['user','role','session','impersonation','logout'])('disposes the previous reader on %s change and does not reopen when the original scope returns',async kind=>{
 const view=setup();expect(screen.getByRole('dialog')).toBeVisible();const original={...scope,session:scope.session};
 if(kind==='user')scope.session={...scope.session,user:{id:'another'}};
 if(kind==='role')scope.session={...scope.session,role:'viewer'};
 if(kind==='session')scope.session={...scope.session,sessionId:'two'};
 if(kind==='impersonation')scope.targetUserId='another-reader';
 if(kind==='logout')scope.status='unauthenticated';
 view.refresh();await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(scope.disposed).toHaveBeenCalledOnce();
 scope.status=original.status;scope.session=original.session;scope.targetUserId=original.targetUserId;scope.targetRole=original.targetRole;view.refresh();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('does not mount a private reader for an unauthenticated delegated entry',()=>{
 scope.status='unauthenticated';setup();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 window.dispatchEvent(new CustomEvent('broker:building-section',{detail:{section:'brochure',id:'building-a',name:'甲楼'}}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

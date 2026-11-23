import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MapSalesMaterialsBridge } from '../MapSalesMaterialsBridge';
import SalesMaterialsPanel from '../components/sales-materials/SalesMaterialsPanel';
import type { MaterialAccess, MaterialList, SalesMaterial } from '@/src/lib/sales-materials/model';
import type { SalesMaterialReader } from '@/src/services/salesMaterialsClient';
const scope=vi.hoisted(()=>({status:'authenticated',session:{user:{id:'reader'},role:'admin',sessionId:'one'},targetUserId:null as string|null}));
vi.mock('@/src/components/SessionProvider',()=>({useAppSession:()=>scope}));
vi.mock('@/src/contexts/ImpersonationContext',()=>({useImpersonation:()=>({...scope,targetRole:null})}));
vi.mock('@/src/utils/audit',()=>({logAction:vi.fn()}));
vi.mock('next/dynamic',()=>({default:()=>function Panel(props:ComponentProps<typeof SalesMaterialsPanel>){return <SalesMaterialsPanel {...props}/>;}}));
const material:SalesMaterial={id:'owner-a',title:'业主原件',source:'隔离来源',notes:'',original_name:'owner.pdf',mime_type:'application/pdf',file_size:100,document_date:null,created_at:'2026-11-21T00:00:00Z',content_types:['brochure']};
const access:MaterialAccess={preview_url:'',download_url:'',details:[],project_facts:[{label:'业主说明',value:'旧身份的私有资料内容',source_ref:'PDF第1页'}],provenance:{document_date_evidence:'',received:null,version_recorded_at:material.created_at,source_sha256:'a'.repeat(64)}};
beforeEach(()=>{scope.status='authenticated';scope.session={user:{id:'reader'},role:'admin',sessionId:'one'};scope.targetUserId=null;});
function setup(reader:SalesMaterialReader){
 const ui=()=><><button data-map-action="building-sales-control" data-building-id="building-a" data-building-name="甲楼" data-category="brochure">查看资料</button><MapSalesMaterialsBridge reader={reader}/></>;
 const view=render(ui());fireEvent.click(screen.getByText('查看资料'));return {...view,refresh:()=>view.rerender(ui())};
}
it('unmounts the actual loaded material view as soon as its role scope changes',async()=>{
 const reader={list:vi.fn(async()=>({records:[material],count:1})),access:vi.fn(async()=>access)};
 const view=setup(reader);await screen.findByText('旧身份的私有资料内容');scope.session={...scope.session,role:'viewer'};view.refresh();
 expect(screen.queryByText('旧身份的私有资料内容')).not.toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 scope.session={...scope.session,role:'admin'};view.refresh();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('aborts the actual catalog request and ignores its late private response on impersonation change',async()=>{
 let resolve!:(result:MaterialList)=>void;
 const reader={list:vi.fn(()=>new Promise<MaterialList>(done=>{resolve=done;})),access:vi.fn(async()=>access)};
 const view=setup(reader);await waitFor(()=>expect(reader.list).toHaveBeenCalledOnce());
 const signal=(reader.list.mock.calls[0] as unknown as Parameters<SalesMaterialReader['list']>)[2];
 scope.targetUserId='another-reader';view.refresh();expect(signal?.aborted).toBe(true);
 await act(async()=>{resolve({records:[material],count:1});await Promise.resolve();});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText('旧身份的私有资料内容')).not.toBeInTheDocument();expect(reader.access).not.toHaveBeenCalled();
});

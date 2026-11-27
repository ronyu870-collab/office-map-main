import * as React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const identity=vi.hoisted(()=>({id:'11111111-1111-4111-8111-111111111111'}));
vi.mock('@/src/services/supabaseClient',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:identity.id},access_token:'isolated-token'}}})}}}));
vi.mock('@/src/components/ui',()=>({Button:({variant,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string})=>{void variant;return <button {...props}/>;}}));
import {MaterialLibrary} from './MaterialLibrary';
import {layoutFixture} from '@/src/lib/pitch/fixtures/layouts';
const props={userId:identity.id,simulated:false,scopes:[{organizationId:'test',region:'test',city:'test',businessLine:'test',canMaintain:true,canGenerate:true}],categories:[{id:'22222222-2222-4222-8222-222222222222',names:{zh:'其他'},enabled:true,system_code:'general'}],themes:[],onProject:vi.fn()};
describe('Material library live search and access',()=>{
 beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'http://localhost').searchParams.get('q');return {ok:true,json:async()=>({items:q==='empty'?[]:[{id:'33333333-3333-4333-8333-333333333333',filename:'隔离资料 '+(q??''),state:'draft'}],next:null})};}));});
 afterEach(()=>{cleanup();vi.unstubAllGlobals();});
 it('keeps library search focused through delayed results, cursor edits, empty results and IME',async()=>{const user=userEvent.setup();render(<MaterialLibrary {...props}/>);const input=screen.getByRole('searchbox',{name:'搜索'}) as HTMLInputElement;await user.type(input,'Alpha中文');await screen.findByText('隔离资料 Alpha中文',{selector:'strong'});expect(input).toHaveFocus();expect(screen.getByRole('searchbox')).toBe(input);input.setSelectionRange(1,4);fireEvent.change(input,{target:{value:'A修改a中文'}});fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'A修改中文'}});fireEvent.compositionEnd(input);await screen.findByText('隔离资料 A修改中文',{selector:'strong'});expect(input).toHaveFocus();expect(screen.getByRole('searchbox')).toBe(input);await user.clear(input);await user.type(input,'empty');await screen.findByText('没有匹配且当前有权访问的素材。');expect(input).toHaveFocus();await user.clear(input);await user.type(input,'恢复');await screen.findByText('隔离资料 恢复',{selector:'strong'});expect(input).toHaveFocus();});
 it('read-only users keep full authorized retrieval and have no upload or management actions',async()=>{render(<MaterialLibrary {...props} scopes={[{...props.scopes[0],canMaintain:false,canGenerate:false}]}/>);await screen.findByText('隔离资料');expect(screen.queryByText('上传与维护')).not.toBeInTheDocument();expect(screen.queryByLabelText('选择上传文件')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'查看'})).toBeInTheDocument();});
 it('rejects missing metadata before starting a file upload and preserves the source field focus',async()=>{const user=userEvent.setup();render(<MaterialLibrary {...props}/>);await user.click(screen.getByText('上传与维护'));const field=screen.getByLabelText('来源说明');await user.type(field,'隔离来源');expect(field).toHaveFocus();await user.clear(field);const file=new File(['原文'],'隔离.txt',{type:'text/plain'});fireEvent.change(screen.getByLabelText('选择上传文件'),{target:{files:[file]}});await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('请填写授权范围'));expect(vi.mocked(fetch).mock.calls.every(([url])=>String(url).includes('action=search'))).toBe(true);});
 it('reuses the displayed published version and retries with the same project ID after a disconnect',async()=>{
  const assetId='33333333-3333-4333-8333-333333333333';
  const asset={id:assetId,current_version:4,organization_id:'test',region:'test',city:'test',business_line:'test',
   category_id:props.categories[0].id,tags:[],names:{zh:'隔离素材'},state:'published',visibility:'organization',
   allow_internal_generation:true,allow_client_export:false,allow_external_ai:false,valid_from:null,valid_until:null};
  const versions=[{version:4,state:'published'},{version:3,state:'draft'},{version:2,state:'published'}];
  const attempts:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   const query=new URL(url,'http://localhost').searchParams;
   if(query.get('action')==='asset'){
    const version=versions.find(item=>item.version===Number(query.get('version')??4))!;
    const title=version.version===2?'旧版已发布标题':'当前素材标题';
    return {ok:true,json:async()=>({asset,version:{...version,allow_internal_generation:true,content:{...layoutFixture('kpi'),title}},versions})};
   }
   if(init.method==='POST'){
    const request=JSON.parse(String(init.body));
    attempts.push(request);
    if(attempts.length===1)throw new Error('连接已中断');
    return {ok:true,json:async()=>({projectId:request.projectId,replayed:true})};
   }
   return {ok:true,json:async()=>({items:query.get('kind')==='assets'?[asset]:[],next:null})};
  }));
  const user=userEvent.setup(),onProject=vi.fn(async()=>{});
  render(<MaterialLibrary {...props} themes={[{id:'theme',current_version:1}]} onProject={onProject}/>);
  await user.click(screen.getByRole('button',{name:'内容资产'}));
  await user.click(await screen.findByRole('button',{name:'查看'}));
  await screen.findByRole('heading',{name:'结构化资产 · 版本 4'});
  await user.selectOptions(screen.getByLabelText('生成主题'),JSON.stringify(['theme',1]));
  await user.click(screen.getByText('资产历史版本'));
  await user.click(screen.getByRole('button',{name:'查看 v3 · draft'}));
  await screen.findByRole('heading',{name:'结构化资产 · 版本 3'});
  const generate=screen.getByRole('button',{name:'生成标准页面并预览导出'});
  expect(generate).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'查看 v2 · published'}));
  await screen.findByRole('heading',{name:'结构化资产 · 版本 2'});
  const title=screen.getByLabelText('资产标题');
  await user.clear(title);
  await user.type(title,'未保存的人工标题');
  await user.click(generate);
  await screen.findByText('连接已中断');
  await user.click(generate);
  await waitFor(()=>expect(onProject).toHaveBeenCalledOnce());
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({action:'normalize',assetId,assetVersion:2,title:'旧版已发布标题',themeId:'theme',themeVersion:1});
  expect(attempts[1]).toEqual(attempts[0]);
  expect(onProject).toHaveBeenCalledWith(attempts[0].projectId);
 });
});

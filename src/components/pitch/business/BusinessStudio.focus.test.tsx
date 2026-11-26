import * as React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const id='11111111-1111-4111-8111-111111111111';
vi.mock('@/src/services/supabaseClient',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'isolated-token'}}})}}}));
vi.mock('@/src/components/ui',()=>({Button:({variant,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string})=>{void variant;return <button {...props}/>;}}));
import {BusinessStudio} from './BusinessStudio';
const props={userId:id,simulated:false,scopes:[{organizationId:'test',region:'test',city:'test',businessLine:'test',canMaintain:false,canGenerate:true}],themes:[],categories:[],onProject:vi.fn()};
describe('Business studio production controls',()=>{
 beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const params=new URL(url,'http://localhost').searchParams,action=params.get('action'),q=params.get('q')??'';return {ok:true,json:async()=>action==='catalog'?{recipes:[],dynamic:[{id:'building-profile',name:'项目概况',status:'available',reason:'可信数据'}]}:action==='buildings'?{items:[{id,name:'隔离楼宇 '+q}],next:null}:{items:q==='empty'?[]:[{id,names:{zh:'隔离资产 '+q},state:'published',current_version:1,is_test_data:true}],next:null}};})));
 afterEach(()=>{cleanup();vi.unstubAllGlobals();});
 it('keeps asset search stable through delayed results, middle edits, empty results and Chinese IME',async()=>{
   const user=userEvent.setup();render(<BusinessStudio {...props}/>);const input=screen.getByRole('searchbox',{name:'搜索企业资产'}) as HTMLInputElement;
   await user.type(input,'Alpha中文');await screen.findByText(/隔离资产 Alpha中文/);expect(input).toHaveFocus();input.setSelectionRange(1,4);fireEvent.change(input,{target:{value:'A修改中文'}});fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'A修改测试中文'}});fireEvent.compositionEnd(input);await screen.findByText(/隔离资产 A修改测试中文/);expect(screen.getByRole('searchbox',{name:'搜索企业资产'})).toBe(input);expect(input).toHaveFocus();await user.clear(input);await user.type(input,'empty');await screen.findByText('没有匹配且当前有权访问的企业资产。');expect(input).toHaveFocus();await user.clear(input);await user.type(input,'恢复');await screen.findByText(/隔离资产 恢复/);expect(input).toHaveFocus();
 });
 it('keeps real building selection search focused when authorized catalog results change',async()=>{
   const user=userEvent.setup();render(<BusinessStudio {...props}/>);await user.selectOptions(screen.getByLabelText('生产模式'),'dynamic');const input=screen.getByRole('searchbox',{name:'查找获权楼宇'});await user.type(input,'真实');await screen.findByText('隔离楼宇 真实');expect(input).toHaveFocus();await user.clear(input);await user.type(input,'楼宇');await screen.findByText('隔离楼宇 楼宇');expect(screen.getByRole('searchbox',{name:'查找获权楼宇'})).toBe(input);expect(input).toHaveFocus();
 });
 it('read-only accounts can retrieve permitted assets but cannot maintain or generate',async()=>{render(<BusinessStudio {...props} scopes={[{...props.scopes[0],canGenerate:false}]}/>);await screen.findByText(/隔离资产/);expect(screen.queryByText('企业业务档案维护')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'生成并保存 Pitch'})).toBeDisabled();expect(screen.getByRole('button',{name:'加入提案'})).toBeDisabled();});
});

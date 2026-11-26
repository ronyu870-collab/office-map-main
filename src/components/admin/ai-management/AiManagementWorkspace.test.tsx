import * as React from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/src/services/aiManagementClient',async original=>({...await original<typeof import('@/src/services/aiManagementClient')>(),requestAiManagement:request}));
vi.mock('@/src/components/SessionProvider',()=>({useAppSession:()=>({session:null,status:'unauthenticated'})}));
vi.mock('@/src/contexts/ImpersonationContext',()=>({useImpersonation:()=>({isImpersonating:false,targetUserId:null})}));
import { ManagementConsole } from './AiManagementWorkspace';
import { ManagementError } from '@/src/services/aiManagementClient';
const scope={actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},now='2026-11-26T00:00:00Z';
const read=()=>({allowed:true,capabilities:['operations:read'],state:{version:null,revision:crypto.randomUUID(),paused:false,disabled_providers:[],disabled_models:[],changed_at:now},models:[],config:null,drafts:[],environment:{models:[],limits:{tokens:60000,usd:.25,outputTokens:1800,timeoutMs:18000},providers:{deepseek:{credentials:false,enabled:false},openai:{credentials:false,enabled:false}},fallback:false}});
const overview=()=>({allowed:true,asOf:now,from:now,to:now,bucket:'hour',metrics:{requests:0,completed:0,partial:0,failed:0,cancelled:0,denied:0,clarification:0,running:0,possiblyInterrupted:0,p95Ms:null,formalResults:0,fileTasks:0,fileTasksCompleted:0},usage:{calls:0,notSent:0,unknownUsage:0,inputTokens:null,outputTokens:null,cachedInputTokens:null,reasoningTokens:null,estimatedUsd:null,reservedUnknownUsd:null,actualBilledUsd:null,billingStatus:'not_reconciled'},routes:[],models:[],trend:[],coverage:{firstProjectedAt:null,projectedRequests:0,auditRequests:0,missingEvents:0}});
beforeEach(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});request.mockImplementation(async(_scope,input)=>input.action==='read'?read():input.action==='overview'?overview():{allowed:true,asOf:now,totals:[],unsettledAttempts:0});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
describe('AI management workspace lifecycle and safe states',()=>{
 it('uses nine real tabs, shows unknown usage without fake model health, and reads operations only after authority',async()=>{
  render(<ManagementConsole scope={scope}/>);await screen.findByText('AI 请求');expect(screen.getByRole('navigation',{name:'AI 管理标签'}).querySelectorAll('button')).toHaveLength(9);
  expect(request.mock.calls.map(c=>c[1].action)).toEqual(['read','overview','budget']);expect(screen.getAllByText(/未配置/).length).toBeGreaterThan(0);expect(screen.queryByText('正常')).toBeNull();
 });
 it('does not fetch operational statistics for a model-only operator',async()=>{
  request.mockImplementation(async()=>({...read(),capabilities:['models:write']}));render(<ManagementConsole scope={scope}/>);
  await screen.findByText('需要独立运营读取资格。');expect(request.mock.calls.map(c=>c[1].action)).toEqual(['read']);
 });
 it('clears private data and stops all polling while hidden; resumes with a fresh authority read',async()=>{
  vi.useFakeTimers();render(<ManagementConsole scope={scope}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  expect(screen.getByText('AI 请求')).toBeInTheDocument();const before=request.mock.calls.length;
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));
  expect(screen.queryByText('AI 请求')).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(90000);});expect(request.mock.calls.length).toBe(before);
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});expect(request.mock.calls[before][1].action).toBe('read');
 });
 it('clears cached management data on revocation, and cancels the outstanding scope on unmount',async()=>{
  const view=render(<ManagementConsole scope={scope}/>);await screen.findByText('AI 请求');request.mockRejectedValue(new ManagementError('denied'));
  fireEvent.click(screen.getByRole('button',{name:'刷新'}));await screen.findByText('当前身份或管理资格已失效，管理数据已清除。');expect(screen.queryByText('AI 请求')).toBeNull();
  const signal=request.mock.calls.at(-1)![2] as AbortSignal;view.unmount();expect(signal.aborted).toBe(true);
 });
 it('navigates to task monitoring and uses server-side filters and bounded paging',async()=>{
  request.mockImplementation(async(_scope,input)=>input.action==='read'?read():input.action==='tasks'?{allowed:true,asOf:now,items:[],hasMore:false}:input.action==='overview'?overview():{allowed:true,asOf:now,totals:[],unsettledAttempts:0});
  render(<ManagementConsole scope={scope}/>);await screen.findByText('AI 请求');fireEvent.click(screen.getByRole('button',{name:'任务监控'}));await screen.findByText('当前与历史任务');
  fireEvent.change(screen.getByLabelText('状态'),{target:{value:'failed'}});fireEvent.click(screen.getByRole('button',{name:'应用筛选'}));await waitFor(()=>expect(request.mock.calls.some(c=>c[1].action==='tasks'&&c[1].state==='failed')).toBe(true));
 });
 it('a secondary tab reads once, retries only the lock, takes over polling and releases it when hidden',async()=>{
  vi.useFakeTimers();let available=false,released=false;
  const lock=vi.fn(async(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<void>)=>{await callback(available?{}:null);if(available)released=true;});
  Object.defineProperty(navigator,'locks',{value:{request:lock},configurable:true});
  render(<ManagementConsole scope={scope}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  const initial=request.mock.calls.length;expect(initial).toBe(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(request.mock.calls.length).toBe(initial);expect(lock).toHaveBeenCalledTimes(3);
  available=true;await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(request.mock.calls.length).toBe(initial+3);
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(async()=>{await Promise.resolve();});expect(released).toBe(true);
 });
 it('keeps task filter focus, caret and Chinese composition across server results and empty pages',async()=>{
  let finish:(value:unknown)=>void=()=>{};
  const pending=new Promise(resolve=>{finish=resolve;});let delayed=false;
  request.mockImplementation(async(_scope,input)=>input.action==='read'?read():input.action==='tasks'?(delayed?pending:{allowed:true,asOf:now,items:[],hasMore:false}):input.action==='overview'?overview():{allowed:true,asOf:now,totals:[],unsettledAttempts:0});
  render(<ManagementConsole scope={scope}/>);await screen.findByText('AI 请求');
  fireEvent.click(screen.getByRole('button',{name:'任务监控'}));await screen.findByText('当前筛选无投影任务；历史覆盖缺口见总览。');
  const input=screen.getByLabelText('模型 ID') as HTMLInputElement;input.focus();
  fireEvent.change(input,{target:{value:'deep'}});input.setSelectionRange(2,2);
  delayed=true;fireEvent.click(screen.getByRole('button',{name:'应用筛选'}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith(scope,expect.objectContaining({action:'tasks',model:'deep'}),expect.any(AbortSignal)));
  expect(input).toHaveFocus();expect(input.selectionStart).toBe(2);
  fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'de模型ep'}});input.setSelectionRange(4,4);
  await act(async()=>{finish({allowed:true,asOf:now,items:[],hasMore:false});});
  expect(screen.getByLabelText('模型 ID')).toBe(input);expect(input).toHaveFocus();expect(input).toHaveValue('de模型ep');expect(input.selectionStart).toBe(4);
  fireEvent.compositionEnd(input);fireEvent.change(input,{target:{value:'deepseek'}});input.setSelectionRange(8,8);
  expect(input).toHaveFocus();expect(input.selectionStart).toBe(8);
  fireEvent.change(input,{target:{value:''}});expect(input).toHaveFocus();expect(input).toHaveValue('');
 });

});

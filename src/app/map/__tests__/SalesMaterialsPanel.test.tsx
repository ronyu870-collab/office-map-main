import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SalesMaterialsPanel from '../components/sales-materials/SalesMaterialsPanel';
import type { MaterialAccess, SalesMaterial } from '@/src/lib/sales-materials/model';
vi.mock('../components/sales-materials/SalesPdfViewer',()=>({default:({url,title}:{url:string;title:string})=><div aria-label={`${title} PDF`} data-url={url}/> }));
const mocks=vi.hoisted(()=>({list:vi.fn(),access:vi.fn()}));
vi.mock('@/src/services/salesMaterialsClient',()=>({salesMaterialReader:{list:mocks.list,access:mocks.access}}));
const buildingId='749e53a6-9d2e-40f0-8d36-e42a6e6ad36d';
const id='22222222-2222-4222-8222-222222222222';
const row:SalesMaterial={id,title:'空置面积表',document_date:null,source:'中海商务',notes:'不应显示的技术备注',original_name:'raw-file.png',mime_type:'image/png',file_size:1024,created_at:'2026-10-23T01:00:00Z'};
const access:MaterialAccess={provenance:{document_date_evidence:'',received:null,version_recorded_at:row.created_at,source_sha256:'a'.repeat(64)},preview_url:'https://synthetic.invalid/original',download_url:'https://synthetic.invalid/download',details:[{floor_unit:'6、7层连层',area_sqm:4996.77,orientation:'均有',delivery_time:'随时交付',delivery_condition:'遗留装修',asking_rent:350,rent_basis:'month',management_fee:33,price_note:'含税不含物业费',notes:''}]};
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue({records:[row],count:1});mocks.access.mockResolvedValue(access);});
const open=()=>render(<SalesMaterialsPanel buildingId={buildingId} buildingName="中建财富国际中心" onClose={vi.fn()}/>);
describe('极简只读销控',()=>{
  it('shows complementary series together and leaves policy validity independent of data dates',async()=>{
    const second={...row,id:'44444444-4444-4444-8444-444444444444',series_key:'premium',scope_label:'臻选房源',mime_type:'application/pdf',content_types:['availability','commission'] as const};
    mocks.list.mockResolvedValue({records:[{...row,series_key:'standard',scope_label:'普通房源'},second],count:2});
    const policy={key:'agency',title:'代理佣金',scope:'臻选房源',summary:'1.5个月起',basis:'合同签约表面租金',valid_from:'2026-09-01',valid_until:'2027-02-28',validity_note:'',settlement:'',rules:[{kind:'base',label:'基础佣金',reward:'1.5个月起',condition:'',applicability:'stated'}],source_ref:'PDF第3页',notes:['原件：仅供参考，实际以签字/盖章版为准。']};
    mocks.access.mockImplementation((_building:string,material:string)=>Promise.resolve(material===id?access:{...access,details:[{...access.details[0],floor_unit:'3E',asking_rent:null}],commission_policies:[policy,{...policy,key:'retail',title:'商业佣金',source_ref:'PDF第4页'}],provenance:{...access.provenance,as_of:{value:'2026-10-13',evidence:'Hang Yu 确认'}}}));
    open();expect(await screen.findByRole('article',{name:'3E'})).toBeInTheDocument();expect(screen.getByRole('article',{name:'6、7层连层'})).toBeInTheDocument();
    expect(screen.getByText('未提供报价')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'佣金政策'}));
    expect(await screen.findByRole('article',{name:'代理佣金'})).toHaveTextContent('2026-09-01 — 2027-02-28');
    expect(screen.getAllByText('数据截至 2026.10.13')).toHaveLength(1);
    expect(screen.queryByText(/仅供参考/)).not.toBeInTheDocument();
    expect(screen.queryByText('PDF第3页')).not.toBeInTheDocument();expect(screen.queryByText('PDF第4页')).not.toBeInTheDocument();
    expect(screen.queryByText('标准、奖励与适用条件')).not.toBeInTheDocument();
    expect(screen.queryByText('时间来源')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'查看政策原件'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'数据截至 2026.10.13'}));
    expect(screen.getByText('依据：Hang Yu 确认')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'数据截至 2026.10.13'}));
    fireEvent.click(screen.getByRole('button',{name:'查看原件'}));expect(await screen.findByLabelText('空置面积表 PDF')).toHaveAttribute('data-url',`${access.preview_url}#page=3`);
  });
  it('shows availability immediately, with no management UI or explanatory copy',async()=>{
    open();expect(await screen.findByRole('region',{name:'可租房源'})).toBeInTheDocument();
    expect(screen.getByRole('article',{name:'6、7层连层'})).toHaveTextContent('4,996.77㎡');expect(screen.getByRole('article',{name:'6、7层连层'})).toHaveTextContent('350元/㎡/月');expect(screen.getByText('33 元/㎡/月')).toBeInTheDocument();
    expect(screen.getByText('含税不含物业费')).toBeInTheDocument();
    expect(screen.queryByText('上传业主资料')).not.toBeInTheDocument();expect(screen.queryByText('维护明细')).not.toBeInTheDocument();
    expect(screen.queryByText(/不应显示的技术备注/)).not.toBeInTheDocument();expect(screen.queryByText('raw-file.png')).not.toBeInTheDocument();expect(screen.getByText('业主日期未注明')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('reveals each row’s time evidence without presenting ingestion as an owner update',async()=>{
    open();await screen.findByRole('region',{name:'可租房源'});
    expect(screen.queryByText('时效未核实')).not.toBeInTheDocument();
    expect(screen.queryByText('解析入库')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'业主日期未注明'}));
    expect(screen.getAllByText('接收时间未记录')).toHaveLength(1);
    expect(screen.getAllByText('未记录业主确认')).toHaveLength(1);
    expect(screen.getAllByText(/此时间不代表业主更新或确认/)).toHaveLength(1);
    expect(screen.getAllByText(/2026\/10\/23 09:00:00/)).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button',{name:'查看对应原件'})[0]);
    expect(await screen.findByRole('img')).toHaveAttribute('src',access.preview_url);
  });
  it('uses the user-provided data date in the header and each row while preserving its source',async()=>{
    const evidence="Hang Yu 本次会话答复‘10月15日’，按当前年份记为2026-10-15；原图未印日期。";
    mocks.access.mockResolvedValue({...access,details:[
      {...access.details[0],source_row_ref:'原图第1行',timing:{as_of:{value:'2026-10-15',evidence},confirmed:null}},
      {...access.details[0],floor_unit:'25层',source_row_ref:'原图第2行',timing:{as_of:{value:'2026-10-15',evidence},confirmed:null}},
    ]});
    open();await screen.findByRole('region',{name:'可租房源'});
    expect(screen.getByText('数据截至 2026.10.15')).toBeInTheDocument();
    expect(screen.queryByText('业主日期未注明')).not.toBeInTheDocument();
    expect(screen.queryByText('时效未核实')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'6、7层连层 · 时间来源'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'数据截至 2026.10.15'}));
    expect(screen.getAllByText(`依据：${evidence}`)).toHaveLength(1);
    expect(screen.getAllByText('未记录业主确认')).toHaveLength(1);
    expect(screen.getByText('原图第1行；原图第2行')).toBeInTheDocument();
  });
  it('shares timing evidence across matching rows and keeps mixed dates individually traceable',async()=>{
    const event={value:'2026-10-13',evidence:'Hang Yu 确认10月13日'};
    const nextEvent={value:'2026-10-15',evidence:'业主另行确认10月15日'};
    mocks.access.mockResolvedValue({...access,provenance:{...access.provenance,as_of:event},details:[
      {...access.details[0],timing:{as_of:event,confirmed:null}},
      {...access.details[0],floor_unit:'25层',timing:{as_of:nextEvent,confirmed:null}},
    ]});
    open();await screen.findByRole('region',{name:'可租房源'});
    expect(screen.getByRole('button',{name:'数据日期见各房源'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'25层 · 时间来源'}));
    expect(screen.getByText(`依据：${nextEvent.evidence}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'25层 · 时间来源'}));
    fireEvent.click(screen.getByRole('button',{name:'数据日期见各房源'}));
    expect(screen.getByText(`依据：${event.evidence}`)).toBeInTheDocument();
    expect(screen.getByText(`依据：${nextEvent.evidence}`)).toBeInTheDocument();
  });
  it('shows project values without repeated page references and retains the date and original entries',async()=>{
    mocks.list.mockResolvedValue({records:[{...row,content_types:['brochure']}],count:1});
    mocks.access.mockResolvedValue({...access,details:[],project_facts:[{label:'净高',value:'2.8米',source_ref:'PDF第9页基本参数'},{label:'空调',value:'VAV系统',source_ref:'PDF第9页'}],provenance:{...access.provenance,as_of:{value:'2026-10-13',evidence:'Hang Yu 确认'}}});
    open();expect(await screen.findByText('2.8米')).toBeInTheDocument();
    expect(screen.getByText('VAV系统')).toBeInTheDocument();
    expect(screen.queryByText(/PDF第9页/)).not.toBeInTheDocument();
    expect(screen.queryByText('解析入库')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'数据截至 2026.10.13'}));
    expect(screen.getByText('依据：Hang Yu 确认')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'查看原件'}));
    expect(await screen.findByRole('img')).toHaveAttribute('src',access.preview_url);
  });
  it('opens the stored original, zooms and returns to the same availability',async()=>{
    open();await screen.findByRole('region',{name:'可租房源'});fireEvent.click(screen.getByRole('button',{name:'查看原件'}));
    expect(await screen.findByRole('img')).toHaveAttribute('src',access.preview_url);
    fireEvent.click(screen.getByRole('button',{name:'放大原件'}));expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'下载原件'})).toHaveAttribute('href',access.download_url);
    fireEvent.click(screen.getByRole('button',{name:'返回房源'}));expect(screen.getByRole('region',{name:'可租房源'})).toBeInTheDocument();
  });
  it('only offers version selection when another version exists and guards stale data',async()=>{
    const nextId='44444444-4444-4444-8444-444444444444';mocks.list.mockResolvedValue({records:[row,{...row,id:nextId,title:'历史版',created_at:'2026-10-22T01:00:00Z'}],count:2});
    let resolveNext!:(value:MaterialAccess)=>void;
    mocks.access.mockImplementation((_building:string,material:string)=>material===id?Promise.resolve(access):new Promise(resolve=>{resolveNext=resolve;}));
    open();await screen.findByRole('region',{name:'可租房源'});fireEvent.change(screen.getByLabelText('资料版本'),{target:{value:nextId}});
    await waitFor(()=>expect(screen.queryByRole('region',{name:'可租房源'})).not.toBeInTheDocument());
    await act(async()=>resolveNext({...access,details:[{...access.details[0],floor_unit:'历史房源'}]}));
    expect(await screen.findByRole('article',{name:'历史房源'})).toBeInTheDocument();
  });
  it('shows a concise empty state without dummy inventory',async()=>{
    mocks.list.mockResolvedValue({records:[],count:0});open();expect(await screen.findByText('暂无销控资料')).toBeInTheDocument();expect(mocks.access).not.toHaveBeenCalled();
  });
  it('retries a failed real read',async()=>{
    mocks.list.mockRejectedValueOnce(new Error('读取失败'));open();expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
    fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(await screen.findByRole('region',{name:'可租房源'})).toBeInTheDocument();
  });
  it('renders the stored PDF without extra instructions',async()=>{
    mocks.list.mockResolvedValue({records:[{...row,mime_type:'application/pdf'}],count:1});open();await screen.findByRole('region',{name:'可租房源'});fireEvent.click(screen.getByRole('button',{name:'查看原件'}));
    expect(await screen.findByLabelText('空置面积表 PDF')).toHaveAttribute('data-url',access.preview_url);expect(screen.getByRole('link',{name:'下载原件'})).toBeInTheDocument();
  });
});

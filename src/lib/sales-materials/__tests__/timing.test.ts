import { describe, expect, it } from 'vitest';
import { materialProvenance, type AvailabilityRow, type SalesMaterial } from '../model';
import { formatSourceTime, rowAsOf, rowTimeLabel } from '../timing';
const material: SalesMaterial = {id:'id',title:'业主空置表',document_date:'2026-10-20',source:'业主',notes:'',original_name:'owner.png',mime_type:'image/png',file_size:100,created_at:'2026-10-23T01:00:00Z'};
const row: AvailabilityRow = {floor_unit:'25层',area_sqm:100,orientation:'南',delivery_time:'随时交付',delivery_condition:'装修',asking_rent:350,rent_basis:'month',management_fee:33,price_note:'',notes:''};
const provenance = materialProvenance({created_at:material.created_at,source_sha256:'a'.repeat(64),extraction:{source_timing:{document_date_evidence:'原件标题旁：截至2026年10月20日',received:{value:'2026-10-22',evidence:'原始微信消息日期'}}}});
const now = new Date('2026-10-23T01:00:00Z');
describe('房源时间溯源',()=>{
  it('inherits only an evidenced owner date and shows its actual age',()=>{
    expect(rowAsOf(row,material,provenance)).toEqual({value:'2026-10-20',evidence:'原件标题旁：截至2026年10月20日'});
    expect(rowTimeLabel(row,material,provenance,now)).toBe('截至 2026.10.20 · 3天前');
  });
  it('honors per-row dates, explicit unknowns and owner confirmation without treating delivery as freshness',()=>{
    const dated={...row,timing:{as_of:{value:'2026-10-18',evidence:'25层单独标注'},confirmed:null}};
    expect(rowTimeLabel(dated,material,provenance,now)).toBe('截至 2026.10.18 · 5天前');
    expect(rowTimeLabel({...row,timing:{as_of:null,confirmed:null}},material,provenance,now)).toBe('时效未核实');
    expect(rowTimeLabel({...dated,timing:{...dated.timing,confirmed:{value:'2026-10-22T16:00:00Z',evidence:'业主逐项确认本行房源，原消息可追溯'}}},material,provenance,now)).toBe('确认 2026.10.23 · 今天');
  });
  it('does not hide a more recent row date behind an older confirmation',()=>{
    expect(rowTimeLabel({...row,timing:{as_of:{value:'2026-10-22',evidence:'行内日期'},confirmed:{value:'2026-10-18',evidence:'此前回访'}}},material,provenance,now)).toBe('截至 2026.10.22 · 1天前');
  });
  it('keeps unknown legacy dates unknown through re-parsing and never derives freshness from receipt/ingestion',()=>{
    const legacy=materialProvenance({created_at:material.created_at,source_sha256:'a'.repeat(64)});
    expect(rowTimeLabel(row,material,legacy,now)).toBe('时效未核实');
    expect(rowTimeLabel(row,{...material,document_date:null},provenance,now)).toBe('时效未核实');
    expect(rowTimeLabel(row,{...material,document_date:null},{...provenance,version_recorded_at:'2026-10-23T02:00:00Z'},now)).toBe('时效未核实');
  });
  it('keeps date precision and explicitly converts exact timestamps to Beijing time',()=>{
    expect(formatSourceTime('2026-10-22')).toBe('2026.10.22（仅日期）');
    expect(formatSourceTime('2026-10-22T16:30:15Z')).toBe('2026/10/23 00:30:15（北京时间）');
  });
});

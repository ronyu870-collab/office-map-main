import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeEvidenceSchema, materialMimeType, matchesMaterialSignature, materialImportSchema, shanghaiToday } from '../model';
const row={floor_unit:'6、7层连层',area_sqm:4996.77,orientation:'均有',delivery_time:'随时交付',delivery_condition:'遗留装修',asking_rent:350,rent_basis:'month',management_fee:33,price_note:'含税不含物业费',notes:''};
const manifest={schema_version:1,building_id:'749e53a6-9d2e-40f0-8d36-e42a6e6ad36d',building_name:'中建财富国际中心',title:'空置面积表',document_date:null,source:'中海商务',details:[row],extraction:{method:'codex-vision',source_sha256:'a'.repeat(64),reviewed:true,uncertainties:[]}};
afterEach(()=>vi.useRealTimers());
describe('Codex 销控解析数据契约',()=>{
  it('blocks a new batch until the user date is confirmed and preserves the independent printed date',()=>{
    const pending={...manifest,schema_version:2};
    expect(materialImportSchema.safeParse(pending).success).toBe(false);
    const source_timing={as_of:{value:'2026-10-13',evidence:'Hang Yu 本次答复10月13日'},received:null,document_date_evidence:'原件第7页2026.9.08更新'};
    const parsed=materialImportSchema.parse({...pending,document_date:'2026-09-08',source_timing,extraction:{...manifest.extraction,user_date_confirmed:true}});
    expect(parsed.document_date).toBe('2026-09-08');expect(parsed.source_timing?.as_of?.value).toBe('2026-10-13');
  });
  it('keeps conflicting areas and source-only quotes without inventing numeric values',()=>{
    const parsed=materialImportSchema.parse({...manifest,details:[{...row,area_sqm:null,area_text:'222.21 / 221.21',asking_rent:null,rent_basis:'unspecified',rent_unit:'unspecified',quote_text:'180+33'}]});
    expect(parsed.details[0]).toMatchObject({area_sqm:null,asking_rent:null,quote_text:'180+33'});
    expect(materialImportSchema.safeParse({...manifest,details:[{...row,area_sqm:null}]}).success).toBe(false);
  });
  it('preserves combined units, owner precision, original provenance and an unknown date',()=>{
    const parsed=materialImportSchema.parse(manifest);
    expect(parsed.document_date).toBeNull();expect(parsed.details[0]).toEqual(row);expect(parsed.extraction.method).toBe('codex-vision');
  });
  it('rejects unresolved recognition and an unreviewed extraction',()=>{
    expect(materialImportSchema.safeParse({...manifest,extraction:{...manifest.extraction,uncertainties:['报价无法辨认']}}).success).toBe(false);
    expect(materialImportSchema.safeParse({...manifest,extraction:{...manifest.extraction,reviewed:false}}).success).toBe(false);
  });
  it('requires the exact building identity and source hash',()=>{
    expect(materialImportSchema.safeParse({...manifest,building_id:'name-only'}).success).toBe(false);
    expect(materialImportSchema.safeParse({...manifest,extraction:{...manifest.extraction,source_sha256:'bad'}}).success).toBe(false);
  });
  it.each(['2026-02-30','2099-01-01','bad'])('rejects invalid owner date %s',document_date=>{
    expect(materialImportSchema.safeParse({...manifest,document_date}).success).toBe(false);
  });
  it('keeps Shanghai date boundaries',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T17:00:00Z'));
    expect(shanghaiToday()).toBe('2026-10-23');
    expect(materialImportSchema.safeParse({...manifest,document_date:'2026-10-23',source_timing:{document_date_evidence:'原图右上角日期',received:null}}).success).toBe(true);
  });
  it('requires date evidence and rejects invented, timezone-free or future event times',()=>{
    expect(materialImportSchema.safeParse({...manifest,document_date:'2026-01-01'}).success).toBe(false);
    for (const value of ['2026-02-30','2026-02-30T10:00:00+08:00','2099-01-01','2026-01-01T10:00:00','2026-01-01T24:00:00Z']) {
      expect(timeEvidenceSchema.safeParse({value,evidence:'业主微信原消息'}).success).toBe(false);
    }
    expect(timeEvidenceSchema.safeParse({value:'2026-01-01',evidence:''}).success).toBe(false);
    expect(timeEvidenceSchema.safeParse({value:'2026-01-01',evidence:'业主原件页眉'}).success).toBe(true);
    expect(timeEvidenceSchema.safeParse({value:'2026-01-01T10:30:00+08:00',evidence:'原始微信消息时间'}).success).toBe(true);
  });
  it('keeps unknown quotes null and zero fees distinct, refuses impossible data',()=>{
    expect(materialImportSchema.parse({...manifest,details:[{...row,asking_rent:null,management_fee:0}]}).details[0]).toMatchObject({asking_rent:null,management_fee:0});
    for(const patch of [{area_sqm:0},{asking_rent:-1},{management_fee:-1},{rent_basis:'year'}])expect(materialImportSchema.safeParse({...manifest,details:[{...row,...patch}]}).success).toBe(false);
    expect(materialImportSchema.safeParse({...manifest,details:[]}).success).toBe(false);
  });
  it('requires safe image/PDF types and true magic bytes',()=>{
    expect(materialMimeType('file.PNG','')).toBe('image/png');expect(materialMimeType('file.html','text/html')).toBeNull();expect(materialMimeType('file.svg','image/svg+xml')).toBeNull();
    expect(matchesMaterialSignature(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png')).toBe(true);
    expect(matchesMaterialSignature(new TextEncoder().encode('<html>'),'image/png')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { currentMaterials } from '../catalog';
import type { SalesMaterial } from '../model';
const make = (id:string, patch:Partial<SalesMaterial> = {}):SalesMaterial => ({id,title:id,document_date:null,source:'业主',notes:'',original_name:'owner.pdf',mime_type:'application/pdf',file_size:100,created_at:'2026-10-23T01:00:00Z',series_key:'standard',content_types:['availability'],...patch});
describe('多来源销控当前版本',()=>{
  it('uses the business date rather than the upload time to select a snapshot',()=>{
    const latest=make('new',{data_date:'2026-10-13'});
    const older=make('old',{data_date:'2026-09-08',created_at:'2026-10-23T02:00:00Z'});
    expect(currentMaterials([older,latest],'availability')).toEqual([latest]);
  });
  it('retains complementary inventories and keeps brochures separate',()=>{
    const standard=make('standard');const premium=make('premium',{series_key:'premium'});
    const brochure=make('brochure',{series_key:'brochure',content_types:['brochure']});
    const records=[standard,premium,brochure];
    expect(currentMaterials(records,'availability').map(item=>item.id).sort()).toEqual(['premium','standard']);
    expect(currentMaterials(records,'brochure')).toEqual([brochure]);
  });
  it('does not remove a commission policy when a later sheet only contains inventory',()=>{
    const policy=make('policy',{data_date:'2026-10-10',content_types:['availability','commission']});
    const inventory=make('inventory',{data_date:'2026-10-13'});
    expect(currentMaterials([policy,inventory],'availability')).toEqual([inventory]);
    expect(currentMaterials([policy,inventory],'commission')).toEqual([policy]);
  });
});

import{describe,it,expect}from'vitest';
import{materialBusinessCopy,materialVersionLabel}from'../presentation';
import type{SalesMaterial}from'../model';
describe('business wording preserves evidence meaning',()=>{
 it('retains conflicting numbers, date uncertainty, units and applicability',()=>{
  const input='系统快照building_floors=42、floors_above=38；原件966㎡与996㎡冲突，待核；2023年1月20日前；仅AB座。年份未注明，valid_until留空。';
  const out=materialBusinessCopy(input);expect(out).toContain('系统记录楼层=42、地上实际楼层=38');expect(out).toContain('966㎡与996㎡冲突，待核');expect(out).toContain('2023年1月20日前');expect(out).toContain('仅AB座');expect(out).toContain('有效截止日期未知');expect(out).not.toContain('valid_until');
 });
 it('does not invent dates and uniquely labels revisions with identical filenames',()=>{
  const a={id:'a',title:'历史参数',original_name:'相同.pdf',document_date:null}as SalesMaterial;const b={...a,id:'b'};
  expect(materialVersionLabel(a,[a,b])).toBe('相同.pdf · 资料日期未知 · 修订 1');expect(materialVersionLabel(b,[a,b])).toContain('修订 2');
 });
});

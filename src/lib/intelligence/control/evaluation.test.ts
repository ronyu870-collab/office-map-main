import { expect,it } from 'vitest';
import { registeredEvaluation } from './evaluation';
it('runs fixed production routing, formal calculations, follow-up, charts and real XLSX content without a model',async()=>{
  const result=await registeredEvaluation();
  expect(result.paidCalls).toBe(0);
  expect(result.results.filter(r=>r.state!=='offline_passed')).toEqual([]);
  expect(result.results.map(r=>r.name)).toEqual(expect.arrayContaining(['全部获权比较','Top10 Excel','多轮季度续问','图表数值与结果绑定','Excel 实际内容']));
});

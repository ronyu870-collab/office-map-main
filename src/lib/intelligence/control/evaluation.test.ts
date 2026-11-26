import { expect,it } from 'vitest';
import { registeredEvaluation } from './evaluation';
it('runs fixed production routing, formal calculations, follow-up, charts and real XLSX content without a model',async()=>{
  const result=await registeredEvaluation();
  expect(result.paidCalls).toBe(0);
  expect(result.results.filter(r=>r.state!=='offline_passed')).toEqual([]);
  expect(result.results.map(r=>r.name)).toEqual(expect.arrayContaining(['全部获权比较','Top10 Excel','多轮季度续问','图表数值与结果绑定','Excel 实际内容','两期样本表格优先','两期专业措辞与共同样本','两期坐标刻度与导出','回答完整性不将缺失当零','明确图表与表格偏好']));
});

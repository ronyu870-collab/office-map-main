import assert from 'node:assert/strict';
import { requiresDataFactEvidence } from '../../../../src/lib/intelligence/agent/queryObligation';
import { runAgentLoop } from '../../../../src/lib/intelligence/agent/agentOrchestrator';
const discussion=['请解释CBD写字楼租金的概念','我想讨论CBD楼宇报告的写作思路','什么是净有效租金','What is net effective rent'];
const facts=['CBD所有楼宇','CBD有哪些楼','CBD最高的楼是哪栋','2026Q3 CBD净有效租金是多少','解释CBD租金口径，并告诉我当前是多少','CBD写字楼数量是多少','CBD楼宇有几栋'];
async function main(){
const results=[];
for(const question of [...discussion,...facts]){
 let calls=0;
 const completion={provider:'deepseek' as const,model:'synthetic',inputTokens:10,outputTokens:5,message:{role:'assistant' as const,content:'离线脚本回答999'}};
 const result=await runAgentLoop({question,signal:new AbortController().signal,invoke:async()=>completion,
 runTool:async()=>{calls++;return {content:JSON.stringify({status:'requires_clarification',message:'请明确查询口径，未查询正式数据。'})}}});
 const isDiscussion=discussion.includes(question);
 const pass=isDiscussion? calls===0&&result.answer==='离线脚本回答999' : calls>0&&!result.answer.includes('999');
 results.push({question,requiresDataFactEvidence:requiresDataFactEvidence(question),calls,status:result.executionStatus,pass});
}
console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.pass));

}
void main();

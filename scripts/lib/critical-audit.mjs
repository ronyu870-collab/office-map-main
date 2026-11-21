import { randomUUID } from 'node:crypto';
/** CLI companion to withCriticalAudit: intent BEFORE side effects, no replay after
 * publication. A terminal outage leaves a durable ID for operator reconciliation. */
export async function criticalImport(client, payload, run) {
  const id=randomUUID();
  const receipt=await client.from('audit_operation_receipts').insert({id,actor_id:payload.actor_id,
    action_type:payload.action_type,target_table:payload.target_table,target_id:payload.target_id,module:'map',details:payload.details});
  if(receipt.error)throw new Error('关键导入凭据未保存，尚未开始入库');
  let result;
  try { result=await run(); }
  catch(error){
    try{await client.rpc('audit_complete_operation',{p_id:id,p_state:'failed',p_details:{stage:'import_failed'}});}catch{/* durable pending remains */}
    throw error;
  }
  let confirmed=false;
  try {const completion=await client.rpc('audit_complete_operation',{p_id:id,p_state:'success',p_details:{stage:'published'}});confirmed=!completion.error&&completion.data===true;}catch{/* never replay the import */}
  return {...result,operation_id:id,audit_pending:!confirmed};
}

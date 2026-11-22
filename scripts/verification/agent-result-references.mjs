import assert from 'node:assert/strict';

/** Match the intended query call, never the latest arbitrary tool output. */
export function observedResultReference(messages, toolName) {
  const ids = new Set(messages.filter(message => message.role === 'assistant')
    .flatMap(message => message.tool_calls ?? message.calls ?? []).filter(call => (call.function?.name ?? call.name) === toolName).map(call => call.id));
  const observations = messages.filter(message => message.role === 'tool' && ids.has(message.tool_call_id ?? message.callId));
  assert.equal(observations.length, 1, `expected one completed ${toolName} query`);
  const observed = JSON.parse(observations[0].content);
  assert.equal(observed.status, 'ready', `${toolName} must succeed before selecting its result`);
  assert.match(observed.resultId ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  return observed.resultId;
}

/** A 200/limited response is not a successful answer in these positive fixtures. */
export function assertSelectedAnswer(body, references) {
  assert.equal(body.status, 'ready', JSON.stringify(body));
  assert.equal(body.agent.executionStatus, 'completed', JSON.stringify(body.agent));
  assert.equal(body.answerSelection?.version, 'answer-selection/1');
  assert.equal(body.answerSelection.status, 'answered');
  assert.equal(body.answerSelection.primaryResultId, references[0].resultId);
  assert.deepEqual(body.answerSelection.results.map(item => ({ role: item.role, resultId: item.result.resultId })), references);
  assert.deepEqual(body.result, body.answerSelection.results[0].result);
  for (const item of body.answerSelection.results) {
    assert.ok(Array.isArray(item.result.table.rows));
    assert.ok(Array.isArray(item.result.sources));
  }
}

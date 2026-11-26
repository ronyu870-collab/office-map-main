import { describe, expect, it } from 'vitest';
import { observedResultReference, assertSelectedAnswer } from './agent-result-references.mjs';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const result = (resultId: string) => ({ resultId, table: { rows: [] }, sources: [] });
const query = { id: 'q', type: 'function', function: { name: 'query_report_market', arguments: '{}' } };
const messages = (status = 'ready') => [
  { role: 'assistant', content: null, tool_calls: [query, { id: 'check', type: 'function', function: { name: 'check_data_coverage', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'q', content: JSON.stringify({ status, resultId: a }) },
  { role: 'tool', tool_call_id: 'check', content: JSON.stringify({ status: 'ready', resultId: b }) },
];
describe('real Auth scripted planner result references', () => {
  it('binds the intended query instead of a later coverage observation', () => {
    expect(observedResultReference(messages(), 'query_report_market')).toBe(a);
  });
  it.each(['error', 'requires_clarification'])('refuses to turn a %s observation into a chosen result', status => {
    expect(() => observedResultReference(messages(status), 'query_report_market')).toThrow();
  });
  it('rejects missing or ambiguous query observations', () => {
    expect(() => observedResultReference(messages(), 'list_buildings')).toThrow();
    const values = messages();
    expect(() => observedResultReference([...values, values[1]], 'query_report_market')).toThrow();
  });
  it('requires ready, completed and the exact primary/supporting snapshots', () => {
    const primary = result(a), auxiliary = result(b);
    const references = [{ role: 'primary', resultId: a }, { role: 'supporting', resultId: b }];
    const body = { status: 'ready', agent: { executionStatus: 'completed' }, result: primary,
      answerSelection: { version: 'answer-selection/1', status: 'answered', primaryResultId: a,
        results: [{ role: 'primary', result: primary }, { role: 'supporting', result: auxiliary }] } };
    expect(() => assertSelectedAnswer(body, references)).not.toThrow();
    expect(() => assertSelectedAnswer({ ...body, status: 'assistant', agent: { executionStatus: 'limited' }, result: undefined }, references)).toThrow();
    expect(() => assertSelectedAnswer({ ...body, result: auxiliary }, references)).toThrow();
    expect(() => assertSelectedAnswer(body, [...references].reverse())).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from './modelProvider';
import { parseAgentToolArguments, REGISTERED_AGENT_TOOL_NAMES,
  STRUCTURED_DATA_SCHEMAS, WORKSET_TOOL_SCHEMAS } from './toolRegistry';
import { randomUUID } from 'node:crypto';

describe('AI 5.0 structured native tool protocol', () => {
  it('accepts empty and legacy capability requests with one advertised optional contract', () => {
    const advertised = AGENT_TOOLS.find(tool => tool.function.name === 'get_data_capabilities')!;
    expect(advertised.function.parameters.required).toEqual([]);
    expect(parseAgentToolArguments('get_data_capabilities', {})).toEqual({});
    expect(parseAgentToolArguments('get_data_capabilities', { question: '当前数据权限' }))
      .toEqual({ question: '当前数据权限' });
    for (const value of [{ question: '' }, { question: 1 }, { role: 'admin' }, { sql: 'select 1' }])
      expect(() => parseAgentToolArguments('get_data_capabilities', value)).toThrow();
  });

  it('advertises distinct parameter contracts rather than free-text aliases', () => {
    const toolNames = AGENT_TOOLS.map(tool => tool.function.name);
    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(toolNames).toContain('rank_buildings');
    expect(toolNames).toContain('read_result_page');
    expect(toolNames).toContain('check_data_coverage');
    for (const name of Object.keys(STRUCTURED_DATA_SCHEMAS)) {
      const exposed = AGENT_TOOLS.find(tool => tool.function.name === name);
      expect(exposed).toBeDefined();
      expect(exposed?.function.parameters.properties).not.toHaveProperty('question');
      expect(REGISTERED_AGENT_TOOL_NAMES.has(name)).toBe(true);
    }
    for (const name of Object.keys(WORKSET_TOOL_SCHEMAS)) {
      const exposed = AGENT_TOOLS.find(tool => tool.function.name === name);
      expect(exposed?.function.parameters.properties).toHaveProperty(
        name === 'select_answer_results' ? 'primaryResultId' : ['compare_result_sets', 'export_table', 'generate_pdf_report'].includes(name) ? 'resultIds' : 'resultId');
    }
  });

  it('parses only bounded structured market, time, metric and server-issued reference slots', () => {
    const scope = { inventory: 'tracked', submarkets: ['CBD'] };
    const args = { scope, period: { year: 2026, quarter: 2 }, metric: 'rent' };
    expect(parseAgentToolArguments('query_quarterly_metrics', args)).toEqual(args);
    const ref = randomUUID();
    expect(parseAgentToolArguments('read_result_page', { resultId: ref }))
      .toEqual({ resultId: ref, offset: 0, limit: 30 });
    expect(parseAgentToolArguments('rank_buildings', {
      scope, field: 'height', direction: 'desc', limit: 5,
    })).toMatchObject({ field: 'height', limit: 5 });
    for (const input of [
      { ...args, table: 'lease_transactions' },
      { ...args, metric: 'contractRent' },
      { ...args, period: { year: 2026, quarter: 5 } },
      { ...args, scope: { ...scope, sql: 'select * from users' } },
    ]) expect(() => parseAgentToolArguments('query_quarterly_metrics', input)).toThrow();
    expect(() => parseAgentToolArguments('read_result_page', { resultId: randomUUID(),
      sort: { field: 'name', direction: 'up' } })).toThrow();
    expect(() => parseAgentToolArguments('read_result_page', { resultId: randomUUID(),
      filter: { field: 'name', operator: 'eq', value: 'x', rawSql: 'DROP TABLE' } })).toThrow();
  });

  it('accepts an old question only in a deprecated adapter and cannot invoke unknown code', () => {
    expect(parseAgentToolArguments('query_verified_real_estate', { question: '查询CBD最新数据' }))
      .toEqual({ question: '查询CBD最新数据' });
    expect(parseAgentToolArguments('compare_market_segments', { question: '查CBD与金融街' }))
      .toEqual({ question: '查CBD与金融街' });
    expect(() => parseAgentToolArguments('execute_sql', { question: 'SELECT * FROM auth.users' }))
      .toThrow('AGENT_UNREGISTERED_TOOL');
    expect(() => parseAgentToolArguments('query_quarterly_metrics', { question: '查CBD', raw: 'extra' }))
      .toThrow();
  });
});

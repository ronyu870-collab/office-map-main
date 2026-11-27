// Real GoTrue, current grants, deterministic tools, owner-bound encrypted audit
// and HTTP. Only official supplier HTTP responses are synthetic; no live keys.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { rolldown } from 'rolldown';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';

const PRIVATE_THINKING = 'fixture-private-thinking-marker';

async function observeAgentStream(response, started, onEvent) {
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events = [];
  let buffer = '', body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body += value;
      buffer += value;
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const [name, data] = buffer.slice(0, end).split('\n');
        const parsed = JSON.parse(data.slice('data: '.length));
        assert.equal(name, 'event: ' + parsed.type);
        const observed = { event: parsed, ms: performance.now() - started };
        events.push(observed);
        onEvent?.(observed.event);
        buffer = buffer.slice(end + 2);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  assert.equal(buffer, '');
  return { body, streamEvents: events, durationMs: performance.now() - started };
}

export async function verifyAi5ModelOperations({ db, service, keys, output, check, person, recover, events, decrypt, buildingIds }) {
  const handle = await loadAgentHandler(output), root = process.cwd();
  const file = path.join(output, 'agent-model-stream.cjs');
  const bundle = await rolldown({ input: path.join(root, 'src/lib/intelligence/agent/agentStreamHttp.ts'), platform: 'node',
    resolve: { alias: { '@': root } }, external: ['next', 'next/server', 'next/headers', '@supabase/supabase-js', '@resvg/resvg-js', 'pdf-lib', '@pdf-lib/fontkit', 'pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', 'docx', 'pptxgenjs', 'openai'] });
  try { await bundle.write({ file, format: 'cjs', codeSplitting: false }); } finally { await bundle.close(); }
  const { handleAgentStream } = createRequire(import.meta.url)(file);
  const originalFetch = globalThis.fetch, previous = new Map();
  const env = values => { for (const [key, value] of Object.entries(values)) { if (!previous.has(key)) previous.set(key, process.env[key]); process.env[key] = value; } };
  env({ DEEPSEEK_API_KEY: 'synthetic-ds', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_CHAT_MODEL: 'deepseek-flash', DEEPSEEK_API_BASE_URL: 'https://api.deepseek.com',
    OPENAI_API_KEY: 'synthetic-openai', OPENAI_AGENT_MODEL: 'gpt-4.1-mini', AI_OPENAI_ENABLED: 'true', AI_PROVIDER_QUICK: 'deepseek', AI_PROVIDER_PROFESSIONAL: 'deepseek',
    AI_MODEL_FALLBACK_ENABLED: 'false', OPENAI_AGENT_INPUT_USD_PER_MILLION: '.5', OPENAI_AGENT_OUTPUT_USD_PER_MILLION: '2',
    AI_AGENT_MAX_TOKENS: '60000', AI_AGENT_MAX_ESTIMATED_USD: '.25', AI_AGENT_PROVIDER_TIMEOUT_MS: '1000' });
  let scenario = {}, requests = [], activeController;
  const neutralCall = () => ({ id: randomUUID(), name: 'list_buildings', arguments: JSON.stringify({ scope: { inventory: 'tracked', submarkets: ['CBD'], buildingIds }, fields: ['height'], period: null }) });
  const sse = values => new Response(values.map(v => `data: ${JSON.stringify(v)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  globalThis.fetch = async (url, init) => {
    const host = new URL(String(url)).hostname;
    if (!['api.openai.com', 'api.deepseek.com'].includes(host)) return originalFetch(url, init);
    const provider = host === 'api.openai.com' ? 'openai' : 'deepseek', body = JSON.parse(init.body);
    requests.push({ provider, body });
    if (requests.length === 1) await scenario.beforeFirstResponse?.(init.signal);
    // Fail if a provider ever sees the synthetic sensitive source sentinel.
    assert.ok(!JSON.stringify(body).includes('合成保密客户_禁止模型日志'));
    if (scenario.revoke) { await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [scenario.revoke]); return Response.json({}, { status: 429 }); }
    if (scenario.cancel) { activeController.abort(); init.signal.throwIfAborted(); }
    if (scenario.failure && provider === 'deepseek') {
      const code = ({ 402: 'insufficient_balance', 403: 'invalid_api_key', 429: 'rate_limit_exceeded' })[scenario.failure] ?? 'server_error';
      return Response.json({ error: { code, message: 'private supplier error' } }, { status: scenario.failure });
    }
    const hasTool = provider === 'openai' ? body.input.some(i => i.type === 'function_call_output') : body.messages.some(m => m.role === 'tool');
    const call = scenario.query && !hasTool ? neutralCall() : null;
    if (provider === 'openai') {
      const response = { id: 'resp_synthetic', object: 'response', model: body.model, status: 'completed',
        output: call ? [{ type: 'function_call', id: 'fc_synthetic', call_id: call.id, status: 'completed', name: call.name, arguments: call.arguments }]
          : [{ type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '合成回复', annotations: [] }] }],
        usage: { input_tokens: 120, output_tokens: 40 } };
      assert.equal(body.store, false); assert.ok(body.tools.every(t => t.type === 'function'));
      return body.stream ? sse([{ type: 'response.output_text.delta', delta: '合成回复', sequence_number: 1 }, ...(scenario.truncated ? [] : [{ type: 'response.completed', response, sequence_number: 2 }])]) : Response.json(response);
    }
    const thinking = body.thinking.type === 'enabled';
    const usage = { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 20,
      ...(thinking ? { completion_tokens_details: { reasoning_tokens: 25 } } : {}) };
    const response = { id: 'chat_synthetic', model: body.model };
    if (body.stream) {
      assert.deepEqual(body.stream_options, { include_usage: true });
      const frame = (delta, finish_reason = null) => ({ ...response, choices: [{ index: 0, delta, finish_reason }] });
      const frames = thinking ? [frame({ reasoning_content: PRIVATE_THINKING })] : [];
      if (call) {
        const half = Math.floor(call.arguments.length / 2);
        frames.push(frame({ tool_calls: [{ index: 0, id: call.id, type: 'function',
          function: { name: call.name, arguments: call.arguments.slice(0, half) } }] }),
        frame({ tool_calls: [{ index: 0, function: { arguments: call.arguments.slice(half) } }] }));
      } else {
        frames.push(frame({ content: '合成' }), frame({ content: '回复' }));
      }
      return sse([...frames, frame({}, call ? 'tool_calls' : 'stop'), { ...response, choices: [], usage }]);
    }
    const message = { role: 'assistant', content: call ? null : '合成回复', ...(call ? { tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] } : {}),
      ...(thinking ? { reasoning_content: PRIVATE_THINKING } : {}) };
    return Response.json({ ...response, choices: [{ message, finish_reason: call ? 'tool_calls' : 'stop' }], usage });
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      activeController = new AbortController();
      const request = new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks), signal: activeController.signal });
      const response = req.url.endsWith('/stream') ? handleAgentStream(request, { client: service, keys, enabled: true }) : await handle(request, { client: service, keys, enabled: true });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
    } catch {
      if (res.headersSent) res.destroy();
      else { res.writeHead(500); res.end('isolated scenario failed'); }
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const endpoint = 'http://127.0.0.1:' + server.address().port;
  async function actor(label) {
    const who = await person('admin', 'ai5-model-' + label);
    await grantQuery({ setup: db }, who.id, { capabilities: ['query:catalog', 'query:brochure'], fields: ['height'], buildingIds, allBuildings: false });
    env({ AI_OPENAI_ACTOR_IDS: who.id }); return who;
  }
  async function submit(who, options = {}) {
    scenario = options; requests = [];
    const input = options.input ?? { idempotencyKey: randomUUID(), question: options.query ? '核对CBD楼宇清单和高度资料' : '解释风险的含义', conversation: options.conversation ?? { id: randomUUID() } };
    const started = performance.now();
    const response = await originalFetch(endpoint + (options.stream ? '/agent/stream' : '/agent'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, body: JSON.stringify(input) });
    const received = options.stream ? await observeAgentStream(response, started, options.onStreamEvent) : { body: await response.json() };
    return { status: response.status, ...received, input, calls: [...requests] };
  }
  const attempts = async id => (await events(id)).filter(e => e.kind === 'accounting').map(decrypt).map(e => e.content).filter(c => c.protocol === 'agent-model-attempt/1');
  let owner, prior, expectedListing;
  try {
    await check('AI5模型运营 / DeepSeek与OpenAI官方协议通过相同真实授权工具且逐调用审计', async () => {
      owner = await actor('owner'); const ds = await submit(owner, { query: true });
      assert.equal(ds.status, 200, JSON.stringify(ds.body)); assert.equal(ds.body.agent.operations.providers[0], 'deepseek');
      expectedListing = ds.body.result.table;
      env({ AI_PROVIDER_PROFESSIONAL: 'openai' }); prior = await submit(owner, { query: true });
      assert.equal(prior.status, 200, JSON.stringify(prior.body)); assert.deepEqual(prior.body.result.table, ds.body.result.table);
      const records = await attempts(prior.body.requestId); assert.equal(records.length, 2); assert.ok(records.every(r => r.provider === 'openai' && r.billing.actualUsd === null && r.providerRequestId === 'resp_synthetic'));
      assert.ok(prior.calls[1].body.input.some(i => i.type === 'function_call_output'));
    });
    await check('AI5模型运营 / 幂等复用不重复付费，历史摘要与跨账号引用受控', async () => {
      const duplicate = await submit(owner, { input: prior.input, query: true }); assert.equal(duplicate.status, 202, JSON.stringify(duplicate.body)); assert.equal(duplicate.calls.length, 0);
      assert.equal((await recover(owner, prior.body.requestId)).status, 200);
      const next = await submit(owner, { conversation: { id: prior.input.conversation.id, parentRequestId: prior.body.requestId } });
      assert.equal(next.status, 200, JSON.stringify(next.body)); const answer = (await events(next.body.requestId)).filter(e => e.kind === 'tool_finished').map(decrypt).find(e => e.content.protocol === 'agent-answer/1').content;
      assert.equal(answer.memory.turns, 2); assert.equal(answer.memory.results[0].resultId, prior.body.result.resultId);
      const other = await actor('other'); const denied = await submit(other, { conversation: { id: prior.input.conversation.id, parentRequestId: prior.body.requestId } });
      assert.equal(denied.calls.length, 0); assert.ok([403, 503].includes(denied.status)); assert.equal((await recover(other, prior.body.requestId)).status, 403);
    });
    await check('AI6模型运营 / 上游故障可按授权回退，限流、配额及鉴权拒绝不切换供应商', async () => {
      const who = await actor('fallback'); env({ AI_PROVIDER_QUICK: 'deepseek', AI_MODEL_FALLBACK_ENABLED: 'true' });
      const reply = await submit(who, { failure: 503 }); assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.calls.map(c => c.provider), ['deepseek', 'openai']); const records = await attempts(reply.body.requestId);
      assert.equal(records[0].usageStatus, 'unknown_reserved'); assert.equal(records[1].fallback, true);
      for (const [failure, errorCode] of [[429, 'rate_limited'], [402, 'payment_required'], [403, 'unauthorized']]) {
        const denied = await submit(who, { failure });
        assert.equal(denied.status, 503, JSON.stringify(denied.body));
        assert.deepEqual(denied.calls.map(c => c.provider), ['deepseek']);
        const recorded = await attempts(denied.body.requestId);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0].errorCode, errorCode);
        assert.equal(recorded[0].usageStatus, 'unknown_reserved');
        assert.equal(recorded[0].fallback, false);
      }
      env({ DEEPSEEK_API_KEY: '' }); const missing = await submit(who); assert.equal(missing.status, 200, JSON.stringify(missing.body)); assert.deepEqual(missing.calls.map(c => c.provider), ['openai']);
      assert.equal((await attempts(missing.body.requestId))[0].usageStatus, 'not_sent'); env({ DEEPSEEK_API_KEY: 'synthetic-ds' });
    });
    await check('AI6模型运营 / 真实 Auth 后比较三档的流式状态、输出、原生工具续接及账本', async () => {
      const who = await actor('thinking');
      const routed = { AI_PROVIDER_QUICK: 'deepseek', AI_PROVIDER_PROFESSIONAL: 'deepseek', AI_PROVIDER_DEEP: 'deepseek',
        DEEPSEEK_CHAT_MODEL_QUICK: 'deepseek-flash', DEEPSEEK_CHAT_MODEL_PROFESSIONAL: 'deepseek-flash',
        DEEPSEEK_CHAT_MODEL_DEEP: 'deepseek-v4-pro', AI_MODEL_FALLBACK_ENABLED: 'false' };
      const before = Object.entries(routed).map(([name]) => [name, process.env[name]]);
      env(routed);
      try {
        for (const [mode, model, effort] of [['quick', 'deepseek-flash', undefined], ['professional', 'deepseek-flash', 'low'], ['deep', 'deepseek-v4-pro', 'high']]) {
          const reply = await submit(who, { input: { idempotencyKey: randomUUID(), question: '解释风险的含义', conversation: { id: randomUUID() }, mode } });
          assert.equal(reply.status, 200, JSON.stringify(reply.body));
          assert.equal(reply.calls.length, 1);
          assert.equal(reply.calls[0].provider, 'deepseek');
          assert.equal(reply.calls[0].body.model, model);
          assert.deepEqual(reply.calls[0].body.thinking, { type: effort ? 'enabled' : 'disabled' });
          assert.equal(reply.calls[0].body.reasoning_effort, effort);
          const records = await attempts(reply.body.requestId);
          assert.equal(records.length, 1);
          assert.equal(records[0].reasoningEffort, effort ?? null);

          for (const query of [false, true]) {
            const gate = new EventEmitter();
            let receivedStart = false;
            const question = query ? '核对CBD楼宇清单和高度资料' : '解释风险的含义';
            const stream = await submit(who, { stream: true, query,
              input: { idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() }, mode },
              beforeFirstResponse: signal => receivedStart ? undefined : once(gate, 'started', { signal }),
              onStreamEvent: event => {
                if (event.type === 'run_started') { receivedStart = true; gate.emit('started'); }
              } });
            assert.equal(stream.status, 200);
            const start = stream.streamEvents[0], terminal = stream.streamEvents.at(-1);
            const eventTypes = stream.streamEvents.map(row => row.event.type);
            assert.equal(start?.event.type, 'run_started');
            assert.equal(terminal?.event.type, 'run_completed', stream.body);
            assert.equal(eventTypes.filter(type => type === 'run_completed' || type === 'run_failed').length, 1);
            assert.equal(terminal.event.reply.requestId, start.event.requestId);
            assert.equal(terminal.event.receipt.bodySha256,
              createHash('sha256').update(JSON.stringify(terminal.event.reply)).digest('hex'));
            assert.ok(terminal.event.receipt.deliveryToken);
            assert.ok(!stream.body.includes(PRIVATE_THINKING));
            const answer = terminal.event.reply;
            const first = stream.streamEvents.find(row => row.event.type === (query ? 'run_completed' : 'message_delta'));
            assert.ok(first && start.ms <= first.ms && first.ms <= stream.durationMs);
            assert.equal(stream.calls.length, query ? 2 : 1);
            for (const request of stream.calls) {
              assert.equal(request.provider, 'deepseek');
              assert.equal(request.body.model, model);
              assert.equal(request.body.stream, true);
              assert.equal(request.body.reasoning_effort, effort);
              assert.deepEqual(request.body.thinking, { type: effort ? 'enabled' : 'disabled' });
            }
            if (query) {
              assert.deepEqual(answer.result.table, expectedListing);
              assert.ok(eventTypes.includes('tool_completed'));
              assert.ok(!eventTypes.includes('message_delta'));
              const continuation = stream.calls[1].body.messages;
              const tool = continuation.find(message => message.role === 'tool');
              const assistant = continuation.find(message => message.tool_calls?.some(call => call.id === tool?.tool_call_id));
              assert.ok(tool && assistant);
              assert.equal(assistant.reasoning_content, effort ? PRIVATE_THINKING : undefined);
            } else {
              assert.equal(first.event.delta, '合成回复');
              assert.equal(answer.message, '合成回复');
            }
            const audit = (await events(answer.requestId)).map(decrypt);
            assert.ok(!JSON.stringify(audit).includes(PRIVATE_THINKING));
            const usage = audit.map(event => event.content).filter(content => content.protocol === 'agent-model-attempt/1');
            assert.equal(usage.length, stream.calls.length);
            assert.ok(usage.every(record => record.usageStatus === 'provider_reported' && record.model === model
              && record.reasoningEffort === (effort ?? null) && record.inputTokens === 120 && record.outputTokens === 40
              && record.cachedInputTokens === 20 && record.reasoningTokens === (effort ? 25 : null)
              && record.billing.actualUsd === null && record.estimateUsd > 0));
            const rounded = ms => Math.round(ms);
            console.log('AI6_STREAM_SAMPLE ' + JSON.stringify({ environment: 'isolated-auth-synthetic-provider',
              example: query ? 'tool' : 'concept', mode, model, firstStatusMs: rounded(start.ms),
              firstUsableMs: rounded(first.ms), durationMs: rounded(stream.durationMs), responseBytes: Buffer.byteLength(stream.body),
              supplierCalls: stream.calls.length, toolCalls: answer.agent.toolCalls, modelMs: usage.map(record => record.durationMs),
              estimatedUsd: usage.reduce((total, record) => total + record.estimateUsd, 0) }));
          }
        }
      } finally {
        for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      }
    });
    await check('AI5模型运营 / 真实HTTP流有可信完成凭据，流中断无完成事件与混合输出', async () => {
      const who = await actor('stream'); env({ AI_PROVIDER_QUICK: 'openai', AI_MODEL_FALLBACK_ENABLED: 'false' });
      const greeting = await submit(who, { stream: true, input: { idempotencyKey: randomUUID(), question: '你好', conversation: { id: randomUUID() } } });
      assert.match(greeting.body, /event: run_completed/); assert.doesNotMatch(greeting.body, /event: message_delta/); assert.equal(greeting.calls.length, 0);
      const explanation = { idempotencyKey: randomUUID(), question: '解释空置率的含义。', conversation: { id: randomUUID() } };
      const stream = await submit(who, { stream: true, input: explanation }); assert.match(stream.body, /event: run_completed/); assert.match(stream.body, /deliveryToken/); assert.match(stream.body, /event: message_delta/);
      const truncated = await submit(who, { stream: true, truncated: true, input: { ...explanation, idempotencyKey: randomUUID() } }); assert.match(truncated.body, /event: run_failed/); assert.doesNotMatch(truncated.body, /event: run_completed|event: message_delta/);
    });
    await check('AI5模型运营 / token与估算费用上限在付费前拒绝，取消和撤权不回退', async () => {
      const who = await actor('limits'); env({ AI_AGENT_MAX_TOKENS: '1000' }); const tokens = await submit(who); assert.equal(tokens.status, 503); assert.equal(tokens.calls.length, 0);
      env({ AI_AGENT_MAX_TOKENS: '60000', AI_AGENT_MAX_ESTIMATED_USD: '.000001' }); const money = await submit(who); assert.equal(money.status, 503); assert.equal(money.calls.length, 0);
      env({ AI_AGENT_MAX_ESTIMATED_USD: '.25', AI_PROVIDER_QUICK: 'deepseek', AI_MODEL_FALLBACK_ENABLED: 'true' });
      const cancelled = await submit(who, { cancel: true }); assert.ok([409, 503].includes(cancelled.status)); assert.deepEqual(cancelled.calls.map(c => c.provider), ['deepseek']);
      const revoked = await submit(who, { revoke: who.id }); assert.equal(revoked.status, 403); assert.deepEqual(revoked.calls.map(c => c.provider), ['deepseek']);
      assert.equal(revoked.body.result, undefined); assert.equal((await recover(who, cancelled.body.requestId)).status, 403);
    });
    await check('AI5模型运营 / 历史权限撤销后摘要不能恢复业务数据或再次调用供应商', async () => {
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.id]);
      const denied = await submit(owner, { conversation: { id: prior.input.conversation.id, parentRequestId: prior.body.requestId } });
      assert.equal(denied.status, 403); assert.equal(denied.calls.length, 0); assert.equal((await recover(owner, prior.body.requestId)).status, 403);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await new Promise(resolve => server.close(resolve));
  }
}

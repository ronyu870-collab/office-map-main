import { expect, it } from 'vitest';
import { summarizeLongTasks, sanitizeCpuProfile, sanitizeMainThreadTrace } from './fixtures/long-task-profile.mjs';

const secret = 'a'.repeat(32);
const frame = (functionName, url = '') => ({ functionName, url, lineNumber: 9 });
const profile = {
  startTime: 1e6,
  nodes: [
    { id: 1, callFrame: frame('(root)'), children: [2, 4] },
    { id: 2, callFrame: frame('glyph', `https://webapi.amap.com/maps?v=2&key=${secret}`), children: [3] },
    { id: 3, callFrame: frame('getImageData') },
    { id: 4, callFrame: frame('restore', `http://localhost:3211/_next/static/app.js?token=${secret}`) },
  ],
  samples: [3, 4, 1, 1], timeDeltas: [0, 60000, 40000, 10000],
};

it('aligns task-relative time with monotonic CPU samples, clips overlap and strips URL queries', () => {
  const result = summarizeLongTasks({
    tasks: [{ startTime: 20, duration: 65 }], navigationStart: 1,
    origin: 'http://localhost:3211', profile,
    trace: [
      { name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } },
      { name: 'FireAnimationFrame', pid: 1, tid: 2, ts: 1020000, dur: 65000, ph: 'X' },
      { name: 'BackgroundGC', pid: 1, tid: 3, ts: 1020000, dur: 90000, ph: 'X' },
      { name: 'Unrelated', pid: 1, tid: 2, ts: 1100000, dur: 65000, ph: 'X' },
    ],
  });
  expect(result[0].topStacks.map(item => item.cpuMs)).toEqual([40, 25]);
  expect(result[0].topStacks[0].stack[0].function).toBe('getImageData');
  expect(result[0].topStacks[0].stack[1].source).toBe('amap:webapi.amap.com/maps');
  expect(result[0].topStacks[1].stack[0].source).toBe('application:/_next/static/app.js');
  expect(result[0].trace).toEqual([{ name: 'FireAnimationFrame', durationMs: 65, offsetMs: 0 }]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('?');
});

it('omits uncalibrated timeline threads and handles absent CPU samples', () => {
  expect(summarizeLongTasks({ tasks: [{ startTime: 0, duration: 65 }], navigationStart: 1,
    origin: 'http://localhost:3211', profile: { startTime: 1e6, nodes: [] },
    trace: [{ name: 'GC', ts: 1e6, dur: 65000, ph: 'X' }],
  })).toEqual([{ startTime: 0, duration: 65, topStacks: [], trace: [] }]);
});

it('retains the complete caller chain beyond forty frames', () => {
  const deep = { startTime: 1e6, endTime: 1065000, nodes: Array.from({ length: 60 }, (_, index) => ({
    id: index + 1, callFrame: frame(`caller${index}`), children: index < 59 ? [index + 2] : [],
  })), samples: [60], timeDeltas: [0] };
  const result = summarizeLongTasks({ tasks: [{ startTime: 0, duration: 65 }], navigationStart: 1,
    origin: 'http://localhost:3211', profile: deep, trace: [] });
  expect(result[0].topStacks[0].stack).toHaveLength(60);
  expect(result[0].topStacks[0].stack.at(-1).function).toBe('caller0');
});

it('sorts out-of-order Chrome samples without double-counting negative deltas', () => {
  const result = summarizeLongTasks({ tasks: [{ startTime: 0, duration: 65 }], navigationStart: 1,
    origin: 'http://localhost:3211', trace: [],
    profile: { ...profile, samples: [3, 4, 3, 1], timeDeltas: [0, 40000, -10000, 35000] },
  });
  expect(result[0].topStacks.map(item => item.cpuMs)).toEqual([40, 25]);
  expect(result[0].topStacks[0].stack[0].function).toBe('getImageData');
  expect(result[0].topStacks.reduce((sum, item) => sum + item.cpuMs, 0)).toBe(65);
});

it('exports a complete Chrome CPU profile without URL credentials or extra payloads', () => {
  const input = structuredClone(profile);
  input.nodes[1].callFrame.url = `https://user:${secret}@webapi.amap.com/maps?key=${secret}#${secret}`;
  input.nodes[1].deoptReason = secret;
  input.nodes[1].positionTicks = [{ line: 10, ticks: 5, private: secret }];
  const result = sanitizeCpuProfile(input);
  expect(result.samples).toEqual(profile.samples);
  expect(result.timeDeltas).toEqual(profile.timeDeltas);
  expect(result.nodes.map(node => [node.id, node.children])).toEqual(profile.nodes.map(node => [node.id, node.children]));
  expect(result.nodes[1].callFrame.url).toBe('https://webapi.amap.com/maps');
  expect(result.nodes[1].positionTicks).toEqual([{ line: 10, ticks: 5 }]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(input.nodes[1].callFrame.url).toContain(secret);
});

it('exports all renderer main events without serializing arbitrary trace arguments', () => {
  const result = sanitizeMainThreadTrace([
    { name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } },
    { name: 'FunctionCall', cat: 'devtools.timeline', pid: 1, tid: 2, ts: 100, dur: 500, ph: 'X', args: { data: { url: secret } } },
    { name: 'GC', pid: 1, tid: 3, ts: 100, dur: 1000, ph: 'X' },
  ]);
  expect(result).toEqual([
    { name: 'thread_name', ph: 'M', pid: 1, tid: 2, ts: 0, args: { name: 'CrRendererMain' } },
    { name: 'FunctionCall', cat: 'devtools.timeline', pid: 1, tid: 2, ts: 100, dur: 500, ph: 'X' },
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
});

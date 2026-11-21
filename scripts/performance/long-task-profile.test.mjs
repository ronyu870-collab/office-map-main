import { expect, it } from 'vitest';
import { summarizeLongTasks } from './fixtures/long-task-profile.mjs';

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
  samples: [1, 3, 4, 1], timeDeltas: [0, 60000, 40000, 10000],
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

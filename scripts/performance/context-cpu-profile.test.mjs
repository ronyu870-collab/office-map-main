import { expect, it } from 'vitest';
import { cpuProfilesFromTrace, scopeContextTasks } from './fixtures/context-cpu-profile.mjs';
import { sanitizeCpuProfile, summarizeLongTasks } from './fixtures/long-task-profile.mjs';

const start = { name: 'Profile', pid: 1, tid: 2, id: 'same-id', ts: 1000, args: { data: { startTime: 1000 } } };
const chunk = (ts, data, pid = 1) => ({ name: 'ProfileChunk', pid, tid: 99, id: 'same-id', ts, args: { data } });
const events = [
  { name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } }, start,
  chunk(3, { cpuProfile: { nodes: [{ id: 3, parent: 2, callFrame: { functionName: 'parseStyle', url: 'https://webapi.amap.com/maps?key=private' } }], samples: [3, 3] }, timeDeltas: [-1000, 3000] }),
  chunk(2, { cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: '(root)' } }, { id: 2, parent: 1, callFrame: { functionName: 'callback' } }], samples: [2] }, timeDeltas: [2000] }),
  chunk(2, { cpuProfile: { samples: [999] }, timeDeltas: [99999] }, 5),
  { ...start, tid: 9 }, // Worker profiles are not renderer-main profiles.
];

it('joins profiler-thread chunks by process and id, orders chunks and rebuilds complete callers', () => {
  const [profile] = cpuProfilesFromTrace(events);
  expect(cpuProfilesFromTrace(events)).toHaveLength(1);
  expect(profile.samples).toEqual([2, 3, 3]);
  expect(profile.timeDeltas).toEqual([2000, -1000, 3000]);
  expect(profile.endTime).toBe(5000);
  const [task] = summarizeLongTasks({ tasks: [{ startTime: 0, duration: 4 }], profile, trace: events, navigationStart: .001, origin: 'http://localhost' });
  expect(task.topStacks.find(item => item.stack[0].function === 'parseStyle').stack.map(frame => frame.function)).toEqual(['parseStyle', 'callback', '(root)']);
  expect(JSON.stringify(sanitizeCpuProfile(profile))).not.toContain('private');
});

it('fails visibly for missing samples, parents or timestamps instead of reporting zero work', () => {
  const invalid = cpuProfile => [events[0], start, chunk(2, { cpuProfile, timeDeltas: [1000] })];
  expect(() => cpuProfilesFromTrace(invalid({ nodes: [], samples: [2] }))).toThrow('Incomplete');
  expect(() => cpuProfilesFromTrace(invalid({ nodes: [{ id: 2, parent: 7, callFrame: {} }], samples: [2] }))).toThrow('parents');
  expect(() => cpuProfilesFromTrace([events[0], start])).toThrow('Incomplete');
});

it('retains startup and between-action tasks and records tasks that overlap action boundaries', () => {
  expect(scopeContextTasks([{ startTime: 0, duration: 55 }, { startTime: 150, duration: 60 }, { startTime: 250, duration: 60 }],
    [{ name: 'return', startTime: 50, endTime: 100 }, { name: 'close', startTime: 200, endTime: 220 }]))
    .toEqual([{ startTime: 0, duration: 55, actions: ['return'] }, { startTime: 150, duration: 60, actions: ['close'] }, { startTime: 250, duration: 60, actions: [] }]);
});

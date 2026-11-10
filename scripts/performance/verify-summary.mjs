import assert from 'node:assert/strict';
import { summarize } from './summarize.mjs';

const samples = Array.from({ length: 100 }, (_, index) => ({
  status: 'success', commit: 'baseline', scenario: 'W1', device: 'desktop',
  content_usable_ms: index + 1,
}));
// A failed request must remain in the denominator and cannot look like a fast zero.
samples.push({ status: 'timeout', commit: 'baseline', scenario: 'W1', device: 'desktop', content_usable_ms: null });
// Phone, expiry and a different version must never be pooled with warm desktop.
samples.push({ ...samples[0], device: 'phone', content_usable_ms: 1000 });
samples.push({ ...samples[0], scenario: 'W2', content_usable_ms: 2000 });
samples.push({ ...samples[0], commit: 'candidate', content_usable_ms: null });
const groups = summarize(samples);
assert.equal(groups.length, 4);
const baseline = groups[0];
assert.equal(baseline.sample_count, 101);
assert.equal(baseline.failure_count, 1);
assert.equal(baseline.failure_rate, 1 / 101);
assert.deepEqual(baseline.metrics.content_usable_ms, {
  measured_success_count: 100, missing_success_count: 0, p50: 50, p75: 75, p95: 95, max: 100,
  below_screening_sample_minimum: false, below_final_desktop_sample_minimum: false,
});
assert.equal(groups[3].metrics.content_usable_ms.p75, null);
assert.equal(groups[3].metrics.content_usable_ms.missing_success_count, 1);
const sparse = summarize(Array.from({ length: 100 }, (_, index) => ({
  ...samples[0], content_usable_ms: index === 0 ? 5 : null,
})))[0];
assert.equal(sparse.metrics.content_usable_ms.below_final_desktop_sample_minimum, true,
  '100次访问中仅一次有计时，仍不能声称满足100个性能样本');
for (const value of [-1, Infinity, NaN, '200']) {
  assert.throws(() => summarize([{ ...samples[0], content_usable_ms: value }]), /Invalid measurement/);
}
const [withoutStages, withStages] = summarize([
  { ...samples[0], map_stages_enabled: false },
  { ...samples[0], map_stages_enabled: true, map_stages_ms: { sdk_ready: 260, stock_data_ready: null, private_extra: 42 } },
]);
assert.equal(withoutStages.metrics.map_sdk_ready_ms.p75, null);
assert.equal(withStages.metrics.map_sdk_ready_ms.p75, 260);
assert.equal(withStages.metrics.map_stock_data_ready_ms.missing_success_count, 1);
assert.ok(!('map_private_extra_ms' in withStages.metrics));
const byServerTiming = summarize([
  { ...samples[0], server_timing_enabled: false },
  { ...samples[0], server_timing_enabled: true, content_usable_ms: 26 },
]);
assert.deepEqual(byServerTiming.map(group => group.metrics.content_usable_ms.p50), [1, 26], '隔离诊断样本不能和普通样本混算');
console.log('PASS: scenario isolation, missing values, failure denominator, nearest-rank quantiles, invalid input rejection');

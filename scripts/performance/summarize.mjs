import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mapStartupStages } from './readiness.mjs';

export const metrics = ['feedback_ms', 'shell_ms', 'content_usable_ms', 'fresh_data_ms', 'map_markers_ms', 'map_tiles_ms',
  'long_task_count', 'long_task_total_ms', 'request_count'];
const measurements = [
  ...metrics.map(metric => [metric, sample => sample[metric]]),
  ...mapStartupStages.map(stage => [`map_${stage}_ms`, sample => sample.map_stages_ms?.[stage]]),
];
export function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}
export function summarize(samples) {
  const groups = new Map();
  for (const sample of samples) {
    for (const [metric, read] of measurements) {
      const value = read(sample);
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid measurement: ${metric}`);
      }
    }
    const identity = Object.fromEntries(['commit', 'deployment', 'environment', 'data_origin', 'device', 'browser',
      'network', 'proxy_state', 'role_class', 'scenario', 'cache_state', 'capture_action', 'resource_cache', 'map_stages_enabled']
      .map((key) => [key, sample[key] ?? null]));
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, { identity, samples: [] });
    groups.get(key).samples.push(sample);
  }
  return [...groups.values()].map(({ identity, samples: group }) => {
    const succeeded = group.filter((sample) => sample.status === 'success');
    return { ...identity, sample_count: group.length, success_count: succeeded.length,
      failure_count: group.length - succeeded.length,
      failure_rate: (group.length - succeeded.length) / group.length,
      metrics: Object.fromEntries(measurements.map(([metric, read]) => {
        const values = succeeded.map(read).filter((value) => value != null);
        return [metric, { measured_success_count: values.length, missing_success_count: succeeded.length - values.length,
          below_screening_sample_minimum: values.length < 20,
          below_final_desktop_sample_minimum: values.length < 100,
          p50: quantile(values, .5), p75: quantile(values, .75), p95: quantile(values, .95),
          max: values.length ? Math.max(...values) : null }];
      })),
      limitations: [
        ...(group.length < 20 ? ['Below initial screening sample minimum (20)'] : []),
        ...(group.length < 100 ? ['Below final desktop sample minimum (100); sample P95 only'] : []),
        'Quantiles describe successful measured samples; always read alongside failures and missing counts',
        'No automatic cross-environment comparison or overall system improvement claim',
      ],
    };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , output, ...inputs] = process.argv;
  if (!output || !inputs.length) throw new Error('Usage: summarize.mjs output.json sample.json ...');
  const samples = inputs.flatMap((file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [data];
  });
  fs.writeFileSync(output, JSON.stringify(summarize(samples), null, 2) + '\n');
}

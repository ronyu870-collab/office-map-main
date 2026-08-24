# Colliers Data 2.0 performance baseline

This document defines the measurement contract for the UI 2.0 refactor. It deliberately separates perceived responsiveness from backend latency so later changes can be compared against the same baseline.

## User-perceived targets

| Interaction | Target |
| --- | ---: |
| Ordinary click visual feedback | < 100 ms |
| Route change: next workspace shell visible | < 200 ms |
| Authenticated route | No full-page white screen |
| Map filter: visible result update | < 250 ms |
| Text input / slider interaction | No blocking long task caused by downstream map work |
| INP | < 200 ms |
| CLS | As close to 0 as practical |

These are product targets, not synthetic-benchmark acceptance hacks. A route can still be considered slow when server data takes longer, but the shell and user feedback must remain immediate.

## Baseline scenarios

Record each scenario on a representative production-like dataset. Use the same browser, device class, network profile, account/role, and data snapshot when comparing before/after results.

### Home

- Sign-in -> home interactive
- Home -> Map navigation

### Map

- Map shell first visible
- Map first interactive
- First building marker visible
- Filter -> visible map update
- Search -> building focus
- Building click -> detail surface visible
- Compare -> result rendered

### Quarterly Update

- Workspace first interactive
- First table rows visible
- Cell edit latency
- Save latency

### Lease Submission

- Workspace first interactive
- Building search response
- Submit latency

### Admin

- Database workspace first interactive
- Tab switch
- AG Grid first useful render

## Browser/runtime metrics

Capture:

- LCP
- INP
- CLS
- long tasks (> 50 ms)
- transferred JavaScript
- JavaScript execution time
- React render count for targeted interactions
- API request count
- Supabase request count

`PerformanceReporter` publishes Web Vitals and long-task observations as the browser event `colliers:performance`. In development it also writes them to the console. It intentionally performs no network upload; a later observability phase can subscribe to the event and route measurements to an approved backend.

## Measurement discipline

1. Warm and cold navigation must be recorded separately.
2. Do not compare a local development build with a production deployment.
3. Record at least three runs for noisy interactions and use the median.
4. Keep UI responsiveness and network completion as separate timestamps.
5. Any performance refactor that changes business output must be treated as a product change, not accepted as an optimization shortcut.

## Phase 0 completion condition

Phase 0 is considered established when:

- the above scenarios are reproducible;
- Web Vitals and long tasks are observable in the browser;
- subsequent PRs record relevant before/after measurements;
- no user-facing workflow was intentionally changed merely to improve a benchmark.

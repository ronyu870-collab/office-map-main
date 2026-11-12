type Phase = 'auth' | 'database' | 'overrides' | 'photos' | 'brochures' | 'object-list'
  | 'sign' | 'vocabulary' | 'candidates' | 'model' | 'rank' | 'audit' | 'json' | 'handler'
  | 'profiles' | 'auth-directory' | 'stock-assignments' | 'future-assignments';

type Timing = {
  start(): number | null;
  finish(name: Phase, at: number | null): void;
  measure<T>(name: Phase, work: () => PromiseLike<T>): PromiseLike<T>;
  response<T extends Response>(create: () => T): T;
};

const disabled: Timing = {
  start: () => null,
  finish: () => undefined,
  measure: (_name, work) => work(),
  response: create => create(),
};

/** Local or Vercel Preview only. No client header enables timing; no request data becomes a metric. */
export function createIsolatedRequestTiming(request: Request): Timing {
  const mode = process.env.PERF_ISOLATED_SERVER_TIMING;
  const enabled = (mode === 'preview' && process.env.VERCEL_ENV === 'preview') ||
    (mode === 'local' && process.env.VERCEL_ENV === undefined && process.env.VERCEL !== '1' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname));
  if (!enabled) return disabled;
  const started = performance.now();
  const durations = new Map<Phase, number>();

  function start() {
    return performance.now();
  }

  function finish(name: Phase, at: number | null) {
    if (at !== null) durations.set(name, performance.now() - at);
  }

  function measure<T>(name: Phase, work: () => PromiseLike<T>): PromiseLike<T> {
    const at = start();
    return Promise.resolve(work()).then(result => {
      finish(name, at);
      return result;
    });
  }

  function response<T extends Response>(create: () => T): T {
    const at = start();
    const output = create();
    if (output.ok) {
      finish('json', at);
      finish('handler', started);
      output.headers.append('Server-Timing', Array.from(durations,
        ([name, duration]) => `colliers-${name};dur=${duration.toFixed(1)}`).join(', '));
    }
    return output;
  }

  return { start, finish, measure, response };
}

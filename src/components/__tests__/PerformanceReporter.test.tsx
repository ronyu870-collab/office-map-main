import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const vitals = vi.hoisted(() => Object.fromEntries(['onCLS','onFCP','onINP','onLCP','onTTFB'].map(name=>[name,vi.fn()])));
vi.mock('web-vitals',()=>vitals);

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});

it('reports supported metrics once per document across rerenders and remounts, and releases local observers',async()=>{
  const observers: {callback:PerformanceObserverCallback;observe:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}[]=[];
  vi.stubGlobal('PerformanceObserver',class {
    static supportedEntryTypes=['first-input','longtask'];
    observe=vi.fn();disconnect=vi.fn();
    constructor(public callback:PerformanceObserverCallback){observers.push(this);}
  });
  const received:unknown[]=[];const receive=(event:Event)=>received.push((event as CustomEvent).detail);
  window.addEventListener('colliers:performance',receive);
  try {
    const {PerformanceReporter}=await import('../PerformanceReporter');
    const mounted=render(<PerformanceReporter/>);mounted.rerender(<PerformanceReporter/>);
    for(const subscribe of Object.values(vitals))expect(subscribe).toHaveBeenCalledOnce();
    act(()=>vitals.onLCP.mock.calls[0][0]({name:'LCP',value:123,rating:'good',id:'metric',navigationType:'navigate'}));
    const fid=observers.find(observer=>observer.observe.mock.calls[0]?.[0].type==='first-input')!;
    act(()=>fid.callback({getEntries:()=>[{startTime:10,processingStart:34}]} as unknown as PerformanceObserverEntryList,{} as PerformanceObserver));
    expect(received).toContainEqual({name:'LCP',value:123,rating:'good',id:'metric',navigationType:'navigate'});
    expect(received).toContainEqual({name:'FID',value:24,rating:'good'});
    expect(fid.disconnect).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(observers.find(observer=>observer.observe.mock.calls[0]?.[0].type==='longtask')?.disconnect).toHaveBeenCalledOnce();
    render(<PerformanceReporter/>);
    for(const subscribe of Object.values(vitals))expect(subscribe).toHaveBeenCalledOnce();
    expect(observers.filter(observer=>observer.observe.mock.calls[0]?.[0].type==='first-input')).toHaveLength(1);
  } finally {window.removeEventListener('colliers:performance',receive);}
});

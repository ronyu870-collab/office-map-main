import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmarketTrendChart } from '../components/SubmarketTrendChart';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';

const api=vi.hoisted(()=>({setOption:vi.fn(),resize:vi.fn(),dispose:vi.fn(),observe:vi.fn(),disconnect:vi.fn()}));
vi.mock('echarts/core',()=>({use:vi.fn(),init:vi.fn(()=>api)}));
const point=(period:string,rent:number|null,vacancyPct:number|null):SubmarketTrendPoint=>({period,year:2026,quarter:Number(period.at(-1)),rent,vacancyPct,rentSamples:rent==null?0:2,vacancySamples:vacancyPct==null?0:3,rentArea:100,vacancyArea:100});
const data=[point('2026Q1',0,0),point('2026Q2',null,null)];
let reduced=true;
const add=vi.fn(),remove=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();reduced=true;
  vi.stubGlobal('matchMedia',()=>({get matches(){return reduced;},addEventListener:add,removeEventListener:remove}));
  vi.stubGlobal('ResizeObserver',class {observe=api.observe;disconnect=api.disconnect;});
});
afterEach(()=>{vi.unstubAllGlobals();});

describe('submarket trend reading',()=>{
  it('keeps isolated observed quarters visible in the compact chart after missing data',()=>{
    render(<SubmarketTrendChart data={[point('2026Q2',null,null),point('2026Q3',170,13)]} compact />);
    const series=api.setOption.mock.calls[0][0].series;
    expect(series[0].data).toEqual([null,170]);expect(series[1].data).toEqual([null,13]);
    expect(series.every((line:{showSymbol:boolean})=>line.showSymbol)).toBe(true);
  });

  it('exposes focusable quarter values with units and sample counts, preserving real zero and missing values',async()=>{
    const user=userEvent.setup();render(<SubmarketTrendChart data={data} compact />);
    await user.tab();expect(document.activeElement).toHaveTextContent('查看季度数据');
    // jsdom does not implement native summary keyboard activation; browser regression uses Enter.
    await user.click(screen.getByText('查看季度数据'));
    expect(document.querySelector('details')).toHaveAttribute('open');
    const table=screen.getByRole('table',{name:'季度租金与空置率'});
    expect(table).toBeVisible();expect(table).toHaveTextContent('元/㎡/月');expect(table).toHaveTextContent('空置率');
    const rows=screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2026Q1');expect(rows[1]).toHaveTextContent('0.0');expect(rows[1]).toHaveTextContent('2 个样本');expect(rows[1]).toHaveTextContent('3 个样本');
    expect(rows[2]).toHaveTextContent('2026Q2');expect(rows[2]).toHaveTextContent('—');expect(rows[2]).not.toHaveTextContent('0.0');
  });
  it('honors live reduced motion while keeping missing line gaps and releases chart, media and resize resources',()=>{
    const {unmount}=render(<SubmarketTrendChart data={data} />);
    const option=api.setOption.mock.calls[0][0];
    expect(option.animation).toBe(false);
    expect(option.series[0].data).toEqual([0,null]);expect(option.series[1].data).toEqual([0,null]);
    expect(option.series.every((series:{connectNulls:boolean})=>series.connectNulls===false)).toBe(true);
    expect(add).toHaveBeenCalledWith('change',expect.any(Function));
    reduced=false;const listener=add.mock.calls[0][1];listener();
    expect(api.setOption).toHaveBeenLastCalledWith(expect.objectContaining({animation:true}));
    unmount();expect(remove).toHaveBeenCalledWith('change',listener);expect(api.disconnect).toHaveBeenCalledTimes(1);expect(api.dispose).toHaveBeenCalledTimes(1);
  });
  it('disposes previous chart on data change before releasing the final instance',()=>{
    const {rerender,unmount}=render(<SubmarketTrendChart data={data} />);
    rerender(<SubmarketTrendChart data={[point('2026Q3',150,12)]} />);
    expect(api.dispose).toHaveBeenCalledTimes(1);expect(api.observe).toHaveBeenCalledTimes(2);
    unmount();expect(api.dispose).toHaveBeenCalledTimes(2);expect(api.disconnect).toHaveBeenCalledTimes(2);
  });
});

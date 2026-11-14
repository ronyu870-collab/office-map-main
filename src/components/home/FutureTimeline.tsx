import type {ResultChart} from '@/src/lib/intelligence/query/charts';
import {intervalGeometry,intervalLegend} from '@/src/lib/intelligence/query/future/timeline';
import {Button} from '@/src/components/ui/Button';
import styles from './HomeQuery.module.css';

export function FutureTimeline({chart,page,onPage,onSource}:{chart:ResultChart;page:number;onPage:(page:number)=>void;
  onSource:(ids:readonly string[],label:string,trigger:HTMLButtonElement)=>void}){
  const g=intervalGeometry(chart),rows=chart.points.slice(page*25,(page+1)*25);
  return <>
    <p className={styles.notice}>{intervalLegend}点选范围查看来源。</p>
    {g.empty&&<p className={styles.notice}>没有有效预计时间，无法确定时间刻度；未知记录保留如下。</p>}
    <div className={styles.intervalScroll} tabIndex={0} aria-label="预计入市时间轴，可横向滚动">
      <table className={styles.intervalTable}><caption className="sr-only">全部分页使用相同季度刻度；未知不定位，范围不表示实际入市</caption>
        <thead><tr><th scope="col">未来供应记录</th><th scope="col"><span className="sr-only">预计入市季度</span><div className={styles.intervalAxis} aria-hidden="true">{g.ticks.map(t=><span key={t.value} style={{left:`${t.position}%`}}>{t.label}</span>)}</div></th><th scope="col">原预计范围与分类</th></tr></thead>
        <tbody>{rows.map(p=><tr key={p.yCell.entityId}><th scope="row">{p.label}</th><td><div className={styles.intervalTrack} aria-hidden="true">
          {!g.empty&&g.ticks.map(t=><i className={styles.intervalGrid} key={t.value} style={{left:`${t.position}%`}}/>)}
          {p.state==='valid'&&<i className={p.intervalPrecision==='quarter'?styles.intervalQuarter:styles.intervalRange} style={{left:`${g.position(p.x as number)}%`,width:`${g.width(p)}%`}}/>}
        </div></td><td><button type="button" className={styles.cell} onClick={e=>onSource(p.yCell.sourceIds,`${p.label}：${p.yText}`,e.currentTarget)}>{p.yText}</button></td></tr>)}</tbody>
      </table>
    </div>
    {chart.points.length>25&&<div className={styles.tableFooter}><p>图示第 {page*25+1}–{Math.min((page+1)*25,chart.points.length)} 条，共 {chart.points.length} 条；分页不改变时间刻度。</p><div className={styles.actions}><Button variant="ghost" disabled={page===0} onClick={()=>onPage(page-1)}>上一页图示</Button><Button variant="ghost" disabled={(page+1)*25>=chart.points.length} onClick={()=>onPage(page+1)}>下一页图示</Button></div></div>}
  </>;
}

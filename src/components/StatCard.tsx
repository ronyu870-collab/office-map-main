import * as React from 'react';

export interface StatCardProps {
  /** 标题（例如：总面积 / 平均租金 / 整体空置率） */
  title: string;
  /**
   * 数值主体（完全解耦数据来源）
   * - 推荐直接传格式化后的字符串（如 "12,340" / "-" / "288.7"）
   * - 也可以传 ReactNode（如带高亮的组合）
   */
  value: React.ReactNode;
  /** 单位（可选，例如：m² / 元/㎡/天 / %） */
  unit?: React.ReactNode;
  /**
   * 环比变化率（可选）
   * - 约定：传入“比例值”，如 0.035 表示 +3.5%
   * - 传 null/undefined 表示不展示
   */
  trend?: number | null;
}

function formatTrend(trend: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!Number.isFinite(trend)) return { text: '-', tone: 'flat' };
  const pct = trend * 100;
  const sign = pct > 0 ? '+' : '';
  const text = `${sign}${pct.toFixed(1)}%`;
  const tone = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { text, tone };
}

/**
 * 统计卡片（参考旧版 map.html 的 stat-card 结构进行 Tailwind 现代化重构）
 * - 纯展示组件：无请求逻辑、无副作用
 * - 风格：商务、专业、克制（Smart Casual）
 */
export function StatCard({ title, value, unit, trend }: StatCardProps) {
  const showTrend = typeof trend === 'number' && Number.isFinite(trend);
  const trendInfo = showTrend ? formatTrend(trend) : null;

  const trendClassName =
    trendInfo?.tone === 'up'
      ? 'text-emerald-600'
      : trendInfo?.tone === 'down'
        ? 'text-rose-600'
        : 'text-zinc-500';

  return (
    <section className="group rounded-md border border-zinc-200/60 bg-white px-3 py-2.5 transition-colors hover:border-zinc-300">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-zinc-500">{title}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <div className="truncate text-[18px] font-semibold tabular-nums text-zinc-900">{value}</div>
            {unit ? <div className="text-[12px] font-medium text-zinc-500">{unit}</div> : null}
          </div>
        </div>

        {trendInfo ? (
          <div className="flex flex-col items-end">
            <div className={`text-[12px] font-semibold tabular-nums ${trendClassName}`}>{trendInfo.text}</div>
            <div className="text-[10px] text-zinc-400">环比</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}


'use client';

import { useState, useEffect, useMemo, useRef } from 'react';

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface ColumnDef {
  key: string;
  label: string;
  width?: number | 'flex'; // 固定宽度(px) 或 'flex'（弹性，按权重分配剩余空间）
  minWidth?: number; // flex 列的最小宽度
  maxWidth?: number; // flex 列的最大宽度
  flexWeight?: number; // flex 列的权重（默认1）
  /** 容器宽度 ≥ 此值时才显示该列。省略或 0 表示始终显示 */
  minVisibleWidth?: number;
  /** 标记为可隐藏列，用户可通过齿轮按钮控制显隐，默认隐藏 */
  hideable?: boolean;
  align?: 'left' | 'center' | 'right';
}

// 兼容旧接口：computedWidth 不再由 hook 计算，但保留类型定义
export interface ResponsiveColumn extends ColumnDef {
  computedWidth: number;
}

// ─── 防抖 Hook ─────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ─── 列宽计算工具 ─────────────────────────────────────────────────────────────

/**
 * 根据容器宽度计算所有可见列的实际像素宽度。
 * 固定列用指定宽度，flex 列按权重分配剩余空间（受 minWidth/maxWidth 约束）。
 * 容器不够宽时，flex 列使用 minWidth，表格通过横向滚动容纳。
 */
export function calculateColumnWidths(
  visibleColumns: ColumnDef[],
  containerWidth: number,
): number[] {
  if (visibleColumns.length === 0 || containerWidth <= 0) {
    return visibleColumns.map(() => 80);
  }

  // 固定列总宽度
  const fixedWidths: number[] = [];
  let fixedTotal = 0;
  for (const col of visibleColumns) {
    if (typeof col.width === 'number') {
      fixedWidths.push(col.width);
      fixedTotal += col.width;
    } else {
      fixedWidths.push(0); // placeholder, filled later
    }
  }

  // flex 列信息
  const flexIndices: number[] = [];
  let flexMinTotal = 0;
  let flexWeightTotal = 0;
  for (let i = 0; i < visibleColumns.length; i++) {
    const col = visibleColumns[i];
    if (col.width === 'flex') {
      flexIndices.push(i);
      flexMinTotal += col.minWidth || 80;
      flexWeightTotal += col.flexWeight || 1;
    }
  }

  // 剩余可用宽度
  const remaining = containerWidth - fixedTotal;

  // 如果空间不足以容纳 flex 列最小宽度，全部使用 minWidth（表格将横向滚动）
  if (remaining <= flexMinTotal) {
    const result = [...fixedWidths];
    for (const idx of flexIndices) {
      result[idx] = visibleColumns[idx].minWidth || 80;
    }
    return result;
  }

  // 有余量：按权重分配
  const extraForFlex = remaining - flexMinTotal;
  const result = [...fixedWidths];

  for (const idx of flexIndices) {
    const col = visibleColumns[idx];
    const min = col.minWidth || 80;
    const max = col.maxWidth ?? Infinity;
    const weight = col.flexWeight || 1;
    const extra = flexWeightTotal > 0 ? (extraForFlex * weight) / flexWeightTotal : 0;
    result[idx] = Math.round(Math.min(max, Math.max(min, min + extra)));
  }

  return result;
}

// ─── 主 Hook ───────────────────────────────────────────────────────────────────

interface UseResponsiveColumnsOptions {
  columns: ColumnDef[];
  containerRef: React.RefObject<HTMLElement | null>;
  defaultWidth?: number;
  padding?: number;
  scrollbarWidth?: number;
  debounceMs?: number;
  /** 当此值变化时，立即用容器实际宽度重算（绕过防抖） */
  immediateRecalcTrigger?: unknown;
}

interface UseResponsiveColumnsResult {
  /** 当前应显示的列（已按 minVisibleWidth 过滤） */
  visibleColumns: ColumnDef[];
  /** 所有可见列的实际像素宽度数组（用于 <colgroup> 或 CSS Grid） */
  columnWidths: number[];
  /** CSS Grid 的 grid-template-columns 值（向后兼容） */
  gridTemplateColumns: string;
  containerWidth: number;
  mounted: boolean;
}

export function useResponsiveColumns({
  columns,
  containerRef,
  defaultWidth = 1440,
  padding = 0,
  scrollbarWidth = 0,
  debounceMs = 100,
  immediateRecalcTrigger,
}: UseResponsiveColumnsOptions): UseResponsiveColumnsResult {
  const mountedRef = useRef(true);
  const [rawWidth, setRawWidth] = useState(defaultWidth);
  const [mounted, setMounted] = useState(false);
  const [overrideWidth, setOverrideWidth] = useState<number | null>(null);

  const debouncedWidth = useDebounce(rawWidth, debounceMs);

  // immediateRecalcTrigger 变化 → 立即测量容器宽度
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width;
      if (w > 0) {
        setOverrideWidth(w);
        setRawWidth(w);
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediateRecalcTrigger]);

  useEffect(() => {
    if (overrideWidth === null) return;
    const raf = requestAnimationFrame(() => setOverrideWidth(null));
    return () => cancelAnimationFrame(raf);
  }, [overrideWidth]);

  const effectiveWidth = overrideWidth ?? debouncedWidth;

  // ── 核心：列可见性判断 ──

  const visibleColumns = useMemo(() => {
    if (!columns || columns.length === 0) return [];

    // 分离始终列和可选列
    const alwaysCols = columns.filter(c => !c.minVisibleWidth);
    const optionalCols = columns
      .filter(c => c.minVisibleWidth)
      .sort((a, b) => (a.minVisibleWidth ?? 0) - (b.minVisibleWidth ?? 0));

    // 始终列的固定宽度之和 + flex 列最小宽度之和
    const alwaysFixedTotal = alwaysCols
      .filter(c => typeof c.width === 'number')
      .reduce((s, c) => s + (c.width as number), 0);
    const alwaysFlexMinTotal = alwaysCols
      .filter(c => c.width === 'flex')
      .reduce((s, c) => s + (c.minWidth || 80), 0);

    // 逐步添加可选列
    const included: ColumnDef[] = [];
    let optFixedTotal = 0;

    for (const col of optionalCols) {
      const extra = typeof col.width === 'number' ? col.width : (col.minWidth || 80);
      if (alwaysFixedTotal + optFixedTotal + extra + alwaysFlexMinTotal <= effectiveWidth) {
        included.push(col);
        if (typeof col.width === 'number') optFixedTotal += extra;
      }
    }

    return [...alwaysCols, ...included];
  }, [columns, effectiveWidth]);

  // ── 计算列宽（减去序号列 48px 和可能的编辑列 48px 后分配）──
  const columnWidths = useMemo(() => {
    // 预留 48px 给序号列，实际使用时如果有编辑列再加 48px
    const usableWidth = effectiveWidth - 48;
    return calculateColumnWidths(visibleColumns, usableWidth);
  }, [visibleColumns, effectiveWidth]);

  // ── CSS Grid 模板（向后兼容）──
  const gridTemplateColumns = useMemo(() => {
    return columnWidths.map(w => `${w}px`).join(' ');
  }, [columnWidths]);

  // ResizeObserver
  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);

    const el = containerRef.current;
    if (!el) return;

    const initialWidth = el.getBoundingClientRect().width;
    if (initialWidth > 0) setRawWidth(initialWidth);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        if (!mountedRef.current) return;
        const newWidth = entries[0]?.contentRect.width;
        if (newWidth && newWidth > 0) setRawWidth(newWidth);
      });
      observer.observe(el);
      return () => { mountedRef.current = false; observer.disconnect(); };
    } else {
      const handleResize = () => {
        if (!mountedRef.current) return;
        const w = el.getBoundingClientRect().width;
        if (w > 0) setRawWidth(w);
      };
      window.addEventListener('resize', handleResize);
      return () => { mountedRef.current = false; window.removeEventListener('resize', handleResize); };
    }
  }, [containerRef]);

  return { visibleColumns, columnWidths, gridTemplateColumns, containerWidth: effectiveWidth, mounted };
}

export default useResponsiveColumns;

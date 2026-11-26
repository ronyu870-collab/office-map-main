import type { SceneElement } from '../contracts/scene';
import { DESIGN_PROFILES, type DesignTheme } from './theme';

type Table = Extract<SceneElement, { kind: 'table' }>;

export function tableCellFill(table: Table, theme: DesignTheme, row: number, column: number) {
  if (row === 0) return theme.table.headerFill;
  const value = table.rows[row - 1][column];
  const scale = table.heatScale;
  if (scale && column > 0 && typeof value === 'number') {
    const strength = scale.max === scale.min ? .22 : .08 + .36 * (value - scale.min) / (scale.max - scale.min);
    return theme.colors.background.match(/../g)!.map((channel, i) => {
      const base = parseInt(channel, 16), accent = parseInt(theme.chartColors[0].slice(i * 2, i * 2 + 2), 16);
      return Math.round(base + (accent - base) * strength).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }
  return theme.profile && DESIGN_PROFILES[theme.profile].table === 'banded' && row % 2 === 0 && !scale
    ? theme.table.headerFill
    : theme.colors.background;
}

export function tableCellAlignment(table: Table, theme: DesignTheme, column: number) {
  return theme.profile && table.rows.some(row => typeof row[column] === 'number') &&
    table.rows.every(row => row[column] === null || typeof row[column] === 'number') ? 'right' : 'left';
}

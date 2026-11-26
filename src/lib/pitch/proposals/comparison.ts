export type Position = 'above' | 'equal' | 'below';

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

/** Match the precision the reader sees so two displayed ties stay ties in the headline. */
export function visiblePosition(value: number, reference: number, digits: number): Position {
  const displayedValue = Number(value.toFixed(digits));
  const displayedReference = Number(reference.toFixed(digits));
  return displayedValue === displayedReference ? 'equal' : displayedValue < displayedReference ? 'below' : 'above';
}

export type MarketPoint<T> = { item: T; rent: number; vacancyRate: number };

/** Use paired observations only. A point on either median is assigned to the upper band of that axis. */
export function marketQuadrants<T>(points: readonly MarketPoint<T>[]) {
  const rent = median(points.map(point => point.rent));
  const vacancyRate = median(points.map(point => point.vacancyRate));
  if (rent === null || vacancyRate === null || points.length < 2) return null;
  const cells: [T[], T[], T[], T[]] = [[], [], [], []];
  for (const point of points) {
    const row = point.vacancyRate >= vacancyRate ? 0 : 1;
    const column = point.rent >= rent ? 1 : 0;
    cells[row * 2 + column].push(point.item);
  }
  return { rent, vacancyRate, cells };
}

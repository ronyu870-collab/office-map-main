/** Serializable UI reading context; contains no business records or chart instances. */
export type TrendChartReading = { metric: 'rent' | 'vac'; tableOpen: boolean };
export type TrendChartReadingOptions = {
  value?: TrendChartReading;
  onReady?: () => void;
  onChange?: (reading: TrendChartReading) => void;
};

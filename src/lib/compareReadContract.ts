export const MAX_COMPARE_COMPETITORS = 5;
export const MAX_COMPARE_SELECTION = MAX_COMPARE_COMPETITORS + 1;

export type CompareReadSlice = { scope: 'catalog' } | { scope: 'selected'; ids: readonly string[] };

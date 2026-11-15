/** Map is an output destination, never a substitute for business scope, metric or period. */
export function mapPresentationQuestion(input: string): { question: string; mapRequested: boolean } {
  const text = input.trim().replace(/[。？?!！]$/, '');
  const wrapped = /^(?:请)?(?:把|将)?(.+?)(?:标在|标到|显示在|展示在|定位到)地图(?:上|中)$/.exec(text)
    ?? /^(?:请)?在地图(?:上|中)(?:标出|显示|展示|查看)(.+)$/.exec(text);
  if (!wrapped) return { question: input, mapRequested: false };
  // P1 already owns rank bounds, field/quarter clarification, and condition validation.
  // Normalize only this complete counted ranking phrase; every other word is retained.
  return { question: wrapped[1].replace(/(最高|最低)的?(\d{1,3}|[二三四五六七八九十])栋/g, '$1的前$2栋'), mapRequested: true };
}

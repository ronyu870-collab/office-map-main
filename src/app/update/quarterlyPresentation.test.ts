import { describe, expect, it } from 'vitest';
import { quarterlyPresentation } from './quarterlyPresentation';

describe('shared quarterly presentation', () => {
  it('keeps calculation precision and formats rent, area changes and ratios consistently', () => {
    const draft = { qFace: '285.75', qFree: '3', qVacArea: '100' };
    const original = structuredClone(draft);
    const result = quarterlyPresentation(draft, 1000, { net_effective_rent: 250, vacant_area: 125, vacancy_rate: 0.125, face_rent: 285.75 });
    expect(result.current).toEqual({ net: '261.94', rentDelta: '+4.8%', areaDelta: '-25', vacancy: '10.0%' });
    expect(result.historical.face_rent).toBe('285.75');
    expect(result.historical.vacancy_rate).toBe('12.5%');
    expect(draft).toEqual(original);
  });
  it('distinguishes zero, missing and invalid input without deriving misleading values', () => {
    const result = quarterlyPresentation({ qFace: 0, qFree: 0, qVacArea: 0 }, 1000, { net_effective_rent: 0, asking_rent: '', vacant_area: 0 });
    expect(result.current).toEqual({ net: '0.00', rentDelta: '—', areaDelta: '0', vacancy: '0.0%' });
    expect(result.historical.net_effective_rent).toBe('0');
    expect(result.historical.asking_rent).toBe('—');
    expect(quarterlyPresentation({ qFace: 'bad', qFree: 0, qVacArea: -1 }, 1000, null).current).toEqual({ net: '—', rentDelta: '—', areaDelta: '—', vacancy: '—' });
    expect(quarterlyPresentation({ qFace: 100, qFree: 37 }, 1000, null).current.net).toBe('—');
  });
  it('does not compare future supply with an unrelated historical reference', () => {
    const result = quarterlyPresentation({ qFace: 100, qFree: 0, qVacArea: 0 }, 1000, { net_effective_rent: 99, vacant_area: 50 }, true);
    expect(Object.values(result.historical).every((value) => value === '—')).toBe(true);
    expect(result.current.net).toBe('100.00');
    expect(result.current.rentDelta).toBe('—');
    expect(result.current.areaDelta).toBe('—');
  });
});

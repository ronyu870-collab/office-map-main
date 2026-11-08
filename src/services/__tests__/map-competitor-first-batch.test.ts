import { describe, expect, it, vi } from 'vitest';
import { MapController } from '../MapController';

type Competitor = {
  id: string;
  name: string;
  location_lng: number;
  location_lat: number;
  metrics: Array<{ record_year: number; record_quarter: number; vacancy_rate: number | null }>;
};

function sample(id: string, vacancy: number | null): Competitor {
  return {
    id,
    name: id,
    location_lng: 116.45,
    location_lat: 39.91,
    metrics: [{ record_year: 2026, record_quarter: 3, vacancy_rate: vacancy }],
  };
}

describe('competitor-map first-batch regression', () => {
  it('preserves 26px round core markers for the target and competitors', () => {
    const markerContents: string[] = [];
    class Marker {
      constructor(options: { content?: string }) {
        if (options.content) markerContents.push(options.content);
      }
      on() {}
    }
    class Pixel { constructor(public x: number, public y: number) {} }

    const controller = new MapController();
    Object.assign(controller, {
      map: { add: vi.fn(), remove: vi.fn() },
      AMap: { Marker, Pixel },
      _compBuildingId: 'target',
      _compDistances: new Map([['nearby', 1200]]),
    });
    (controller as unknown as { _renderDistanceMarkers: (rows: Competitor[]) => void })
      ._renderDistanceMarkers([sample('target', 0), sample('nearby', 0.08)]);

    expect(markerContents).toHaveLength(2);
    for (const html of markerContents) {
      const host = document.createElement('div');
      host.innerHTML = html;
      const point = host.querySelector<HTMLElement>('.map-competitor-marker__core');
      expect(host.querySelector('.map-competitor-marker')).not.toBeNull();
      expect(point?.style.width).toBe('26px');
      expect(point?.style.height).toBe('26px');
      expect(point?.style.borderRadius).toBe('50%');
      expect(point?.style.borderTopStyle).toBe('solid');
    }
  });

  it('uses fractional 0-1 vacancy for UI percentage filters, excluding unknown values', () => {
    vi.useFakeTimers();
    try {
      const rendered = vi.fn();
      const controller = new MapController();
      class Overlay { constructor(_options?: unknown) {} on() {} }
      Object.assign(controller, {
        map: { add: vi.fn(), remove: vi.fn(), setFitView: vi.fn(), setZoom: vi.fn(), getZoom: () => 14 },
        AMap: { Marker: Overlay, Circle: Overlay, Pixel: Overlay },
        _compCenterPoint: [116.45, 39.91],
        _compBuildingId: 'target',
        _compRadius: 5000,
        _compFilterConds: [{ field: 'vacancy_rate', op: '<=', value: 10 }],
        _allBuildingsCache: [
          sample('target', 0),
          sample('eight-percent', 0.08),
          sample('twelve-percent', 0.12),
          sample('unknown-null', null),
          sample('unknown-nan', Number.NaN),
          sample('true-zero', 0),
        ],
        calculateDistance: () => 200,
        _renderDistanceMarkers: rendered,
        showCompExitButton: vi.fn(),
      });
      (controller as unknown as { _renderCompetitorsByRadius: () => void })._renderCompetitorsByRadius();
      expect(rendered).toHaveBeenCalledOnce();
      const shown: Competitor[] = rendered.mock.calls[0][0];
      expect(shown.map(row => row.id)).toEqual(['target', 'eight-percent', 'true-zero']);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('removes an independently rendered F overlay when entering or refiltering competitor mode', () => {
    vi.useFakeTimers();
    try {
      class Overlay {
        on() {}
        constructor(public options: unknown) {}
      }
      class Pixel { constructor(public x: number, public y: number) {} }
      const map = {
        add: vi.fn(), remove: vi.fn(), setFitView: vi.fn(),
        getZoom: () => 14, setZoom: vi.fn(),
      };
      const controller = new MapController();
      Object.assign(controller, {
        map,
        AMap: { Marker: Overlay, Circle: Overlay, Pixel },
        _allBuildingsCache: [sample('target', 0.08), sample('nearby', 0.12)],
        clearSubwayElements: vi.fn(),
        hideCompExitButton: vi.fn(),
        showCompExitButton: vi.fn(),
        _renderDistanceMarkers: vi.fn(),
        calculateDistance: () => 200,
      });
      const future = { id: 'future-project', name: '未来项目', grade: 'A', location_lng: 116.46, location_lat: 39.91 };
      controller.renderFutureMarkers([future]);
      const futureOverlays = map.add.mock.calls[0]?.[0];
      expect(futureOverlays).toHaveLength(1);
      const clearFuture = vi.spyOn(controller, 'clearFutureMarkers');

      controller.analyzeCompetitors('target', 116.45, 39.91, 200);
      expect(clearFuture).toHaveBeenCalledTimes(1);
      expect(map.remove).toHaveBeenCalledWith(futureOverlays);
      expect((controller as unknown as { futureMarkers: unknown[] }).futureMarkers).toHaveLength(0);

      // Radius/grade changes must not bring the original F layer back.
      (controller as unknown as { _renderCompetitorsByRadius(): void })._renderCompetitorsByRadius();
      expect(clearFuture).toHaveBeenCalledTimes(2);
      expect((controller as unknown as { futureMarkers: unknown[] }).futureMarkers).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

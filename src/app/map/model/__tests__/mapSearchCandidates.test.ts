import { describe, expect, it } from 'vitest';
import { describeMapSearchMatch, rankMapSearchCandidates, searchViewportTargets } from '../mapSearchCandidates';

const buildings = [
  { id: 'owner', name: '外地大厦', owner: '国贸集团', location_lng: 116.23, location_lat: 39.94 },
  { id: 'partial', name: '国贸二期', location_lng: 116.48, location_lat: 39.9 },
  { id: 'exact', name: '国贸', location_lng: 116.46, location_lat: 39.91 },
  { id: 'former', name: '旧址', former_names: ['国贸旧楼'], location_lng: 116.49, location_lat: 39.92 },
  { id: 'missing', name: '国贸北区', location_lng: null, location_lat: 39.91 },
  { id: 'future', name: '国贸未来大厦', _dataType: 'future' as const, location_lng: 116.5, location_lat: 39.93 },
];

describe('map search choices and viewport targets', () => {
  it('orders exact, prefix, former-name and ancillary matches without changing filter permissions', () => {
    const result = rankMapSearchCandidates(buildings, '国贸', 3);
    expect(result.total).toBe(6);
    expect(result.items.map(item => item.id)).toEqual(['exact', 'partial', 'missing']);
    expect(rankMapSearchCandidates(buildings, '  ').items).toEqual([]);
  });
  it('prefers one exact project when broader matches include an owner or future project', () => {
    expect(searchViewportTargets(buildings, '国贸').map(item => item.id)).toEqual(['exact']);
    expect(searchViewportTargets(buildings, '国贸二').map(item => item.id)).toEqual(['owner', 'partial', 'exact', 'former', 'future']);
  });
  it('keeps distinct stock/future results together for broader searches, omitting unlocatable rows', () => {
    const result = searchViewportTargets([
      { id: 'a', name: '华贸A', location_lng: 116.4, location_lat: 39.9 },
      { id: 'b', name: '华贸B', _dataType: 'future', location_lng: 116.5, location_lat: 39.92 },
      { id: 'c', name: '华贸C', location_lng: null, location_lat: null },
    ], '华贸');
    expect(result.map(item => item.id)).toEqual(['a', 'b']);
  });
});


describe('consistent search explanations and unlocatable counts', () => {
  it('orders normalized name, area, district, owner and property matches by relevance', () => {
    const values = [
      { id: 'owner', name: '普通中心', owner: '国 贸集团', location_lng: 116.4, location_lat: 39.9 },
      { id: 'property', name: '普通楼宇', property_management: '国 贸物业', location_lng: 116.41, location_lat: 39.9 },
      { id: 'district', name: '东部中心', district: '国贸', location_lng: 116.42, location_lat: 39.9 },
      { id: 'submarket', name: '西部中心', submarket: '国贸', location_lng: 116.43, location_lat: 39.9 },
      { id: 'exact', name: '国 贸', location_lng: 116.44, location_lat: 39.9 },
      { id: 'missing', name: '国贸大厦', location_lng: null, location_lat: null },
    ];
    const ranked = rankMapSearchCandidates(values, '国贸');
    expect(ranked.items.map(v => v.id)).toEqual(['exact', 'missing', 'submarket', 'district', 'owner', 'property']);
    expect(ranked.matchedCount).toBe(6);
    expect(ranked.missingCoordinates).toBe(1);
    expect(describeMapSearchMatch(values[1], '国贸')).toBe('物业公司');
    expect(describeMapSearchMatch(values[4], '国贸')).toBe('项目名称');
  });
});

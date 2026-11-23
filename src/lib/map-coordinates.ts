/** Coordinate validity for map placement only; never repairs source records or
 * excludes a legal distant point based on an assumed business boundary. */
type MapCoordinates = { id?: unknown; location_lng?: unknown; location_lat?: unknown };
export function coordinateIssue(building: MapCoordinates | null | undefined) {
  const lng = building?.location_lng, lat = building?.location_lat;
  if (lng == null || lat == null) return 'missing';
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return 'non-finite';
  if (Math.abs(lng) > 180 || Math.abs(lat) > 85.05112878) return 'out-of-range';
  if (lng === 0 && lat === 0) return 'zero-origin';
  return null;
}
export function hasMapCoordinates<T extends MapCoordinates>(building: T | null | undefined): building is T & { location_lng: number; location_lat: number } {
  return coordinateIssue(building) === null;
}
export function coordinateNotice(building: MapCoordinates) {
  const issue = coordinateIssue(building);
  if (!issue) return null;
  if (issue === 'missing') return '此项目未提供有效坐标，可继续查看资料。';
  if (issue === 'out-of-range') return '此项目坐标超出地图范围，暂不能定位；可继续查看资料。';
  if (issue === 'zero-origin') return '此项目坐标为零原点，暂不能定位；可继续查看资料。';
  return '此项目坐标格式无效，暂不能定位；可继续查看资料。';
}

/**
 * exportMapData.ts
 * 工具：从高德地图 API 抓取行政区划边界和地铁线路数据，导出为本地 JSON 文件
 * 
 * 使用方法：
 * 1. 在开发环境的地图页面中，打开浏览器控制台
 * 2. 调用 downloadAmapData(mapInstance, AMap)
 * 3. 浏览器会自动下载 beijing_map_data.json
 * 4. 将下载的文件放到 public/data/beijing_map_data.json
 */

export interface DistrictBoundary {
  name: string;
  boundaries: number[][][]; // 多边形坐标数组
}

export interface SubwayStation {
  id: string;
  name: string;
  center: [number, number];
}

export interface SubwayLine {
  name: string;
  path: [number, number][]; // 线路路径
  stations: SubwayStation[]; // 沿线站点
}

export interface BeijingMapData {
  version: string;
  generatedAt: string;
  districts: DistrictBoundary[];
  subways: SubwayLine[];
}

/**
 * 预设的行政区列表（北京核心商务区）
 */
const PRESET_DISTRICTS = [
  '朝阳区',
  '海淀区',
  '东城区',
  '西城区',
  '丰台区',
  '石景山区',
  '通州区',
  '顺义区',
  '昌平区',
  '大兴区',
];

/**
 * 预设的地铁线路列表
 */
const PRESET_SUBWAY_LINES = [
  '地铁1号线',
  '地铁2号线',
  '地铁4号线',
  '地铁5号线',
  '地铁6号线',
  '地铁7号线',
  '地铁8号线',
  '地铁9号线',
  '地铁10号线',
  '地铁13号线',
  '地铁14号线',
  '地铁15号线',
  '地铁16号线',
  '地铁17号线',
  '地铁八通线',
  '地铁昌平线',
  '地铁亦庄线',
  '地铁房山线',
  '地铁大兴线',
  '地铁首都机场线',
];

/**
 * 抓取单个行政区的边界数据
 */
function fetchDistrictBoundary(
  AMap: any,
  districtName: string
): Promise<DistrictBoundary> {
  return new Promise((resolve, reject) => {
    const districtSearch = new AMap.DistrictSearch({
      extensions: 'all',
      subdistrict: 0,
      level: 'district',
    });

    districtSearch.search(districtName, (status: string, result: any) => {
      if (status === 'complete' && result?.districtList?.length && result.districtList.length > 0) {
        const district = result.districtList[0];
        const boundaries = district.boundaries ?? [];
        
        // 将 AMap.LngLat 对象转换为纯数组
        const serializedBoundaries = boundaries.map((boundary: any) => {
          return boundary.map((lngLat: any) => [lngLat.lng, lngLat.lat]);
        });

        resolve({
          name: districtName,
          boundaries: serializedBoundaries,
        });
      } else {
        reject(new Error(`无法获取 ${districtName} 的边界数据`));
      }
    });
  });
}

/**
 * 抓取单条地铁线路的路径和站点数据
 */
function fetchSubwayLine(AMap: any, lineName: string): Promise<SubwayLine> {
  return new Promise((resolve, reject) => {
    const lineSearch = new AMap.LineSearch({
      pageIndex: 1,
      city: '北京',
      pageSize: 1,
      extensions: 'all',
    });

    lineSearch.search(lineName, (status: string, result: any) => {
      if (status === 'complete' && result.info === 'OK' && result?.lineInfo?.length && result.lineInfo.length > 0) {
        const lineData = result.lineInfo[0];
        
        // 转换路径数据
        const path: [number, number][] = (lineData.path ?? []).map((lngLat: any) => [
          lngLat.lng,
          lngLat.lat,
        ]);

        // 转换站点数据
        const stations: SubwayStation[] = (lineData.via_stops ?? []).map((stop: any) => ({
          id: stop.id ?? '',
          name: stop.name ?? '',
          center: [stop.location.lng, stop.location.lat] as [number, number],
        }));

        resolve({
          name: lineName,
          path,
          stations,
        });
      } else {
        reject(new Error(`无法获取 ${lineName} 的线路数据`));
      }
    });
  });
}

/**
 * 主函数：抓取所有数据并触发下载
 * 
 * @param mapInstance - 高德地图实例（可选，用于确保地图已初始化）
 * @param AMap - 高德地图 API 对象
 */
export async function downloadAmapData(mapInstance: any, AMap: any): Promise<void> {
  if (!AMap) {
    throw new Error('AMap 对象未定义，请确保高德地图已加载');
  }

  console.log('🚀 开始抓取高德地图数据...');
  console.log(`📍 行政区数量: ${PRESET_DISTRICTS.length}`);
  console.log(`🚇 地铁线路数量: ${PRESET_SUBWAY_LINES.length}`);

  try {
    // 1. 抓取所有行政区边界
    console.log('📍 正在抓取行政区边界...');
    const districtPromises = PRESET_DISTRICTS.map((name) =>
      fetchDistrictBoundary(AMap, name)
    );
    const districts = await Promise.all(districtPromises);
    console.log(`✅ 成功抓取 ${districts.length} 个行政区边界`);

    // 2. 抓取所有地铁线路
    console.log('🚇 正在抓取地铁线路...');
    const subwayPromises = PRESET_SUBWAY_LINES.map((name) =>
      fetchSubwayLine(AMap, name)
    );
    const subways = await Promise.all(subwayPromises);
    console.log(`✅ 成功抓取 ${subways.length} 条地铁线路`);

    // 3. 组合数据
    const mapData: BeijingMapData = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      districts,
      subways,
    };

    // 4. 触发下载
    const jsonString = JSON.stringify(mapData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'beijing_map_data.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('✅ 数据导出成功！文件已下载为 beijing_map_data.json');
    console.log(`📊 数据统计:`);
    console.log(`   - 行政区: ${districts.length} 个`);
    console.log(`   - 地铁线路: ${subways.length} 条`);
    console.log(`   - 地铁站点: ${subways.reduce((sum, line) => sum + line.stations.length, 0)} 个`);
    console.log(`   - 文件大小: ${(jsonString.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error('❌ 数据抓取失败:', error);
    throw error;
  }
}

/**
 * 便捷函数：在浏览器控制台中直接调用
 * 使用方法：在地图页面打开控制台，输入 window.__exportMapData()
 */
if (typeof window !== 'undefined') {
  (window as any).__exportMapData = downloadAmapData;
}

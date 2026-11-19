import { displayListGrade, listBuildingValues, listVacancyPercent, type FullListBuilding } from '../model/fullBuildingList';

export type ComparisonLayout = 'rows' | 'columns';
export type ComparisonBuilding = FullListBuilding & { leed_certification?: string | null };
type Overrides = Map<string, Map<string, { display_label: string; display_value: string }>>;
type FieldKey = 'name' | 'district' | 'submarket' | 'grade' | 'year' | 'area' | 'rent' | 'vacancy' | 'period' | 'faceRent' | 'managementFee' | 'owner' | 'property' | 'leed';
type Field = { key: FieldKey; label: string; width: number };

const CORE: Field[] = [
  { key: 'name', label: '项目名称', width: 275 },
  { key: 'district', label: '行政区', width: 125 },
  { key: 'submarket', label: '子市场', width: 150 },
  { key: 'grade', label: '等级', width: 105 },
  { key: 'year', label: '建成／预计年份', width: 160 },
  { key: 'area', label: '面积（㎡）', width: 160 },
  { key: 'rent', label: '净有效租金（元/㎡/月）', width: 205 },
  { key: 'vacancy', label: '空置率', width: 120 },
  { key: 'period', label: '数据季度', width: 135 },
];

const DETAIL: Field[] = [
  ...CORE.filter(field => field.key !== 'name'),
  { key: 'faceRent', label: '表面租金（元/㎡/月）', width: 180 },
  { key: 'managementFee', label: '物业费（元/㎡/月）', width: 180 },
  { key: 'owner', label: '业主', width: 220 },
  { key: 'property', label: '物业公司', width: 220 },
  { key: 'leed', label: 'LEED 认证', width: 140 },
];

const escapeXml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char] ?? char));

function stringValue(value: unknown): string {
  return value === null || value === undefined || String(value).trim() === '' ? '—' : String(value);
}

function numberValue(value: unknown, fraction = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: fraction }) : '—';
}

function nameOf(building: ComparisonBuilding) {
  return stringValue(building.name) + (building._dataType === 'future' ? '（未来供应）' : '');
}

function valueFor(building: ComparisonBuilding, key: FieldKey, overrides?: Overrides): string {
  const values = listBuildingValues(building);
  const future = building._dataType === 'future';
  switch (key) {
    case 'name': return nameOf(building);
    case 'district': return stringValue(building.district);
    case 'submarket': return stringValue(overrides?.get(building.id)?.get('submarket')?.display_value ?? building.submarket);
    case 'grade': return stringValue(overrides?.get(building.id)?.get('grade')?.display_value ?? displayListGrade(building.grade));
    case 'year': return future
      ? (building.launch_year ? '预计 ' + building.launch_year + (building.launch_quarter || '') : '—')
      : (building.completion_year ? String(building.completion_year) : '—');
    case 'area': return numberValue(values.area, 0);
    case 'rent': return numberValue(values.rent, 2);
    case 'vacancy': {
      const vacancy = listVacancyPercent(values.vacancy);
      return vacancy === null ? '—' : numberValue(vacancy, 1) + '%';
    }
    case 'period': return future ? '未投入运营' : stringValue(values.period);
    case 'faceRent': return future ? '—' : numberValue(values.metric?.face_rent, 2);
    case 'managementFee': return future ? '—' : numberValue(values.metric?.management_fee, 2);
    case 'owner': return stringValue(building.owner);
    case 'property': return stringValue(building.property_management);
    case 'leed': return stringValue(building.leed_certification);
  }
}

function wrapText(value: string, maxWidth: number, size = 16): string[] {
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  for (const char of value) {
    const width = (char.codePointAt(0) ?? 0) > 255 ? size : size * 0.58;
    if (line && lineWidth + width > maxWidth) {
      lines.push(line);
      line = '';
      lineWidth = 0;
    }
    line += char;
    lineWidth += width;
  }
  lines.push(line || '—');
  return lines;
}

function linesSvg(value: string, x: number, y: number, maxWidth: number, options?: { size?: number; bold?: boolean; fill?: string }) {
  const size = options?.size ?? 16;
  const lines = wrapText(value, maxWidth, size);
  return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="' + (options?.bold ? 600 : 400) +
    '" fill="' + (options?.fill ?? '#172033') + '">' +
    lines.map((line, index) => '<tspan x="' + x + '" dy="' + (index ? 23 : 0) + '">' + escapeXml(line) + '</tspan>').join('') + '</text>';
}

const subtitle = '现有楼宇采用各自最新收录季度；未来供应的面积为规划数据，租金和空置率不适用。';
const innerMargin = 32;

export function buildComparisonSvg(buildings: ComparisonBuilding[], layout: ComparisonLayout, overrides?: Overrides) {
  if (!buildings.length) throw new Error('请至少选择一栋楼宇');
  const body: string[] = [];
  let y = 148;
  let width: number;

  if (layout === 'rows') {
    const fields = CORE;
    width = fields.reduce((sum, field) => sum + field.width, innerMargin * 2);
    body.push('<rect x="' + innerMargin + '" y="' + y + '" width="' + (width - 2 * innerMargin) + '" height="63" fill="#EDF4FB"/>');
    let x = innerMargin;
    for (const field of fields) {
      body.push(linesSvg(field.label, x + 12, y + 25, field.width - 24, { size: 14, bold: true, fill: '#003E7E' }));
      x += field.width;
    }
    y += 63;
    for (const [index, building] of buildings.entries()) {
      const values = fields.map(field => valueFor(building, field.key, overrides));
      const height = Math.max(55, ...values.map((value, i) => wrapText(value, fields[i].width - 24).length * 23 + 20));
      if (index % 2 === 1) body.push('<rect x="' + innerMargin + '" y="' + y + '" width="' + (width - 2 * innerMargin) + '" height="' + height + '" fill="#F8FAFC"/>');
      let cellX = innerMargin;
      for (let i = 0; i < fields.length; i++) {
        body.push(linesSvg(values[i], cellX + 12, y + 27, fields[i].width - 24, {
          bold: fields[i].key === 'name', fill: fields[i].key === 'rent' ? '#003E7E' : '#172033',
        }));
        cellX += fields[i].width;
      }
      body.push('<path d="M' + innerMargin + ' ' + (y + height) + ' H' + (width - innerMargin) + '" stroke="#E2E8F0"/>');
      y += height;
    }
  } else {
    const groupSize = 5;
    const labelWidth = 235;
    const buildingWidth = 240;
    width = innerMargin * 2 + labelWidth + Math.min(groupSize, buildings.length) * buildingWidth;
    for (let start = 0; start < buildings.length; start += groupSize) {
      const group = buildings.slice(start, start + groupSize);
      const groupNumber = Math.floor(start / groupSize) + 1;
      const groupCount = Math.ceil(buildings.length / groupSize);
      body.push(linesSvg('第 ' + groupNumber + ' / ' + groupCount + ' 组', innerMargin, y + 24, labelWidth, { size: 16, bold: true, fill: '#003E7E' }));
      y += 39;
      const headerHeight = Math.max(68, ...group.map(building => wrapText(nameOf(building), buildingWidth - 24).length * 23 + 25));
      body.push('<rect x="' + innerMargin + '" y="' + y + '" width="' + (labelWidth + group.length * buildingWidth) + '" height="' + headerHeight + '" fill="#EDF4FB"/>');
      body.push(linesSvg('比较指标', innerMargin + 12, y + 27, labelWidth - 24, { size: 15, bold: true, fill: '#003E7E' }));
      for (const [index, building] of group.entries()) {
        body.push(linesSvg(nameOf(building), innerMargin + labelWidth + index * buildingWidth + 12, y + 27, buildingWidth - 24, { size: 16, bold: true, fill: '#003E7E' }));
      }
      y += headerHeight;
      for (const [index, field] of DETAIL.entries()) {
        const values = group.map(building => valueFor(building, field.key, overrides));
        const height = Math.max(52, ...values.map(value => wrapText(value, buildingWidth - 24).length * 23 + 20));
        if (index % 2 === 1) body.push('<rect x="' + innerMargin + '" y="' + y + '" width="' + (labelWidth + group.length * buildingWidth) + '" height="' + height + '" fill="#F8FAFC"/>');
        body.push(linesSvg(field.label, innerMargin + 12, y + 27, labelWidth - 24, { size: 15, bold: true, fill: '#667085' }));
        for (const [buildingIndex, value] of values.entries()) {
          body.push(linesSvg(value, innerMargin + labelWidth + buildingIndex * buildingWidth + 12, y + 27, buildingWidth - 24, {
            fill: field.key === 'rent' ? '#003E7E' : '#172033', bold: field.key === 'rent',
          }));
        }
        body.push('<path d="M' + innerMargin + ' ' + (y + height) + ' H' + (innerMargin + labelWidth + group.length * buildingWidth) + '" stroke="#E2E8F0"/>');
        y += height;
      }
      y += 30;
    }
  }

  const height = y + 90;
  const title = layout === 'rows' ? '北京办公楼项目参数对比' : '北京重点楼宇参数对比';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + ' ' + height + '">' +
    '<rect width="' + width + '" height="' + height + '" fill="#FFFFFF"/>' +
    '<rect width="' + width + '" height="8" fill="#B82034"/>' +
    '<g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif">' +
    '<text x="' + innerMargin + '" y="37" font-size="13" font-weight="700" letter-spacing="2" fill="#B82034">COLLIERS INTELLIGENCE</text>' +
    '<text x="' + innerMargin + '" y="83" font-size="30" font-weight="700" fill="#172033">' + escapeXml(title) + '</text>' +
    '<text x="' + innerMargin + '" y="115" font-size="15" fill="#667085">已选 ' + buildings.length + ' 栋 · 生成日期：' + escapeXml(new Date().toLocaleDateString('zh-CN')) + '</text>' +
    body.join('') +
    '<path d="M' + innerMargin + ' ' + (height - 76) + ' H' + (width - innerMargin) + '" stroke="#D9E0E8"/>' +
    linesSvg(subtitle, innerMargin, height - 48, width - innerMargin * 2, { size: 13, fill: '#667085' }) +
    '<text x="' + innerMargin + '" y="' + (height - 19) + '" font-size="13" fill="#667085">仅供内部业务参考 · 项目数据及口径请以最新正式资料为准</text>' +
    '</g></svg>';
  return { svg, width, height };
}

export async function downloadBuildingComparisonPng(buildings: ComparisonBuilding[], layout: ComparisonLayout, overrides?: Overrides): Promise<void> {
  const { svg, width, height } = buildComparisonSvg(buildings, layout, overrides);
  const scale = Math.min(2, Math.sqrt(32_000_000 / (width * height)));
  if (scale < 1 || width * scale > 16384 || height * scale > 16384) {
    throw new Error('所选项目过多，单张高清图片超出浏览器安全尺寸，请减少勾选数量后重试');
  }
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片渲染失败，请重试'));
      image.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建图片画布');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('PNG 编码失败')), 'image/png',
    ));
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = '北京办公楼项目对比_' + (layout === 'rows' ? '纵向列表' : '横向比较') + '_' + new Date().toISOString().slice(0, 10) + '.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

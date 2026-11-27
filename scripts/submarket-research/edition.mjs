import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { internalResearchMarkers, structuredResearchCopy, submarketIntelligenceSchema } from '../../src/app/map/model/submarketIntelligence.ts';

export const version = '2026-11-27';
const directory = new URL(`../../data/submarket-research/${version}/`, import.meta.url);

function trigrams(value) {
  const characters = Array.from(value.replace(/[\p{P}\p{S}\s]/gu, ''));
  return new Set(characters.slice(2).map((_, index) => characters.slice(index, index + 3).join('')));
}

export function readEdition() {
  const entries = readdirSync(directory).filter(file => file.endsWith('.json')).sort();
  assert.equal(entries.length, 16, '本批研究版应包含 16 个子市场');
  const markets = new Set();
  const signatures = [];
  return entries.map(file => {
    const result = submarketIntelligenceSchema.safeParse(JSON.parse(readFileSync(new URL(file, directory), 'utf8')));
    assert.ok(result.success, `${file}: ${JSON.stringify(result.error?.issues)}`);
    const data = result.data;
    assert.ok(!markets.has(data.market), `重复子市场 ${data.market}`);
    markets.add(data.market);
    assert.equal(data.updatedOn, version);
    assert.ok(data.sources.length >= 2 && data.facts.length >= 2, `缺少独立证据 ${data.market}`);
    assert.ok(!structuredResearchCopy(data).some(text => internalResearchMarkers.test(text)), `客户文案含内部标记 ${data.market}`);
    for (const source of data.sources) {
      const url = new URL(source.url);
      assert.ok(url.hostname.endsWith('.beijing.gov.cn') || url.hostname === 'www.bjsubway.com' ||
        ['www.cbre.com.cn', 'www.jll.cn', 'data.eastmoney.com', 'pdf.savills.asia', 'www.ncsti.gov.cn', 'www.bjdch.gov.cn', 'www.bjhd.gov.cn', 'zyk.bjhd.gov.cn', 'www.bjft.gov.cn', 'www.aiib.org'].includes(url.hostname),
      `${data.market} 来源需要确认其公开发布单位 ${url.hostname}`);
    }
    const signature = trigrams([data.positioning, ...data.observations.map(item => item.body)].join(' '));
    for (const other of signatures) {
      const overlap = [...signature].filter(fragment => other.signature.has(fragment)).length;
      assert.ok(2 * overlap / (signature.size + other.signature.size) < 0.42,
        `区域观点过于相似 ${other.market} / ${data.market}`);
    }
    signatures.push({ signature, market: data.market });
    return data;
  });
}

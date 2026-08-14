import { describe, expect, it } from "vitest";
import { parseCbexBrowserPublication, parseCbexListingHtml } from "../cbexCrawler";

describe("parseCbexListingHtml", () => {
  it("提取公告链接、标题与日期，并去重", () => {
    const html = `
      <li><a href="/xm/fwzl/zspl/detail/1001.html">某办公楼资产处置项目公示</a><span>2026年7月16日</span></li>
      <li><a href="/xm/fwzl/zspl/detail/1001.html">某办公楼资产处置项目公示</a><span>2026年7月16日</span></li>`;
    expect(parseCbexListingHtml(html)).toMatchObject([{ sourceUrl: "https://www.cbex.com.cn/xm/fwzl/zspl/detail/1001.html", title: "某办公楼资产处置项目公示", publishedAt: "2026-07-16" }]);
  });
});

describe("parseCbexBrowserPublication", () => {
  it("uses the project number as the stable key and parses rent fields", () => {
    const item = parseCbexBrowserPublication({ projectNo: "GL2026BJ1001382", sourceUrl: "https://www.cbex.com.cn/xm/fwzl/zspl/202607/t20260716_1483035.html", projectName: "北京市西城区西便门东里13号楼整栋房屋出租", rentText: "6.3元/平方米/天", rentableAreaText: "1250.5平方米", rawText: "公开项目详情" });
    expect(item).toMatchObject({ projectNo: "GL2026BJ1001382", listingPrice: 6.3, priceUnit: "元/平方米/天", rentableArea: 1250.5 });
  });
});

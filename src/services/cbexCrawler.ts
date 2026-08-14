import { createHash } from "node:crypto";

/** 北交所「房屋出租 > 正式披露」公开列表。 */
export const CBEX_LISTING_URL = "https://www.cbex.com.cn/xm/fwzl/zspl/";

export interface CbexPublicationCandidate {
  sourceUrl: string;
  title: string;
  publishedAt: string | null;
  excerpt: string;
  rawContent: string;
  contentHash: string;
}

/** Payload produced from the DOM of a user-visible Safari/Chrome tab.  No HTTP
 * request is made to CBEX by this module: the browser has already completed its
 * normal JavaScript checks before this data reaches the app. */
export interface CbexBrowserPublication {
  projectNo: string;
  sourceUrl: string;
  projectName: string;
  rentText?: string;
  publishedAt?: string | null;
  clickCount?: number | null;
  transferorName?: string | null;
  region?: string | null;
  address?: string | null;
  rentableAreaText?: string | null;
  leaseTerm?: string | null;
  usage?: string | null;
  disclosureEnd?: string | null;
  transactionMethod?: string | null;
  attachments?: string[];
  rawText: string;
}

export interface ParsedCbexBrowserPublication extends CbexBrowserPublication {
  listingPrice: number | null;
  priceUnit: string | null;
  rentableArea: number | null;
  contentHash: string;
}

const numberFrom = (value?: string | null) => {
  const match = value?.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

export function parseCbexBrowserPublication(value: CbexBrowserPublication): ParsedCbexBrowserPublication {
  if (!/^GL\d{4}BJ\d+$/i.test(value.projectNo.trim())) throw new Error("缺失或无效的北交所项目编号");
  if (!/^https:\/\/www\.cbex\.com\.cn\/xm\/fwzl\/zspl\//.test(value.sourceUrl)) throw new Error("非北交所房屋出租正式披露链接");
  const rawText = value.rawText.replace(/\s+/g, " ").trim();
  return {
    ...value,
    projectNo: value.projectNo.trim(), projectName: value.projectName.trim(), rawText,
    listingPrice: numberFrom(value.rentText),
    priceUnit: value.rentText?.replace(/[\d,\.\s]/g, "") || null,
    rentableArea: numberFrom(value.rentableAreaText),
    contentHash: createHash("sha256").update([value.projectNo, value.sourceUrl, rawText].join("\n")).digest("hex"),
  };
}

export class CbexAccessError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message);
    this.name = "CbexAccessError";
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function normalizeText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function toAbsoluteUrl(href: string) {
  try {
    return new URL(href, CBEX_LISTING_URL).toString();
  } catch {
    return null;
  }
}

function findPublishedAt(value: string) {
  const match = value.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function isPublicationLink(url: string, title: string) {
  const path = new URL(url).pathname;
  return title.length >= 6 && title.length <= 180 && (/(detail|content|info|notice|tzgg|gg)/i.test(path) || /公示|处置|转让|挂牌|项目/.test(title));
}

/**
 * 解析公开列表页中的公告链接。页面结构变动时宁可少入库，也不采集导航项；
 * 原始片段会保存，便于后续据真实页面调整专用解析规则。
 */
export function parseCbexListingHtml(html: string): CbexPublicationCandidate[] {
  const unique = new Map<string, CbexPublicationCandidate>();
  const linkPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const sourceUrl = toAbsoluteUrl(match[1]);
    const title = normalizeText(match[2]);
    if (!sourceUrl || !isPublicationLink(sourceUrl, title)) continue;
    const surroundingHtml = html.slice(Math.max(0, match.index! - 500), Math.min(html.length, match.index! + match[0].length + 500));
    const rawContent = normalizeText(surroundingHtml).slice(0, 2_000);
    const contentHash = createHash("sha256").update(`${sourceUrl}\n${rawContent}`).digest("hex");
    unique.set(sourceUrl, { sourceUrl, title, publishedAt: findPublishedAt(rawContent), excerpt: rawContent.slice(0, 500), rawContent, contentHash });
  }
  return [...unique.values()];
}

export async function fetchCbexPublications(fetcher: typeof fetch = fetch) {
  const response = await fetcher(CBEX_LISTING_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const suffix = response.status === 521 ? "站点要求 JavaScript 验证；采集器不会绕过该验证。" : "请稍后重试或检查公开页面是否变更。";
    throw new CbexAccessError(response.status, `北交所房屋出租正式披露页返回 HTTP ${response.status}。${suffix}`);
  }
  const html = await response.text();
  const publications = parseCbexListingHtml(html);
  if (publications.length === 0) throw new Error("北交所房屋出租页面可访问，但未识别到项目链接；可能是页面结构发生变化。");
  return publications;
}

import { z } from "zod";
import { documentTokens } from "@/src/lib/intelligence/knowledge/parser";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { readAvailablePeriods } from "@/src/lib/intelligence/query/availablePeriods";
import { resolveSemanticQuestion } from "@/src/lib/intelligence/query/semanticPlanner";
import { QUESTION_SUBMARKETS } from "@/src/lib/intelligence/query/question";
import { parseQueryPlan } from "@/src/lib/intelligence/query/plan";
import { pitchRpc, type PitchContext } from "../data/store";
import {
  recipeSchema,
  generationPartSchema,
  dynamicParametersSchema,
  type Generation,
} from "../business/protocol";
import { DYNAMIC_CAPABILITIES } from "../business/recipes";
import {
  nlSchema,
  recommendationSchema,
  type NlInput,
  type Recommendation,
} from "./protocol";
const rowSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  title: z.string(),
  kind: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  tags: z.array(z.string()),
  data_as_of: z.string().nullable(),
  language: z.string(),
  service: z.string().nullable(),
  property: z.string().nullable(),
  submarket: z.string().nullable(),
  industry: z.string().nullable(),
  scale: z.string().nullable(),
  occurred_on: z.string().nullable(),
});
export async function recommendAssets(
  ctx: PitchContext,
  query: Recommendation,
) {
  const q = recommendationSchema.parse(query),
    rows = z.array(rowSchema).parse(
      await pitchRpc(ctx, {
        ...q,
        action: "ai_search",
        tokens: documentTokens(q.q),
      }),
    );
  const scored = rows
    .slice(0, 200)
    .map((r) => {
      let score = 0;
      const reasons: string[] = [];
      for (const [key, label, points] of [
        ["city", "同一市场", 20],
        ["service", "相同服务类型", 30],
        ["property", "相同物业类型", 15],
        ["submarket", "同一子市场", 15],
        ["industry", "相同行业", 10],
      ] as const)
        if (q[key] && q[key] === r[key]) {
          score += points;
          reasons.push(label);
        }
      if (q.scale && r.scale && Number(r.scale) > 0) {
        const ratio =
          Math.max(q.scale, Number(r.scale)) /
          Math.min(q.scale, Number(r.scale));
        if (ratio <= 2) {
          score += 10;
          reasons.push("项目体量相近");
        }
      }
      for (const term of [q.q, q.objective, q.stage].filter(
        (s): s is string => !!s,
      ))
        if (
          [r.title, ...r.tags].some((v) =>
            v.toLowerCase().includes(term.toLowerCase()),
          )
        ) {
          score += 8;
          reasons.push("标题或标签匹配");
        }
      if (r.occurred_on) reasons.push("历史案例：" + r.occurred_on);
      if (!reasons.length) reasons.push("已发布、语言及使用范围符合筛选条件");
      return {
        ...r,
        score,
        reasons,
        templateId:
          r.kind === "team"
            ? "team-multiple"
            : r.kind === "case"
              ? "case-portfolio"
              : r.kind === "corporate"
                ? "corporate-overview"
                : r.kind === "research"
                  ? "research-page"
                  : "custom-content",
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.data_as_of ?? "").localeCompare(a.data_as_of ?? "") ||
        a.id.localeCompare(b.id),
    );
  return {
    method: "keyword-and-structured" as const,
    items: scored.slice(0, q.limit),
    hasMore: scored.length > q.limit || rows.length > 200,
    windowLimited: rows.length > 200,
    embedding: false,
  };
}
export type PreparedPitch =
  | {
      status: "ready";
      part: Generation["parts"][number];
      explanation: string;
      modelCalls: 0;
    }
  | { status: "requires_clarification"; message: string; modelCalls: 0 }
  | {
      status: "edit";
      operation: "english" | "shorten" | "export" | "add-analysis";
      message: string;
      modelCalls: 0;
    }
  | { status: "recommend"; query: Recommendation; modelCalls: 0 };
const clarify = (message: string): PreparedPitch => ({
  status: "requires_clarification",
  message,
  modelCalls: 0,
});
/** No chat history inherited. Explicit current selections + trusted metadata only.
 * Unknown suffixes/constraints are rejected by the existing semantic planner. */
export async function preparePitch(
  ctx: PitchContext,
  raw: NlInput,
): Promise<PreparedPitch> {
  const input = nlSchema.parse(raw),
    q = input.question.normalize("NFKC").trim();
  await pitchRpc(ctx, { action: "catalog" });
  if (
    /^(?:将|把)?(?:当前|这[个页张])(?:页面|页)?(?:改成|改为|翻译成|translate.*)(?:英文版?|英语|English)$/i.test(
      q,
    ) ||
    /^translate (?:this|current) (?:page|slide) (?:to|into) english$/i.test(q)
  )
    return {
      status: "edit",
      operation: "english",
      message:
        "选择当前页面的已授权素材，申请英文修订；保留原页，确认草稿后再采用。",
      modelCalls: 0,
    };
  if (
    /^(?:请)?(?:缩短|精简)(?:这页案例|当前页面|这页)(?:的)?(?:文字|内容)?$/.test(
      q,
    ) ||
    /^shorten (?:this|current) (?:page|case|slide)$/i.test(q)
  )
    return {
      status: "edit",
      operation: "shorten",
      message: "选择当前素材的文字修订；原始事实和原页继续保留。",
      modelCalls: 0,
    };
  if (
    /^(?:把|将)?(?:这个|当前)(?:图表|图)(?:导出|生成)(?:成|为)?(?:可编辑)?(?:PPT|PowerPoint)$/i.test(
      q,
    )
  )
    return {
      status: "edit",
      operation: "export",
      message: "使用当前页面导出；原生图表和文本保持可编辑。",
      modelCalls: 0,
    };
  if (/^(?:将|把)当前分析结果加入(?:我的)?Pitch$/i.test(q))
    return {
      status: "edit",
      operation: "add-analysis",
      message:
        "在当前分析结果中选择生成研究页；服务端将重新验证正式数据和导出资格。",
      modelCalls: 0,
    };
  const recommend =
    /^(?:请)?(?:为本次提案)?(?:选择|推荐)([一二三四五六七八九十\d]+)(?:个|份)?(?:适合的)?历史案例[。.!！]?$/.exec(
      q,
    );
  if (recommend)
    return {
      status: "recommend",
      query: recommendationSchema.parse({
        kind: "case",
        language: input.language,
        limit: Math.min(
          10,
          Number(recommend[1]) ||
            "一二三四五六七八九十".indexOf(recommend[1]) + 1,
        ),
      }),
      modelCalls: 0,
    };
  if (
    /^(?:把|将|用)?(?:这几个|选中的?|selected)(?:团队成员|人员)(?:生成|制作|generate)(?:一页|a)?(?:团队介绍|team slide)$/i.test(
      q,
    )
  ) {
    if (!input.assetIds.length) return clarify("请先选择团队成员。");
    return {
      status: "ready",
      part: generationPartSchema.parse({
        mode: "semi-dynamic",
        templateId: "team-multiple",
        assetIds: input.assetIds,
        length: "brief",
        allowFallback: false,
        variant: "standard",
      }),
      explanation: "所选成员按人数自动排版及分页；档案不会被改写。",
      modelCalls: 0,
    };
  }
  const requestedName=q.replace(/^(?:请|帮我)?(?:生成|制作|使用|create|generate)\s*(?:一页)?/i,'').replace(/(?:页面|页)?[。.!！]?$/,'').trim();
  if(requestedName){
    const catalog=z.object({recipes:z.array(recipeSchema)}).parse(await pitchRpc(ctx,{action:'business_catalog'}));
    const selected=catalog.recipes.filter(r=>r.enabled&&[r.id,...Object.values(r.names)].some(name=>name.toLowerCase()===requestedName.toLowerCase()));
    if(selected.length===1){
      if(!input.assetIds.length)return clarify('请先选择此模板所需的已发布素材。');
      const recipe=selected[0];
      if(input.assetIds.length>recipe.maxAssets)return clarify('所选素材超过模板容量，请减少数量。');
      return {status:'ready',part:generationPartSchema.parse({mode:input.assetIds.length>1?'semi-dynamic':'static',templateId:recipe.id,assetIds:input.assetIds,length:'brief',allowFallback:false,variant:'standard'}),explanation:recipe.description,modelCalls:0};
    }
  }
  const comparison =
    /^(?:用|将|把)(?:这[五几些]个|选中的?)(?:楼宇|项目)(?:制作|生成)(?:项目)?对比(?:PPT|页面|页)?$/i.test(
      q,
    );
  const single =
    /^(?:帮我|请)?(?:生成|给我|制作)(?:一页)?(.+?)(?:页面|页|分析)?[。.!！]?$/.exec(
      q,
    );
  if (!comparison && !single)
    return clarify(
      "请说明需要的页面及范围，例如“生成燕莎空置率趋势页面”；复杂条件可在模板中直接配置。",
    );
  if (comparison && input.buildingIds.length < 2)
    return clarify("请选择至少两个真实楼宇。");
  const question =
    single?.[1]
      ?.replace(/^北京(?:写字楼)?市场/, "全部获权楼宇")
      .replace(/^北京写字楼/, "全部获权楼宇") ?? "";
  const vacancy = /空置率|vacancy/i.test(question),
    rent = /租金|rent/i.test(question);
  if (!comparison && !vacancy && !rent)
    return clarify(
      "当前语句未匹配可用的数据模板，请选择模板或说明租金、空置率及市场范围。",
    );
  const authority = await loadDataAuthority(
    ctx.client,
    ctx.identity,
    ctx.signal,
  );
  const submarkets = QUESTION_SUBMARKETS.filter((s) => question.includes(s));
  const scope: {
    inventory: "tracked";
    submarkets?: string[];
    buildingIds?: string[];
  } = {
    inventory: "tracked" as const,
    ...(submarkets.length ? { submarkets } : {}),
    ...(comparison ? { buildingIds: input.buildingIds } : {}),
  };
  // The metadata API uses the exact same metric permissions and source contract.
  const periods = await readAvailablePeriods(
    ctx.client,
    ctx.identity,
    authority,
    scope,
    vacancy ? ["vacantArea", "totalArea"] : ["netEffectiveRent"],
    ctx.signal,
  );
  const latest = periods.periods.at(-1);
  if (!latest) return clarify("当前范围没有可用正式期间。");
  const period = input.period
    ? {
        year: Number(input.period.slice(0, 4)),
        quarter: Number(input.period.at(-1)),
      }
    : latest;
  let start = period,
    end = period,
    templateId: "project-comparison" | "rent-trend" | "vacancy-trend" =
      comparison
        ? "project-comparison"
        : vacancy
          ? "vacancy-trend"
          : "rent-trend";
  if (!comparison) {
    let normalized = question.replaceAll("走势", "趋势");
    if (!/趋势|trend/.test(normalized)) normalized += "趋势";
    // This exact plain-market phrase selects the registered net-effective-rent
    // template. Other rent types/extra conditions still require clarification.
    if (
      new RegExp(
        `^(?:全部获权楼宇|${QUESTION_SUBMARKETS.join("|")})租金趋势$`,
      ).test(normalized)
    )
      normalized = normalized.replace("租金", "净有效租金");
    if (
      !/20\d{2}|19\d{2}|今年|去年|季度|最近|过去|最新|同比|环比/.test(
        normalized,
      )
    ) {
      const index = periods.periods.findIndex(
        (p) => p.year === period.year && p.quarter === period.quarter,
      );
      if (index < 0)
        return clarify("项目默认季度在当前范围不可用，请选择有效正式期间。");
      const first = periods.periods[Math.max(0, index - 3)];
      normalized = `${first.year}Q${first.quarter}至${period.year}Q${period.quarter}${normalized}`;
    }
    const resolution = resolveSemanticQuestion({
      question: normalized,
      availablePeriods: periods.periods,
      now: new Date(),
    });
    if (resolution.kind !== "plan")
      return clarify(resolution.clarification.message);
    if (resolution.plan.operation !== "trend")
      return clarify(
        "该问题包含当前趋势模板不能完整表达的条件，请直接选择相应模板。",
      );
    // Reparse for the same strict formal plan contract, not model-generated SQL.
    const plan = parseQueryPlan(resolution.plan);
    if (plan.operation !== "trend") return clarify("需要明确趋势范围。");
    if (plan.scope.submarkets) scope.submarkets = plan.scope.submarkets;
    start = plan.start;
    end = plan.end;
    templateId = plan.metric === "vacancy" ? "vacancy-trend" : "rent-trend";
  }
  if (
    !DYNAMIC_CAPABILITIES.some(
      (t) => t.id === templateId && t.status === "available",
    )
  )
    return clarify("此模板暂不可用。");
  const parameters = dynamicParametersSchema.parse({
    templateId,
    buildingIds: comparison ? input.buildingIds : [],
    submarkets: scope.submarkets ?? [],
    inventory: scope.inventory,
    period,
    start,
    end,
    fields: comparison ? ["height", "floors", "netEffectiveRent"] : [],
    direction: "desc",
    chart: comparison ? "table" : "line",
    from: "2000-01-01",
    to: "2000-01-01",
    leaseSource: "combined",
    measure: "count",
  });
  return {
    status: "ready",
    part: { mode: "dynamic", parameters },
    explanation: comparison
      ? "使用所选真实楼宇；生成时复核各指标权限。"
      : `正式季度 ${start.year} Q${start.quarter}—${end.year} Q${end.quarter}；${templateId === "rent-trend" ? "净有效租金，按有效面积加权。" : "按有效空置面积／总面积统计。"}`,
    modelCalls: 0,
  };
}
export async function suggestOutline(ctx: PitchContext, query: Recommendation) {
  const sections = [];
  for (const [kind, title] of [
    ["corporate", "公司介绍"],
    ["team", "核心团队"],
    ["case", "代表案例"],
    ["research", "市场研究"],
  ] as const) {
    const found = await recommendAssets(ctx, {
      ...query,
      kind,
      limit: kind === "case" ? 3 : kind === "team" ? 6 : 1,
    });
    if (found.items.length)
      sections.push({
        id: crypto.randomUUID(),
        title,
        part: generationPartSchema.parse({
          mode: found.items.length === 1 ? "static" : "semi-dynamic",
          templateId: found.items[0].templateId,
          assetIds: found.items.map((a) => a.id),
          length: "brief",
          allowFallback: false,
          variant: "standard",
        }),
      });
  }
  return {
    sections,
    missing: [
      "目标项目与竞品分析请选择项目及正式期间",
      "服务策略与执行计划需要经确认素材",
    ],
    confirmed: false,
    modelCalls: 0,
  };
}

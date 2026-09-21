import type { TableConfig, ColDef } from "./types";
import { supabase } from "@/src/services/supabaseClient";

// ─── 共享列定义（减少重复，同一类表共用）──────────────────────────────────────

/** 建筑基础信息三表共享列（stock/future/entering） */
const BUILDING_COLS: ColDef[] = [
  { key: "name", label: "项目名称", type: "text", width: "w-40", masked: true, pinned: 'left', required: true },
  { key: "former_names", label: "曾用名", type: "tags", width: "w-16" },
  { key: "completion_year", label: "入市时间", type: "text", width: "w-24" },
  { key: "system_entry_date", label: "加入系统时间", type: "text", width: "w-28", readOnly: true },
  { key: "submarket", label: "子市场", type: "text", width: "w-28" },
  { key: "grade", label: "楼宇等级", type: "text", width: "w-20", exactFilter: true },
  { key: "city", label: "城市", type: "text", width: "w-16" },
  { key: "district", label: "行政区", type: "text", width: "w-20" },
  { key: "owner", label: "业主", type: "text", width: "w-32", masked: true },
  { key: "property_management", label: "物业公司", type: "text", width: "w-32", masked: true },
  { key: "contact_phone", label: "联系方式", type: "text", width: "w-32", masked: true },
  { key: "location_lng", label: "经度", type: "number", width: "w-28" },
  { key: "location_lat", label: "纬度", type: "number", width: "w-28" },
  { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24" },
  { key: "is_active", label: "启用状态", type: "boolean", width: "w-20" },
  { key: "tracking_scope", label: "跟踪范围", type: "text", width: "w-24", readOnly: true },
  { key: "is_entered_market", label: "是否已入市", type: "boolean", width: "w-24" },
  { key: "notes", label: "备注", type: "textarea", width: "w-48" },
];

/** 数据表共享指标列（building_metrics / building_current_data 共有） */
const DATA_METRIC_COLS: ColDef[] = [
  { key: "asking_rent", label: "报价租金", type: "number", width: "w-20" },
  { key: "management_fee", label: "物业费", type: "number", width: "w-20" },
  { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
  { key: "rent_free_period", label: "免租期（三年租约）", type: "number", width: "w-16" },
  { key: "net_effective_rent", label: "净有效租金", type: "number", width: "w-24", decimals: 1 },
  { key: "rent_qoq_change", label: "租金环比变化", type: "number", width: "w-24", readOnly: true, decimals: 2, suffix: "%" },
  { key: "rent_yoy_change", label: "租金同比变化", type: "number", width: "w-24", readOnly: true, decimals: 2, suffix: "%" },
  { key: "vacant_area", label: "空置面积", type: "number", width: "w-20" },
  { key: "vacant_area_qoq_change", label: "空置面积季度变化", type: "number", width: "w-28", readOnly: true, decimals: 1 },
  { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20", decimals: 1, suffix: "%" },
];

// ─── 核心表配置（手写中文标签、宽度、脱敏）────────────────────────────────────

export const CORE_TABLE_CONFIGS: TableConfig[] = [
  // ── 0. 项目台账（buildings + building_metrics + building_current_data 联查，只读）─
  {
    table: "project_ledger",
    label: "项目台账",
    hideAdd: true,
    hideUpload: true,
    hideTemplate: true,
    hideRawExport: false,
    customFetch: async () => {
      // ── sessionStorage 缓存（台账数据量大，缓存后再次进入瞬间加载）──
      const CACHE_KEY = '__project_ledger_cache_v4';
      const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (Date.now() - cached.t < CACHE_TTL) return cached.d as any[];
        }
      } catch {}

      // 翻页拉全量（支持 >1000 行）
      // 注意：Supabase query builder 的 .range() 会 mutate builder，不能对同一个 builder 并行调用
      async function fetchAll(makeQuery: () => any) {
        const PAGE = 1000;
        const { data: page1, error: err1 } = await makeQuery().range(0, PAGE - 1);
        if (err1) throw err1;
        if (!page1 || page1.length < PAGE) return page1 || [];

        // 用独立 builder 并行拉后续页
        const [r2, r3] = await Promise.all([
          makeQuery().range(PAGE, PAGE * 2 - 1),
          makeQuery().range(PAGE * 2, PAGE * 3 - 1),
        ]);
        let all = [...(page1 || []), ...(r2.data || []), ...(r3.data || [])];
        if (r3.data && r3.data.length >= PAGE) {
          let offset = PAGE * 3;
          while (true) {
            const { data, error } = await makeQuery().range(offset, offset + PAGE - 1);
            if (error) throw error;
            all = all.concat(data || []);
            if ((data || []).length < PAGE) break;
            offset += PAGE;
          }
        }
        return all;
      }

      // 并行获取三张表（建筑全量，不限制 is_active）
      const [bRes, metrics, currentData] = await Promise.all([
        supabase.from("buildings").select("id,name,former_names,completion_year,system_entry_date,submarket,grade,city,district,owner,property_management,contact_phone,location_lng,location_lat,leed_certification,leasable_area,is_active,tracking_scope,is_entered_market,notes").limit(3000),
        fetchAll(() => supabase.from("building_metrics").select("*").order("record_year", { ascending: false }).order("record_quarter", { ascending: false })),
        fetchAll(() => supabase.from("building_current_data").select("*")),
      ]);

      if (bRes.error) throw new Error(`buildings 查询失败: ${bRes.error.message}`);
      const buildings = bRes.data || [];
      const buildingMap = new Map<string, any>();
      for (const b of buildings) buildingMap.set(b.id, b);

      // 季度 → 名义日期映射（用于统一比较季度数据和最新动态数据的时间先后）
      const Q_END_DATES: Record<number, string> = { 1: '-03-30', 2: '-06-30', 3: '-09-30', 4: '-12-30' };

      const result: any[] = [];

      // building_metrics 每一行 → 台账一行
      for (const m of metrics) {
        const b = buildingMap.get(m.building_id);
        if (!b) continue;
        result.push({
          id: m.id,
          building_id: b.id,
          source_type: "季度填报",
          data_period: `${m.record_year}Q${m.record_quarter}`,
          // BUILDING_COLS（18列，顺序与存量/未来/待加入三表一致）
          name: b.name,
          former_names: b.former_names,
          completion_year: b.completion_year,
          system_entry_date: b.system_entry_date,
          submarket: b.submarket,
          grade: b.grade,
          city: b.city,
          district: b.district,
          owner: b.owner,
          property_management: b.property_management,
          contact_phone: b.contact_phone,
          location_lng: b.location_lng,
          location_lat: b.location_lat,
          leed_certification: b.leed_certification,
          leasable_area: b.leasable_area,
          is_active: b.is_active,
          tracking_scope: b.tracking_scope,
          is_entered_market: b.is_entered_market,
          notes: b.notes,
          // building_metrics 专属
          is_locked: m.is_locked,
          metrics_updated_at: m.updated_at,
          // DATA_METRIC_COLS（按 building_metrics 列顺序）
          total_area: m.total_area,
          asking_rent: m.asking_rent,
          management_fee: m.management_fee,
          face_rent: m.face_rent,
          rent_free_period: m.rent_free_period,
          net_effective_rent: m.net_effective_rent,
          rent_qoq_change: m.rent_qoq_change,
          rent_yoy_change: m.rent_yoy_change,
          vacant_area: m.vacant_area,
          vacant_area_qoq_change: m.vacant_area_qoq_change,
          vacancy_rate: m.vacancy_rate,
          // building_current_data 专属 → null（季报无此数据）
          data_source: null,
          source_detail: null,
          updated_by: null,
          // 排序辅助（hidden）
          sort_date: (m.record_year != null && Q_END_DATES[m.record_quarter]) ? `${m.record_year}${Q_END_DATES[m.record_quarter]}` : null,
        });
      }

      // building_current_data 每一行 → 台账一行
      for (const c of currentData) {
        const b = buildingMap.get(c.building_id);
        if (!b) continue;
        result.push({
          id: `cd_${c.building_id}`,
          building_id: b.id,
          source_type: "最新动态",
          data_period: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : "—",
          // BUILDING_COLS（18列，顺序与存量/未来/待加入三表一致）
          name: b.name,
          former_names: b.former_names,
          completion_year: b.completion_year,
          system_entry_date: b.system_entry_date,
          submarket: b.submarket,
          grade: b.grade,
          city: b.city,
          district: b.district,
          owner: b.owner,
          property_management: b.property_management,
          contact_phone: b.contact_phone,
          location_lng: b.location_lng,
          location_lat: b.location_lat,
          leed_certification: b.leed_certification,
          leasable_area: b.leasable_area,
          is_active: b.is_active,
          tracking_scope: b.tracking_scope,
          is_entered_market: b.is_entered_market,
          notes: b.notes,
          // building_metrics 专属 → null（动态无此数据）
          is_locked: null,
          metrics_updated_at: null,
          // DATA_METRIC_COLS（按 building_metrics 列顺序）
          total_area: null,
          asking_rent: c.asking_rent,
          management_fee: c.management_fee,
          face_rent: c.face_rent,
          rent_free_period: c.rent_free_period,
          net_effective_rent: c.net_effective_rent,
          rent_qoq_change: null,
          rent_yoy_change: null,
          vacant_area: c.vacant_area,
          vacant_area_qoq_change: null,
          vacancy_rate: c.vacancy_rate,
          // building_current_data 专属
          data_source: c.data_source,
          source_detail: c.source_detail,
          updated_by: c.updated_by,
          // 排序辅助（hidden）
          sort_date: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : null,
        });
      }

      // 写入缓存
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ d: result, t: Date.now() }));
      } catch {}

      return result;
    },
    cols: [
      // ── Hidden ──
      { key: "id", label: "ID", type: "text", readOnly: true, width: "w-28", hidden: true },
      { key: "building_id", label: "楼宇ID", type: "text", readOnly: true, width: "w-28", hidden: true },
      // ── 来源标识（拼接生成）──
      { key: "source_type", label: "来源", type: "text", width: "w-20", readOnly: true },
      { key: "data_period", label: "数据时间", type: "text", width: "w-24", readOnly: true },
      // ── BUILDING_COLS（18列，顺序与存量/未来/待加入三表完全一致）──
      { key: "name", label: "项目名称", type: "text", width: "w-40", readOnly: true, masked: true, pinned: 'left' },
      { key: "former_names", label: "曾用名", type: "tags", width: "w-16", readOnly: true },
      { key: "completion_year", label: "入市时间", type: "text", width: "w-24", readOnly: true },
      { key: "system_entry_date", label: "加入系统时间", type: "text", width: "w-28", readOnly: true },
      { key: "submarket", label: "子市场", type: "text", width: "w-28", readOnly: true },
      { key: "grade", label: "楼宇等级", type: "text", width: "w-20", readOnly: true, exactFilter: true },
      { key: "city", label: "城市", type: "text", width: "w-16", readOnly: true },
      { key: "district", label: "行政区", type: "text", width: "w-20", readOnly: true },
      { key: "owner", label: "业主", type: "text", width: "w-32", readOnly: true, masked: true },
      { key: "property_management", label: "物业公司", type: "text", width: "w-32", readOnly: true, masked: true },
      { key: "contact_phone", label: "联系方式", type: "text", width: "w-32", readOnly: true, masked: true },
      { key: "location_lng", label: "经度", type: "number", width: "w-28", readOnly: true },
      { key: "location_lat", label: "纬度", type: "number", width: "w-28", readOnly: true },
      { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24", readOnly: true },
      { key: "leasable_area", label: "可租赁面积", type: "number", width: "w-24", readOnly: true },
      { key: "is_active", label: "启用状态", type: "boolean", width: "w-20", readOnly: true },
      { key: "tracking_scope", label: "跟踪范围", type: "text", width: "w-24", readOnly: true },
      { key: "is_entered_market", label: "是否已入市", type: "boolean", width: "w-24", readOnly: true },
      { key: "notes", label: "备注", type: "textarea", width: "w-48", readOnly: true },
      // ── building_metrics 专属 ──
      { key: "is_locked", label: "已锁定", type: "boolean", width: "w-16", readOnly: true },
      { key: "metrics_updated_at", label: "季度最后修改", type: "date", width: "w-28", readOnly: true },
      // ── DATA_METRIC_COLS（11列，按 building_metrics 列顺序）──
      { key: "total_area", label: "总面积", type: "number", width: "w-24", readOnly: true },
      { key: "asking_rent", label: "报价租金", type: "number", width: "w-20", readOnly: true },
      { key: "management_fee", label: "物业费", type: "number", width: "w-20", readOnly: true },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20", readOnly: true },
      { key: "rent_free_period", label: "免租期（三年租约）", type: "number", width: "w-16", readOnly: true },
      { key: "net_effective_rent", label: "净有效租金", type: "number", width: "w-24", readOnly: true, decimals: 1 },
      { key: "rent_qoq_change", label: "租金环比变化", type: "number", width: "w-24", readOnly: true, decimals: 2, suffix: "%" },
      { key: "rent_yoy_change", label: "租金同比变化", type: "number", width: "w-24", readOnly: true, decimals: 2, suffix: "%" },
      { key: "vacant_area", label: "空置面积", type: "number", width: "w-20", readOnly: true },
      { key: "vacant_area_qoq_change", label: "空置面积季度变化", type: "number", width: "w-28", readOnly: true, decimals: 1 },
      { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20", readOnly: true, decimals: 1, suffix: "%" },
      // ── building_current_data 专属 ──
      { key: "data_source", label: "数据来源", type: "text", width: "w-24", readOnly: true },
      { key: "source_detail", label: "来源详情", type: "text", width: "w-32", readOnly: true },
      { key: "updated_by", label: "最新动态更新人", type: "text", width: "w-24", readOnly: true },
      // ── Hidden ──
      { key: "sort_date", label: "名义日期", type: "text", width: "w-28", readOnly: true, hidden: true },
    ],
  },
  // ── 1a. buildings（存量 stock）──────────────────────────────────────────
  {
    table: "buildings",
    label: "存量项目基础信息",
    group: "项目基础信息",
    emoji: "",
    orderBy: "name",
    filterField: "project_type",
    filterValue: "stock",
    cols: BUILDING_COLS,
    uploadMatchKeys: ["name"],
    matchFormerNames: "former_names",
    uploadDescription: "按「项目名称」匹配。数据库中已存在同名项目时，只更新 Excel 中实际填写的字段；空白字段保留原值。不存在同名项目时新增，并自动设为存量项目。",
  },
  // ── 1b. buildings（未来供应 future）─────────────────────────────────────
  {
    table: "buildings",
    label: "未来新增供应",
    group: "项目基础信息",
    emoji: "",
    orderBy: "completion_year",
    filterField: "project_type",
    filterValue: "future",
    cols: BUILDING_COLS,
    uploadMatchKeys: ["name"],
    matchFormerNames: "former_names",
    uploadDescription: "按「项目名称」匹配。数据库中已存在同名项目时，只更新 Excel 中实际填写的字段；空白字段保留原值。不存在同名项目时新增，并自动设为未来供应。",
    specialActions: [
      {
        key: 'convert_to_stock',
        label: '→ 转为存量',
        condition: () => true,
        style: 'primary',
        handler: async (row, ctx) => {
          const name = row.name || '(未命名)'
          if (!confirm(`确认将「${name}」转为存量项目？\n\n将自动更新以下字段：\n  · 项目类型：future → stock\n  · 启用状态：强制启用\n  · 是否已入市：是\n\n此操作不可撤销，但可在数据库中手动改回。`)) return

          const { error } = await supabase
            .from('buildings')
            .update({
              project_type: 'stock',
              tracking_scope: 'tracked',
              is_active: true,
              is_entered_market: true,
            })
            .eq('id', row.id)

          if (error) throw error

          try { sessionStorage.removeItem('__project_ledger_cache_v4') } catch {}
          ctx.showToast(`「${name}」已转为存量项目`, true)
          await ctx.fetchRows()
        },
      },
    ],
  },
  // ── 1c. buildings（待加入存量 entering）────────────────────────────────
  {
    table: "buildings",
    label: "待加入存量",
    group: "项目基础信息",
    emoji: "",
    orderBy: "name",
    filterField: "project_type",
    filterValue: "entering",
    cols: BUILDING_COLS,
    uploadMatchKeys: ["name"],
    matchFormerNames: "former_names",
    uploadDescription: "按「项目名称」匹配。数据库中已存在同名项目时，只更新 Excel 中实际填写的字段；空白字段保留原值。不存在同名项目时新增，并自动设为待加入存量。",
    specialActions: [
      {
        key: 'convert_to_stock',
        label: '→ 转为存量',
        condition: () => true,
        style: 'primary',
        handler: async (row, ctx) => {
          const name = row.name || '(未命名)'
          if (!confirm(`确认将「${name}」转为存量项目？\n\n将自动更新以下字段：\n  · 项目类型：entering → stock\n  · 启用状态：强制启用\n  · 是否已入市：是\n\n此操作不可撤销，但可在数据库中手动改回。`)) return

          const { error } = await supabase
            .from('buildings')
            .update({
              project_type: 'stock',
              tracking_scope: 'tracked',
              is_active: true,
              is_entered_market: true,
            })
            .eq('id', row.id)

          if (error) throw error

          try { sessionStorage.removeItem('__project_ledger_cache_v4') } catch {}
          ctx.showToast(`「${name}」已转为存量项目`, true)
          await ctx.fetchRows()
        },
      },
    ],
  },

  // ── 1d. buildings（历史参考实体 reference）──────────────────────────────
  {
    table: "buildings",
    label: "历史参考实体",
    group: "项目基础信息",
    emoji: "",
    orderBy: "name",
    filterField: "project_type",
    filterValue: "reference",
    cols: BUILDING_COLS,
    hideAdd: true,
    hideUpload: true,
    hideTemplate: true,
    hideRawExport: false,
  },

  // ── 2. building_metrics ───────────────────────────────────────────────────
  {
    table: "building_metrics",
    label: "季度更新数据",
    group: "数据更新",
    emoji: "",
    orderBy: [
      { col: "record_year", asc: false },
      { col: "record_quarter", asc: false },
    ],
    cols: [
      { key: "id", label: "ID", type: "text", readOnly: true, width: "w-28", hidden: true },
      {
        key: "building_id",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
        foreignKey: "buildings",
        pinned: 'left',
      },
      { key: "record_year", label: "数据时间", type: "number", width: "w-16", noThousandSeparator: true, required: true },
      { key: "record_quarter", label: "季度", type: "number", width: "w-16", required: true },
      { key: "total_area", label: "总面积", type: "number", width: "w-24" },
      {
        key: "_submarket",
        label: "子市场",
        type: "text",
        width: "w-28",
        readOnly: true,
        sourceKey: "building_id",
        foreignKey: "building_submarkets",
      },
      {
        key: "_grade",
        label: "等级",
        type: "text",
        width: "w-16",
        readOnly: true,
        sourceKey: "building_id",
        foreignKey: "building_grades",
      },
      {
        key: "is_locked",
        label: "已锁定",
        type: "boolean",
        width: "w-16",
        readOnly: true,
      },
      {
        key: "updated_at",
        label: "最后修改",
        type: "date",
        width: "w-28",
        readOnly: true,
      },
      ...DATA_METRIC_COLS,
    ],
    uploadMatchKeys: ["building_id", "record_year", "record_quarter"],
    uploadDescription: "按「项目名称 + 年份 + 季度」组合匹配。已存在时只更新实际填写的字段，空白字段保留原值；不存在时新增。上传成功后，该批次涉及的季度数据将自动锁定。",
    showInactiveFilter: true,
    statsMode: {
      sumCols: ["total_area", "vacant_area"],
      weightedAvgCols: [
        { valueCol: "net_effective_rent", weightCol: "total_area", label: "净有效租金(加权)" },
      ],
      derivedCols: [
        { label: "空置率", decimals: 1, suffix: '%', formula: sums => sums.total_area > 0 ? (sums.vacant_area / sums.total_area) * 100 : 0 },
      ],
    },
  },

  // ── 3. building_current_data ────────────────────────────────────────────────
  {
    table: "building_current_data",
    label: "实时动态数据",
    group: "数据更新",
    emoji: "",
    orderBy: "updated_at",
    cols: [
      { key: "building_id", label: "项目名称", type: "text", width: "w-40", masked: true, foreignKey: "buildings", pinned: 'left', required: true },
      { key: "updated_at", label: "数据时间", type: "date", readOnly: true, width: "w-28" },
      { key: "leasable_area", label: "可租赁面积", type: "number", width: "w-24" },
      { key: "asking_rent", label: "报价租金", type: "number", width: "w-20" },
      { key: "management_fee", label: "物业费", type: "number", width: "w-20" },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
      { key: "rent_free_period", label: "免租期（三年租约）", type: "number", width: "w-16" },
      { key: "net_effective_rent", label: "净有效租金", type: "number", width: "w-24", decimals: 1 },
      { key: "vacant_area", label: "空置面积", type: "number", width: "w-20" },
      { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20", decimals: 1, suffix: "%" },
      { key: "data_source", label: "数据来源", type: "text", width: "w-24" },
      { key: "source_detail", label: "来源详情", type: "text", width: "w-32" },
      { key: "updated_by", label: "更新人", type: "text", readOnly: true, width: "w-24", foreignKey: "user_roles" },
    ],
    uploadMatchKeys: ["building_id"],
    uploadDescription: "按「项目名称」匹配。已存在时只更新实际填写的字段，空白字段保留原值；不存在时新增。",
  },

  // ── 4. lease_transactions ─────────────────────────────────────────────────
  {
    table: "lease_transactions",
    label: "租赁成交",
    emoji: "",
    orderBy: "created_at",
    cols: [
      {
        key: "id",
        label: "ID",
        type: "text",
        readOnly: true,
        width: "w-28",
        hidden: true,
      },
      {
        key: "company",
        label: "企业名称",
        type: "text",
        width: "w-32",
        masked: true,
        pinned: 'left',
      },
      {
        key: "suspected_company_fullname",
        label: "疑似全称",
        type: "text",
        width: "w-40",
        masked: true,
      },
      {
        key: "enterprise_type",
        label: "企业类型",
        type: "text",
        width: "w-20",
      },
      { key: "industry", label: "行业", type: "text", width: "w-20" },
      { key: "sub_industry", label: "子行业", type: "text", width: "w-20" },
      { key: "demand_type", label: "需求类型", type: "text", width: "w-16" },
      {
        key: "new_building",
        label: "新楼宇",
        type: "text",
        width: "w-32",
        masked: true,
      },
      { key: "sub_market", label: "子市场", type: "text", width: "w-20" },
      { key: "district", label: "行政区", type: "text", width: "w-16" },
      { key: "building_grade", label: "楼宇等级", type: "text", width: "w-16" },
      { key: "floor_info", label: "楼层信息", type: "text", width: "w-20" },
      { key: "floor", label: "楼层", type: "text", width: "w-16" },
      { key: "old_address", label: "原地址", type: "text", width: "w-28" },
      { key: "old_sub_market", label: "原子市场", type: "text", width: "w-20" },
      {
        key: "old_building_grade",
        label: "原楼宇等级",
        type: "text",
        width: "w-16",
      },
      { key: "area_sqm", label: "面积(㎡)", type: "number", width: "w-20" },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
      {
        key: "is_face_rent_estimated",
        label: "表面租金预估",
        type: "boolean",
        width: "w-16",
      },
      {
        key: "effective_rent",
        label: "有效租金",
        type: "number",
        width: "w-20",
      },
      {
        key: "is_effective_rent_estimated",
        label: "有效租金预估",
        type: "boolean",
        width: "w-16",
      },
      {
        key: "lease_term_months",
        label: "租期(月)",
        type: "number",
        width: "w-16",
      },
      {
        key: "fit_out_months",
        label: "装修期(月)",
        type: "number",
        width: "w-16",
      },
      {
        key: "rent_free_months",
        label: "免租期(月)",
        type: "number",
        width: "w-16",
      },
      {
        key: "relocation_area_change",
        label: "搬迁面积变化",
        type: "text",
        width: "w-24",
      },
      {
        key: "transaction_date",
        label: "成交日期",
        type: "date",
        width: "w-24",
      },
      {
        key: "transaction_year",
        label: "成交年份",
        type: "number",
        width: "w-16",
        noThousandSeparator: true,
      },
      {
        key: "transaction_quarter",
        label: "成交季度",
        type: "text",
        width: "w-16",
      },
      { key: "remarks", label: "备注", type: "textarea", width: "w-48" },
      {
        key: "data_source",
        label: "数据来源",
        type: "text",
        width: "w-20",
        readOnly: true,
      },
      {
        key: "submitter_id",
        label: "提交者ID",
        type: "text",
        width: "w-28",
        hidden: true,
      },
      {
        key: "submitter_name",
        label: "提交者",
        type: "text",
        width: "w-20",
        readOnly: true,
      },
      {
        key: "created_at",
        label: "创建时间",
        type: "date",
        readOnly: true,
        width: "w-28",
        hidden: true,
      },
      {
        key: "updated_at",
        label: "更新时间",
        type: "date",
        readOnly: true,
        width: "w-28",
        hidden: true,
      },
    ],
    uploadMatchKeys: ["company", "new_building", "area_sqm"],
    uploadDescription: "按「企业名称 + 新楼宇 + 面积」组合匹配。已存在时只更新实际填写的字段，空白字段保留原值；不存在时新增。",
  },


];

// ─── 用户管理表配置 ──────────────────────────────────────────────────────────

export const USER_ROLES_CONFIG: TableConfig = {
  table: "user_roles",
  label: "用户列表",
  orderBy: "created_at",
  cols: [
    {
      key: "user_id",
      label: "用户ID",
      type: "text",
      readOnly: true,
      width: "w-40",
      masked: true,
      hidden: true,
    },
    { key: "role", label: "角色", type: "text", width: "w-20" },
    { key: "chinese_name", label: "中文名", type: "text", width: "w-24" },
    { key: "full_name", label: "英文名", type: "text", width: "w-28" },
    {
      key: "email",
      label: "邮箱",
      type: "text",
      width: "w-40",
      required: true,
    },
    {
      key: "phone",
      label: "电话",
      type: "text",
      width: "w-28",
      required: true,
    },
    { key: "gender", label: "性别", type: "text", width: "w-12" },
    { key: "title", label: "职位", type: "text", width: "w-24" },
    { key: "internal_number", label: "分机号", type: "text", width: "w-16" },
    {
      key: "session_id",
      label: "会话ID",
      type: "text",
      readOnly: true,
      width: "w-40",
      hidden: true,
    },
    {
      key: "created_at",
      label: "创建时间",
      type: "date",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
  ],
};

// ─── 填报管理表配置 ──────────────────────────────────────────────────────────

export const ASSIGNMENTS_CONFIG: TableConfig = {
  table: "building_assignments",
  label: "任务分配",
  orderBy: "created_at",
  cols: [
    {
      key: "id",
      label: "ID",
      type: "text",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    {
      key: "building_id",
      label: "楼宇ID",
      type: "text",
      width: "w-40",
      hidden: true,
      foreignKey: "buildings",
    },
    {
      key: "grade",
      label: "楼宇等级",
      type: "text",
      width: "w-28",
      readOnly: true,
      displayMap: { A: "甲级", P: "甲级", B: "乙级", BP: "产业园" },
    },
    {
      key: "submarket",
      label: "子市场",
      type: "text",
      width: "w-28",
      readOnly: true,
    },
    {
      key: "project_name",
      label: "项目名称",
      type: "text",
      width: "w-40",
      readOnly: true,
      pinned: 'left',
    },
    {
      key: "user_id",
      label: "填写人",
      type: "text",
      width: "w-40",
      foreignKey: "user_roles",
    },
    {
      key: "user_name",
      label: "填写人姓名",
      type: "text",
      width: "w-28",
      readOnly: true,
      hidden: true,
    },
  ],
  uploadMatchKeys: ["building_id"],
  uploadDescription: "按「项目名称」匹配。已存在则更新填写人，不存在则新增一条分配记录。项目名称为必填项。",
};

export const SUBMISSIONS_CONFIG: TableConfig = {
  table: "quarterly_submissions",
  label: "季度填报数据",
  orderBy: "created_at",
  supportsHistory: true,
  viewMode: {
    enabled: true,
    views: [
      {
        key: "latest",
        label: "最新数据",
        table: "view_latest_quarterly_submissions",
      },
      { key: "all", label: "全部历史", table: "quarterly_submissions" },
    ],
  },
  cols: [
    {
      key: "id",
      label: "ID",
      type: "text",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    {
      key: "building_id",
      label: "项目名称",
      type: "text",
      width: "w-40",
      masked: true,
      foreignKey: "buildings",
      pinned: 'left',
    },
    {
      key: "user_id",
      label: "用户ID",
      type: "text",
      width: "w-40",
      hidden: true,
      foreignKey: "user_roles",
    },
    {
      key: "user_name",
      label: "填写人",
      type: "text",
      width: "w-28",
      readOnly: true,
    },
    { key: "record_year", label: "年份", type: "number", width: "w-16", noThousandSeparator: true },
    { key: "record_quarter", label: "季度", type: "number", width: "w-16" },
    { key: "total_area", label: "总面积", type: "number", width: "w-24" },
    { key: "asking_rent", label: "报价租金", type: "number", width: "w-20" },
    { key: "management_fee", label: "物业费", type: "number", width: "w-20" },
    { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
    { key: "rent_free_period", label: "免租期", type: "number", width: "w-16" },
    {
      key: "net_effective_rent",
      label: "净有效租金",
      type: "number",
      width: "w-24",
    },
    { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20", decimals: 3 },
    { key: "vacant_area", label: "空置面积", type: "number", width: "w-20" },
    { key: "owner", label: "业主", type: "text", width: "w-32", masked: true },
    {
      key: "property_management",
      label: "物业",
      type: "text",
      width: "w-32",
      masked: true,
    },
    { key: "notes", label: "备注", type: "textarea", width: "w-48" },
    {
      key: "created_at",
      label: "创建时间",
      type: "date",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    {
      key: "updated_at",
      label: "更新时间",
      type: "date",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
  ],
  uploadMatchKeys: ["building_id", "record_year", "record_quarter"],
  uploadDescription: "按「项目名称 + 年份 + 季度」组合匹配。已存在时只更新实际填写的字段，空白字段保留原值；不存在时新增。用于修正填报数据或补录历史数据。",
};

export const QUARTERLY_UPDATES_CONFIG: TableConfig = {
  table: "quarterly_updates",
  label: "填报记录",
  orderBy: "created_at",
  cols: [
    {
      key: "id",
      label: "ID",
      type: "text",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    { key: "user_name", label: "用户", type: "text", width: "w-28" },
    { key: "tab", label: "标签", type: "text", width: "w-20" },
    {
      key: "project_name",
      label: "项目名称",
      type: "text",
      width: "w-40",
      masked: true,
      pinned: 'left',
    },
    {
      key: "payload",
      label: "数据",
      type: "jsonb",
      readOnly: true,
      width: "w-48",
    },
    {
      key: "created_at",
      label: "创建时间",
      type: "date",
      readOnly: true,
      width: "w-28",
    },
  ],
};

export const UPDATE_DRAFTS_CONFIG: TableConfig = {
  table: "update_drafts",
  label: "草稿管理",
  orderBy: "updated_at",
  cols: [
    {
      key: "id",
      label: "ID",
      type: "text",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    { key: "user_name", label: "用户", type: "text", width: "w-28" },
    { key: "tab", label: "标签", type: "text", width: "w-20" },
    { key: "draft_data", label: "草稿数据", type: "jsonb", width: "w-48" },
    {
      key: "updated_at",
      label: "更新时间",
      type: "date",
      readOnly: true,
      width: "w-28",
    },
  ],
};

export const FUTURE_SUPPLY_ASSIGNMENTS_CONFIG: TableConfig = {
  table: "future_supply_assignments",
  label: "未来供应分配",
  orderBy: "created_at",
  cols: [
    {
      key: "id",
      label: "ID",
      type: "text",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
    {
      key: "future_supply_id",
      label: "未来供应楼宇",
      type: "text",
      width: "w-40",
      foreignKey: "future_supplies",
      pinned: 'left',
    },
    {
      key: "user_id",
      label: "填写人",
      type: "text",
      width: "w-40",
      foreignKey: "user_roles",
    },
    {
      key: "user_name",
      label: "填写人姓名",
      type: "text",
      width: "w-28",
      readOnly: true,
      hidden: true,
    },
    { key: "record_year", label: "年份", type: "number", width: "w-16", noThousandSeparator: true },
    { key: "record_quarter", label: "季度", type: "number", width: "w-16" },
    {
      key: "created_at",
      label: "创建时间",
      type: "date",
      readOnly: true,
      width: "w-28",
      hidden: true,
    },
  ],
  uploadMatchKeys: ["future_supply_id", "record_year", "record_quarter"],
  uploadDescription: "按「未来供应楼宇 + 年份 + 季度」组合匹配。已存在则更新填写人，不存在则新增。",
};

// ─── 所有核心表名列表（用于 schema 发现时跳过）─────────────────────────────

export const ALL_CORE_TABLE_NAMES = [
  ...CORE_TABLE_CONFIGS.map((c) => c.table),
  "user_roles",
  "building_assignments",
  "quarterly_submissions",
  "quarterly_updates",
  "update_drafts",
];

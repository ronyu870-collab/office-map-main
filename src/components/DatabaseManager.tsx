"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/services/supabaseClient";
import { logAction } from "@/src/utils/audit";
import { getSession } from "@/src/services/Auth";
import { MaskedCell } from "@/src/components/demo";
import * as XLSX from "xlsx";

// ─── 可搜索下拉组件（Portal渲染，避免被父容器遮挡）────────────────────────
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "-- 选择 --",
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0, width: 0 });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // 定位下拉面板
  const updatePos = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, []);

  const openDropdown = React.useCallback(() => {
    setQuery("");
    setOpen(true);
    updatePos();
  }, [updatePos]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = () => updatePos();
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePos]);

  const dropdown = open && filtered.length > 0
    ? createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
          className="max-h-52 overflow-auto rounded border border-zinc-200 bg-white shadow-lg"
        >
          {filtered.map((o) => (
            <div
              key={o.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.value);
                setOpen(false);
              }}
              className={`cursor-pointer px-2 py-1.5 text-xs hover:bg-blue-50 ${o.value === value ? "bg-blue-100 font-medium" : ""}`}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); updatePos(); }}
        onFocus={openDropdown}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e]"
      />
      {dropdown}
    </div>
  );
}

// ─── 重置密码 ───────────────────────────────────────────────────────────────

async function resetUserPassword(
  userId: string,
): Promise<{ ok: boolean; msg: string }> {
  // 强化 Token 获取：直接从 Supabase 客户端获取最新 session
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  // 空值校验
  if (sessionError) {
    console.error("[resetUserPassword] 获取 session 失败:", sessionError);
    return { ok: false, msg: "获取登录状态失败，请刷新页面后重试" };
  }

  if (!session) {
    return { ok: false, msg: "未检测到登录状态，请刷新页面重新登录" };
  }

  if (!session.access_token) {
    return { ok: false, msg: "登录 Token 缺失，请刷新页面后重试" };
  }

  // 开发环境调试日志（仅打印长度，不打印完整 Token）
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[resetUserPassword] Token 长度: ${session.access_token.length}`,
    );
  }

  // 正确传递 Header
  const res = await fetch("/api/admin/reset-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ userId }),
  });

  const data = await res.json();
  if (!res.ok) return { ok: false, msg: data.error ?? "重置失败" };
  return { ok: true, msg: data.message ?? "密码已成功重置为 000000" };
}

// ─── 表配置 ────────────────────────────────────────────────────────────────

type ColType = "text" | "number" | "textarea" | "boolean";

interface ColDef {
  key: string;
  label: string;
  type: ColType;
  readOnly?: boolean;
  width?: string;
  hidden?: boolean;
  masked?: boolean;
}

interface TableConfig {
  table: string;       // Supabase 表名
  label: string;
  emoji: string;
  cols: ColDef[];
  orderBy?: string;
  supportsHistory?: boolean;
  filterField?: string;
  filterValue?: string;
  tabKey?: string;     // 标签页唯一标识（同表多视图时使用，默认等于 table）
}

function getTabKey(c: TableConfig): string {
  return c.tabKey ?? c.table;
}

type BuildingDict = Record<string, string>;
type UserDict = Record<string, string>; // user_id -> display name (email or role)

const TABLE_CONFIGS: TableConfig[] = [
  // ── 项目台账（物化视图，只读）───────────────────────────────────────────────
  {
    table: "project_ledger",
    label: "项目台账",
    emoji: "",
    orderBy: "name",
    cols: [
      { key: "id", label: "ID", type: "text", readOnly: true, width: "w-28", hidden: true },
      { key: "building_id", label: "楼宇ID", type: "text", readOnly: true, width: "w-28", hidden: true },
      // 基础信息
      { key: "name", label: "项目名称", type: "text", width: "w-40", readOnly: true, masked: true },
      { key: "submarket", label: "子市场", type: "text", width: "w-28", readOnly: true },
      { key: "grade", label: "等级", type: "text", width: "w-16", readOnly: true },
      { key: "district", label: "行政区", type: "text", width: "w-20", readOnly: true },
      { key: "owner", label: "业主", type: "text", width: "w-32", readOnly: true, masked: true },
      { key: "property_management", label: "物业", type: "text", width: "w-28", readOnly: true, masked: true },
      { key: "leasable_area", label: "可租赁面积", type: "number", width: "w-24", readOnly: true },
      // 季度数据
      { key: "record_year", label: "年份", type: "number", width: "w-16", readOnly: true },
      { key: "record_quarter", label: "季度", type: "number", width: "w-12", readOnly: true },
      { key: "total_area", label: "总面积", type: "number", width: "w-24", readOnly: true },
      { key: "asking_rent", label: "报价租金", type: "number", width: "w-20", readOnly: true },
      { key: "management_fee", label: "物业费", type: "number", width: "w-20", readOnly: true },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20", readOnly: true },
      { key: "rent_free_period", label: "免租期", type: "number", width: "w-16", readOnly: true },
      { key: "net_effective_rent", label: "净有效租金", type: "number", width: "w-24", readOnly: true },
      { key: "vacant_area", label: "空置面积", type: "number", width: "w-20", readOnly: true },
      { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20", readOnly: true },
      // 状态
      { key: "is_locked", label: "已锁定", type: "text", width: "w-16", readOnly: true },
      { key: "is_draft", label: "草稿", type: "text", width: "w-12", readOnly: true },
      { key: "data_source", label: "数据来源", type: "text", width: "w-20", readOnly: true },
      { key: "building_status", label: "项目状态", type: "text", width: "w-16", readOnly: true },
    ],
  },
  // ── 项目基础信息（存量 stock）────────────────────────────────────────
  {
    table: "buildings",
    tabKey: "buildings_stock",
    label: "项目基础信息",
    emoji: "",
    orderBy: "name",
    filterField: "project_type",
    filterValue: "stock",
    cols: [
      {
        key: "name",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
      },
      { key: "former_names", label: "曾用名", type: "text", width: "w-40" },
      { key: "completion_year", label: "入市时间", type: "text", width: "w-24" },
      { key: "system_entry_date", label: "加入系统时间", type: "text", width: "w-28" },
      { key: "submarket", label: "子市场", type: "text", width: "w-28" },
      { key: "grade", label: "楼宇等级", type: "text", width: "w-20" },
      { key: "city", label: "城市", type: "text", width: "w-16" },
      { key: "district", label: "行政区", type: "text", width: "w-20" },
      { key: "owner", label: "业主", type: "text", width: "w-32", masked: true },
      { key: "property_management", label: "物业公司", type: "text", width: "w-32", masked: true },
      { key: "contact_phone", label: "联系方式", type: "text", width: "w-32", masked: true },
      { key: "location_lng", label: "经度", type: "number", width: "w-28" },
      { key: "location_lat", label: "纬度", type: "number", width: "w-28" },
      { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24" },
      { key: "is_active", label: "启用状态", type: "boolean", width: "w-20" },
      { key: "notes", label: "备注", type: "textarea", width: "w-40" },
    ],
  },
  // ── 未来新增供应（future）────────────────────────────────────────────
  {
    table: "buildings",
    tabKey: "buildings_future",
    label: "未来新增供应",
    emoji: "",
    orderBy: "completion_year",
    filterField: "project_type",
    filterValue: "future",
    cols: [
      {
        key: "name",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
      },
      { key: "former_names", label: "曾用名", type: "text", width: "w-40" },
      { key: "completion_year", label: "入市时间", type: "text", width: "w-24" },
      { key: "system_entry_date", label: "加入系统时间", type: "text", width: "w-28" },
      { key: "submarket", label: "子市场", type: "text", width: "w-28" },
      { key: "grade", label: "楼宇等级", type: "text", width: "w-20" },
      { key: "city", label: "城市", type: "text", width: "w-16" },
      { key: "district", label: "行政区", type: "text", width: "w-20" },
      { key: "owner", label: "业主", type: "text", width: "w-32", masked: true },
      { key: "property_management", label: "物业公司", type: "text", width: "w-32", masked: true },
      { key: "contact_phone", label: "联系方式", type: "text", width: "w-32", masked: true },
      { key: "location_lng", label: "经度", type: "number", width: "w-28" },
      { key: "location_lat", label: "纬度", type: "number", width: "w-28" },
      { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24" },
      { key: "is_active", label: "启用状态", type: "boolean", width: "w-20" },
      { key: "notes", label: "备注", type: "textarea", width: "w-40" },
      { key: "is_entered_market", label: "是否已入市", type: "boolean", width: "w-24" },
    ],
  },
  // ── 待加入存量（entering）────────────────────────────────────────────
  {
    table: "buildings",
    tabKey: "buildings_entering",
    label: "待加入存量",
    emoji: "",
    orderBy: "name",
    filterField: "project_type",
    filterValue: "entering",
    cols: [
      {
        key: "name",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
      },
      { key: "former_names", label: "曾用名", type: "text", width: "w-40" },
      { key: "completion_year", label: "入市时间", type: "text", width: "w-24" },
      { key: "system_entry_date", label: "加入系统时间", type: "text", width: "w-28" },
      { key: "submarket", label: "子市场", type: "text", width: "w-28" },
      { key: "grade", label: "楼宇等级", type: "text", width: "w-20" },
      { key: "city", label: "城市", type: "text", width: "w-16" },
      { key: "district", label: "行政区", type: "text", width: "w-20" },
      { key: "owner", label: "业主", type: "text", width: "w-32", masked: true },
      { key: "property_management", label: "物业公司", type: "text", width: "w-32", masked: true },
      { key: "contact_phone", label: "联系方式", type: "text", width: "w-32", masked: true },
      { key: "location_lng", label: "经度", type: "number", width: "w-28" },
      { key: "location_lat", label: "纬度", type: "number", width: "w-28" },
      { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24" },
      { key: "is_active", label: "启用状态", type: "boolean", width: "w-20" },
      { key: "notes", label: "备注", type: "textarea", width: "w-40" },
      { key: "is_entered_market", label: "是否已入市", type: "boolean", width: "w-24" },
    ],
  },
  {
    table: "building_metrics",
    label: "季度指标数据",
    emoji: "",
    orderBy: "record_year",
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
      },
      { key: "record_year", label: "年份", type: "number", width: "w-16" },
      { key: "record_quarter", label: "季度", type: "number", width: "w-16" },
      { key: "total_area", label: "总面积", type: "number", width: "w-24" },
      { key: "asking_rent", label: "报价租金", type: "number", width: "w-20" },
      { key: "management_fee", label: "物业费", type: "number", width: "w-20" },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
      {
        key: "rent_free_period",
        label: "免租期",
        type: "number",
        width: "w-16",
      },
      {
        key: "net_effective_rent",
        label: "净有效租金",
        type: "number",
        width: "w-24",
      },
      { key: "vacancy_rate", label: "空置率", type: "number", width: "w-20" },
      { key: "vacant_area", label: "空置面积", type: "number", width: "w-20" },
    ],
  },
  {
    table: "user_roles",
    label: "用户角色",
    emoji: "",
    orderBy: "user_id",
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
        key: "user_id",
        label: "姓名",
        type: "text",
        width: "w-32",
        masked: true,
      },
      { key: "role", label: "角色", type: "text", width: "w-24" },
    ],
  },
  {
    table: "quarterly_updates",
    label: "季度填报记录",
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
      { key: "user_name", label: "填报人", type: "text", width: "w-28" },
      { key: "tab", label: "分类", type: "text", width: "w-20" },
      {
        key: "project_name",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
      },
    ],
  },
  {
    table: "building_assignments",
    label: "填报任务分配",
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
        key: "building_id",
        label: "楼宇ID",
        type: "text",
        width: "w-28",
        hidden: true,
      },
      {
        key: "project_name",
        label: "项目名称",
        type: "text",
        readOnly: true,
        width: "w-40",
      },
      {
        key: "user_id",
        label: "填写人ID",
        type: "text",
        width: "w-56",
        hidden: true,
      },
      {
        key: "user_name",
        label: "填写人姓名",
        type: "text",
        readOnly: true,
        width: "w-28",
      },
    ],
  },
  {
    table: "quarterly_submissions",
    label: "季度填报数据",
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
        key: "building_id",
        label: "项目名称",
        type: "text",
        width: "w-40",
        masked: true,
      },
      {
        key: "user_id",
        label: "提交人ID",
        type: "text",
        width: "w-56",
        hidden: true,
      },
      {
        key: "user_name",
        label: "提交人",
        type: "text",
        readOnly: true,
        width: "w-28",
      },
      { key: "record_year", label: "年份", type: "number", width: "w-16" },
      { key: "record_quarter", label: "季度", type: "number", width: "w-16" },
      { key: "total_area", label: "总面积", type: "number", width: "w-24" },
      { key: "asking_rent", label: "报价租金", type: "number", width: "w-20" },
      { key: "management_fee", label: "物业费", type: "number", width: "w-20" },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-20" },
      {
        key: "rent_free_period",
        label: "免租期",
        type: "number",
        width: "w-16",
      },
      {
        key: "net_effective_rent",
        label: "净有效租金",
        type: "number",
        width: "w-24",
      },
      {
        key: "vacancy_rate",
        label: "空置率(%)",
        type: "number",
        width: "w-20",
      },
      { key: "vacant_area", label: "空置面积", type: "number", width: "w-20" },
      {
        key: "owner",
        label: "业主",
        type: "text",
        width: "w-28",
        masked: true,
      },
      {
        key: "property_management",
        label: "物业",
        type: "text",
        width: "w-28",
        masked: true,
      },
      { key: "notes", label: "备注", type: "textarea", width: "w-40" },
      {
        key: "created_at",
        label: "提交时间",
        type: "text",
        readOnly: true,
        width: "w-40",
      },
    ],
    // 🔥 新增：标记此表支持历史查询和双模式导出
    supportsHistory: true,
  },
  {
    table: "lease_transactions",
    label: "租赁成交",
    emoji: "",
    orderBy: "created_at",
    cols: [
      { key: "id", label: "ID", type: "text", hidden: true },
      {
        key: "company",
        label: "公司",
        type: "text",
        width: "w-48",
        masked: true,
      },
      {
        key: "suspected_company_fullname",
        label: "疑似公司全称",
        type: "text",
        width: "w-56",
        masked: true,
      },
      {
        key: "enterprise_type",
        label: "企业类型",
        type: "text",
        width: "w-32",
      },
      { key: "industry", label: "行业", type: "text", width: "w-32" },
      { key: "sub_industry", label: "行业细分", type: "text", width: "w-32" },
      { key: "demand_type", label: "需求", type: "text", width: "w-32" },
      {
        key: "new_building",
        label: "新租楼宇",
        type: "text",
        width: "w-48",
        masked: true,
      },
      { key: "sub_market", label: "子市场", type: "text", width: "w-32" },
      { key: "district", label: "行政区", type: "text", width: "w-32" },
      { key: "building_grade", label: "楼宇级别", type: "text", width: "w-24" },
      { key: "floor_info", label: "楼座/楼层", type: "text", width: "w-32" },
      { key: "old_address", label: "旧址", type: "text", width: "w-48" },
      {
        key: "old_sub_market",
        label: "旧址子市场",
        type: "text",
        width: "w-32",
      },
      {
        key: "old_building_grade",
        label: "旧址级别",
        type: "text",
        width: "w-24",
      },
      { key: "area_sqm", label: "面积(㎡)", type: "number", width: "w-28" },
      { key: "face_rent", label: "表面租金", type: "number", width: "w-28" },
      {
        key: "is_face_rent_estimated",
        label: "表面租金预估",
        type: "text",
        width: "w-32",
      },
      {
        key: "effective_rent",
        label: "有效租金",
        type: "number",
        width: "w-28",
      },
      {
        key: "is_effective_rent_estimated",
        label: "有效租金预估",
        type: "text",
        width: "w-32",
      },
      {
        key: "lease_term_months",
        label: "租期(月)",
        type: "number",
        width: "w-24",
      },
      {
        key: "fit_out_months",
        label: "装修期(月)",
        type: "number",
        width: "w-28",
      },
      {
        key: "rent_free_months",
        label: "免租期(月)",
        type: "number",
        width: "w-28",
      },
      {
        key: "transaction_date",
        label: "成交日期",
        type: "text",
        width: "w-32",
      },
      {
        key: "transaction_quarter",
        label: "季度",
        type: "text",
        width: "w-24",
      },
      { key: "remarks", label: "备注", type: "text", width: "w-64" },
      {
        key: "data_source",
        label: "数据来源",
        type: "text",
        readOnly: true,
        width: "w-32",
      },
      {
        key: "submitter_name",
        label: "提交人",
        type: "text",
        readOnly: true,
        width: "w-24",
      },
      {
        key: "created_at",
        label: "提交时间",
        type: "text",
        readOnly: true,
        width: "w-40",
      },
    ],
  },
];

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function emptyRow(cols: ColDef[]): Record<string, any> {
  const row: Record<string, any> = {};
  for (const c of cols) {
    if (c.readOnly) continue;
    row[c.key] = c.type === "number" ? "" : "";
  }
  return row;
}

// ─── 单表管理面板 ───────────────────────────────────────────────────────────

function TablePanel({
  config,
  buildingDict,
  userDict,
}: {
  config: TableConfig;
  buildingDict: BuildingDict;
  userDict: UserDict;
}) {
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editBuf, setEditBuf] = React.useState<Record<string, any>>({});
  const [adding, setAdding] = React.useState(false);
  const [newRow, setNewRow] = React.useState<Record<string, any>>({});
  const [saving, setSaving] = React.useState(false);
  const [resetingId, setResetingId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(
    null,
  );

  // 是否所有列都是只读（用于物化视图等只读数据源）
  const isReadOnly = config.cols.every((c) => c.readOnly);
  const [search, setSearch] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<
    Record<string, string>
  >({});
  const [page, setPage] = React.useState(0);

  // 切换表时清空筛选条件，避免跨表筛选污染
  React.useEffect(() => {
    setSearch("");
    setColumnFilters({});
    setPage(0);
  }, [getTabKey(config)]);
  const PAGE_SIZE = 50;
  const [uploading, setUploading] = React.useState(false);
  const [importErrors, setImportErrors] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const smartFileInputRef = React.useRef<HTMLInputElement>(null);

  // 🔥 新增：历史查询相关状态
  const [viewMode, setViewMode] = React.useState<"latest" | "all">("latest"); // 默认显示最新数据
  const [historyModalOpen, setHistoryModalOpen] = React.useState(false);
  const [historyData, setHistoryData] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [selectedRowForHistory, setSelectedRowForHistory] =
    React.useState<any>(null);

  // Sticky top scrollbar refs and state
  const topScrollRef = React.useRef<HTMLDivElement>(null);
  const tableScrollRef = React.useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = React.useState(0);
  const [isScrollable, setIsScrollable] = React.useState(false);
  const syncingRef = React.useRef(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRows = React.useCallback(async () => {
    setLoading(true);

    // 🔥 新增：如果是 quarterly_submissions 表且处于"最新数据"模式，查询视图
    if (config.table === "quarterly_submissions" && viewMode === "latest") {
      const q = supabase
        .from("view_latest_quarterly_submissions")
        .select("*")
        .limit(2000);
      if (config.orderBy) q.order(config.orderBy, { ascending: false });
      const { data, error } = await q;
      if (error) {
        console.error("查询最新数据视图失败:", error);
        showToast(`读取失败: ${error.message}`, false);
      } else {
        setRows(data || []);
      }
    } else {
      // 原有逻辑：查询原始表
      const q = supabase.from(config.table).select("*").limit(2000);
      if (config.filterField && config.filterValue) {
        q.eq(config.filterField, config.filterValue);
      }
      if (config.orderBy) q.order(config.orderBy, { ascending: false });
      const { data, error } = await q;
      if (error) {
        showToast(`读取失败: ${error.message}`, false);
      } else {
        setRows(data || []);
      }
    }

    setLoading(false);
  }, [getTabKey(config), config.orderBy, viewMode]);

  React.useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // 🔥 新增：查询某个楼宇在某个季度的所有历史提交记录
  const fetchHistory = async (
    buildingId: string,
    year: number,
    quarter: number,
  ) => {
    setHistoryLoading(true);
    setHistoryModalOpen(true);

    const { data, error } = await supabase
      .from("quarterly_submissions")
      .select("*")
      .eq("building_id", buildingId)
      .eq("record_year", year)
      .eq("record_quarter", quarter)
      .order("created_at", { ascending: false });

    if (error) {
      showToast(`查询历史失败: ${error.message}`, false);
      setHistoryData([]);
    } else {
      setHistoryData(data || []);
    }

    setHistoryLoading(false);
  };

  // 🔥 新增：关闭历史弹窗
  const closeHistoryModal = () => {
    setHistoryModalOpen(false);
    setHistoryData([]);
    setSelectedRowForHistory(null);
  };

  // 搜索过滤（全局搜索 + 多列过滤交集）
  const filtered = React.useMemo(() => {
    let result = rows;

    // 全局搜索
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      result = result.filter((r) =>
        config.cols.some((c) => {
          const raw = String(r[c.key] ?? "").toLowerCase();
          if (c.key === "building_id") {
            const name = buildingDict[r[c.key]] ?? "";
            return raw.includes(kw) || name.toLowerCase().includes(kw);
          }
          if (c.key === "user_id") {
            const name = userDict[r[c.key]] ?? "";
            return raw.includes(kw) || name.toLowerCase().includes(kw);
          }
          return raw.includes(kw);
        }),
      );
    }

    // 列过滤（交集）
    for (const [colKey, filterValue] of Object.entries(columnFilters)) {
      if (!filterValue.trim()) continue;
      const kw = filterValue.trim().toLowerCase();
      result = result.filter((r) => {
        if (colKey === "building_id") {
          const name = buildingDict[r[colKey]] ?? "";
          return name.toLowerCase().includes(kw);
        }
        if (colKey === "user_id") {
          const name = userDict[r[colKey]] ?? "";
          return name.toLowerCase().includes(kw);
        }
        const raw = String(r[colKey] ?? "").toLowerCase();
        return raw.includes(kw);
      });
    }

    return result;
  }, [rows, search, columnFilters, config.cols, buildingDict, userDict]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // 当筛选条件变化导致数据量减少时，确保页码不超出范围
  React.useEffect(() => {
    if (page > 0 && page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [totalPages, page]);

  // Bidirectional scroll sync handlers
  const handleTopScroll = () => {
    if (syncingRef.current || !tableScrollRef.current || !topScrollRef.current)
      return;
    syncingRef.current = true;
    tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const handleTableScroll = () => {
    if (syncingRef.current || !tableScrollRef.current || !topScrollRef.current)
      return;
    syncingRef.current = true;
    topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  // Monitor table width and scrollability
  React.useEffect(() => {
    const tableContainer = tableScrollRef.current;
    if (!tableContainer) return;

    const updateScrollInfo = () => {
      const scrollWidth = tableContainer.scrollWidth;
      const clientWidth = tableContainer.clientWidth;
      setTableScrollWidth(scrollWidth);
      setIsScrollable(scrollWidth > clientWidth);
    };

    updateScrollInfo();

    const resizeObserver = new ResizeObserver(updateScrollInfo);
    resizeObserver.observe(tableContainer);

    window.addEventListener("resize", updateScrollInfo);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollInfo);
    };
  }, [rows]);

  // ── 编辑 ──
  const startEdit = (row: any) => {
    setEditingId(row.id);
    const buf = { ...row };
    // former_names: JSONB 数组 → 逗号分隔文本，方便编辑
    if (Array.isArray(buf.former_names)) {
      buf.former_names = buf.former_names.join("，");
    }
    setEditBuf(buf);
    setAdding(false);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditBuf({});
  };

  const saveEdit = async () => {
    setSaving(true);
    const payload: Record<string, any> = {};
    for (const c of config.cols) {
      if (c.readOnly) continue;
      if (c.type === "boolean") {
        payload[c.key] = editBuf[c.key] === true || editBuf[c.key] === "true" ? true : editBuf[c.key] === false || editBuf[c.key] === "false" ? false : null;
      } else if (c.key === "former_names") {
        const raw = String(editBuf[c.key] ?? "").trim();
        payload[c.key] = raw ? raw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
      } else if (c.type === "number") {
        payload[c.key] = editBuf[c.key] === "" ? null : Number(editBuf[c.key]);
      } else {
        payload[c.key] = editBuf[c.key];
      }
    }
    // 自动填充 building_assignments 的只读派生字段
    if (config.table === "building_assignments") {
      if (payload.building_id)
        payload.project_name = buildingDict[payload.building_id] ?? "";
      if (payload.user_id)
        payload.user_name = userDict[payload.user_id] ?? payload.user_id;
    }
    const { error } = await supabase
      .from(config.table)
      .update(payload)
      .eq("id", editingId!);
    if (error) {
      showToast(`保存失败: ${error.message}`, false);
    } else {
      showToast("保存成功");
      // 计算变更字段（仅记录有变化的字段）
      const oldRow = rows.find((r) => r.id === editingId) ?? {};
      const changes: Record<string, { from: any; to: any }> = {};
      for (const key of Object.keys(payload)) {
        if (String(oldRow[key] ?? "") !== String(payload[key] ?? "")) {
          changes[key] = {
            from: oldRow[key] ?? null,
            to: payload[key] ?? null,
          };
        }
      }
      const session = await getSession();
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "UPDATE",
        table: config.table,
        table_label: config.label,
        target_id: editingId,
        context: buildRowContext({ ...oldRow, ...payload }),
        changes,
        col_labels: colLabels,
      });
      cancelEdit();
      await fetchRows();
    }
    setSaving(false);
  };

  // ── 新增 ──
  const startAdd = () => {
    setAdding(true);
    setNewRow(emptyRow(config.cols));
    setEditingId(null);
  };
  const cancelAdd = () => {
    setAdding(false);
    setNewRow({});
  };

  const saveAdd = async () => {
    setSaving(true);
    const payload: Record<string, any> = {};
    for (const c of config.cols) {
      if (c.readOnly) continue;
      if (c.type === "boolean") {
        payload[c.key] = newRow[c.key] === true || newRow[c.key] === "true" ? true : newRow[c.key] === false || newRow[c.key] === "false" ? false : null;
      } else if (c.key === "former_names") {
        const raw = String(newRow[c.key] ?? "").trim();
        payload[c.key] = raw ? raw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
      } else if (c.type === "number") {
        payload[c.key] = newRow[c.key] === "" ? null : Number(newRow[c.key]);
      } else {
        payload[c.key] = newRow[c.key];
      }
    }
    // 自动填充 building_assignments 的只读派生字段
    if (config.table === "building_assignments") {
      if (payload.building_id)
        payload.project_name = buildingDict[payload.building_id] ?? "";
      if (payload.user_id)
        payload.user_name = userDict[payload.user_id] ?? payload.user_id;
    }
    const { data, error } = await supabase
      .from(config.table)
      .insert(payload)
      .select();
    if (error) {
      showToast(`新增失败: ${error.message}`, false);
    } else {
      showToast("新增成功");
      const session = await getSession();
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      const insertedId = data?.[0]?.id ?? "unknown";
      const insertedRow = data?.[0] ?? payload;
      // 格式化为 {from: null, to: value}，与 UPDATE 保持一致
      const insertChanges: Record<string, { from: any; to: any }> = {};
      for (const [key, val] of Object.entries(payload)) {
        if (val !== null && val !== undefined && val !== "") {
          insertChanges[key] = { from: null, to: val };
        }
      }
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "INSERT",
        table: config.table,
        table_label: config.label,
        target_id: insertedId,
        context: buildRowContext(insertedRow),
        changes: insertChanges,
        col_labels: colLabels,
      });
      cancelAdd();
      await fetchRows();
    }
    setSaving(false);
  };

  // ── 删除 ──
  const deleteRow = async (id: string, name?: string) => {
    if (!confirm(`确认删除「${name || id}」？此操作不可撤销。`)) return;
    const originalRow = rows.find((r) => r.id === id);

    // 🔥 改进：使用 .select() 验证删除是否真的成功
    const { data, error } = await supabase
      .from(config.table)
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      showToast(`删除失败: ${error.message}`, false);
    } else if (!data || data.length === 0) {
      // 🔥 新增：如果返回数据为空，说明 RLS 策略阻止了删除
      console.error("❌ [删除失败] 返回数据为空");
      console.error("   - 可能原因 1: ID 不存在");
      console.error("   - 可能原因 2: RLS 策略阻止了删除");
      console.error("   - 可能原因 3: 用户没有权限删除此记录");
      showToast("删除失败：未找到匹配的记录或权限不足", false);
    } else {
      showToast("已删除");
      const session = await getSession();
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      // 格式化为 {from: value, to: null}，与 UPDATE 保持一致
      const deleteChanges: Record<string, { from: any; to: any }> = {};
      if (originalRow) {
        for (const [key, val] of Object.entries(originalRow)) {
          if (val !== null && val !== undefined && val !== "" && key !== "id") {
            deleteChanges[key] = { from: val, to: null };
          }
        }
      }
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "DELETE",
        table: config.table,
        table_label: config.label,
        target_id: id,
        context: buildRowContext(originalRow ?? { id }),
        changes: deleteChanges,
        col_labels: colLabels,
      });
      await fetchRows();
    }
  };

  // ── 重置密码（仅 user_roles 表）──
  const handleResetPassword = async (row: any) => {
    const displayName = userDict[row.user_id] ?? row.user_id;
    if (
      !confirm(
        `确定要将「${displayName}」的密码重置为 000000 吗？\n\n员工下次登录时需使用此临时密码，并自行修改。`,
      )
    )
      return;

    setResetingId(row.user_id);
    const { ok, msg } = await resetUserPassword(row.user_id);
    setResetingId(null);
    showToast(msg, ok);

    if (ok) {
      const session = await getSession();
      const adminId = session?.user?.email ?? session?.user?.id ?? "admin";
      logAction(adminId, "ADMIN_DATA_OPERATION", {
        operation: "RESET_PASSWORD",
        table: "user_roles",
        table_label: "用户角色",
        target_id: row.user_id,
        context: { display_name: displayName },
      });
    }
  };

  // 从一行数据中提取人类可读的上下文信息，附加到审计日志
  // 列名中文映射（用于审计日志显示）
  const colLabels = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of config.cols) map[c.key] = c.label;
    return map;
  }, [config.cols]);

  const buildRowContext = (row: Record<string, any>) => {
    const ctx: Record<string, any> = {};
    // 楼宇 ID → 项目名称
    if (row.building_id) {
      ctx.building_id = row.building_id;
      ctx.building_name = buildingDict[row.building_id] ?? "(未知楼宇)";
    }
    // 季度指标：年份 + 季度
    if (row.record_year != null) ctx.record_year = row.record_year;
    if (row.record_quarter != null)
      ctx.record_quarter = `Q${row.record_quarter}`;
    // 通用名称字段
    if (row.name) ctx.name = row.name;
    if (row.project_name) ctx.project_name = row.project_name;
    if (row.user_id && config.table === "user_roles")
      ctx.user_id_value = row.user_id;
    return ctx;
  };

  // ── XLSX 导入 ──
  const writableCols = config.cols.filter((c) => !c.readOnly);

  const downloadTemplate = () => {
    const header = writableCols.map((c) => c.label)
    const ws = XLSX.utils.aoa_to_sheet([header])
    ws['!cols'] = writableCols.map(() => ({ wch: 22 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '上传数据')
    XLSX.writeFile(wb, `${config.label}_导入模板.xlsx`)
  };

  const triggerUpload = () => {
    setImportErrors([]);
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as unknown[][];
        processWorkbook(rows);
      } catch (err: any) {
        showToast(`XLSX \u6587\u4ef6\u89e3\u6790\u5931\u8d25\uff1a${err.message}`, false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  function cellToString(cell: unknown): string {
    if (cell === null || cell === undefined) return ""
    if (typeof cell === "number") return String(cell)
    if (typeof cell === "boolean") return cell ? "是" : "否"
    if (cell instanceof Date) return cell.toISOString().slice(0, 10)
    return String(cell).trim()
  }

  const processWorkbook = async (rows: unknown[][]) => {
    const nonEmptyRows = rows.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""))
    if (nonEmptyRows.length < 2) {
      showToast("XLSX 文件为空或只有表头，无数据行", false);
      return;
    }

    const headerRow = nonEmptyRows[0].map((c) => cellToString(c));
    const expectedLabels = writableCols.map((c) => c.label);

    const headersMatch =
      headerRow.length === expectedLabels.length &&
      headerRow.every((h, i) => h === expectedLabels[i]);
    if (!headersMatch) {
      showToast("表头不匹配，请先下载标准模板", false);
      return;
    }

    const nameToId: Record<string, string> = {};
    for (const [id, name] of Object.entries(buildingDict)) {
      nameToId[name] = id;
    }
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const errors: string[] = [];
    const parsed: Record<string, any>[] = [];

    for (let i = 1; i < nonEmptyRows.length; i++) {
      const cells = nonEmptyRows[i];
      const rowNum = i + 1;
      const rowData: Record<string, any> = {};

      writableCols.forEach((col, idx) => {
        const raw = cellToString(cells[idx]);
        if (raw === "") {
          rowData[col.key] = col.type === "number" ? null : "";
        } else if (col.key === "building_id") {
          if (uuidRegex.test(raw)) {
            rowData[col.key] = raw;
          } else {
            const resolvedId = nameToId[raw];
            if (!resolvedId) {
              errors.push(
                `第 ${rowNum} 行 - 楼宇ID：找不到名为 "${raw}" 的楼宇，请检查名称是否与数据库一致`,
              );
            } else {
              rowData[col.key] = resolvedId;
            }
          }
        } else if (col.type === "number") {
          const num = Number(raw);
          if (isNaN(num)) {
            errors.push(
              `第 ${rowNum} 行 - ${col.label}：格式错误（应为数字，实际填写的为 '${raw}'）`,
            );
          } else {
            rowData[col.key] = num;
          }
        } else {
          rowData[col.key] = raw;
        }
      });

      if (errors.length === 0) parsed.push(rowData);
    }

    if (errors.length > 0) {
      setImportErrors(errors);
      return;
    }

    setUploading(true);
    const { error } = await supabase.from(config.table).insert(parsed);
    setUploading(false);
    if (error) {
      showToast(`导入失败: ${error.message}`, false);
    } else {
      showToast(`成功导入 ${parsed.length} 条数据`);
      const session = await getSession();
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "BULK_INSERT",
        table: config.table,
        table_label: config.label,
        count: parsed.length,
      });
      await fetchRows();
    }
  };

  // ── 智能 XLSX 批量导入（仅 building_assignments）──
  const triggerSmartUpload = () => {
    setImportErrors([]);
    smartFileInputRef.current?.click();
  };

  const handleSmartFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as unknown[][];
        processSmartWorkbook(rows);
      } catch (err: any) {
        showToast(`XLSX \u6587\u4ef6\u89e3\u6790\u5931\u8d25\uff1a${err.message}`, false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const processSmartWorkbook = async (rows: unknown[][]) => {
    const nonEmptyRows = rows.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""))
    if (nonEmptyRows.length < 2) {
      showToast("XLSX 文件为空或只有表头，无数据行", false);
      return;
    }

    const header = nonEmptyRows[0].map((c) => cellToString(c));
    const projectNameIdx = header.findIndex(
      (h) => h === "project_name" || h === "项目名称",
    );
    const userNameIdx = header.findIndex(
      (h) => h === "user_name" || h === "填写人姓名" || h === "用户姓名",
    );

    if (projectNameIdx === -1 || userNameIdx === -1) {
      showToast("表头缺少 project_name / user_name 列，请检查 XLSX 格式", false);
      return;
    }

    // 构建反向查找字典
    // buildingDict: id -> name  =>  nameToId: name -> id
    const nameToId: Record<string, string> = {};
    for (const [id, name] of Object.entries(buildingDict)) nameToId[name] = id;

    // 重新查询 user_roles 获取最新的 full_name 和 chinese_name
    const { data: users, error: userError } = await supabase
      .from("user_roles")
      .select("user_id, full_name, chinese_name");

    if (userError) {
      showToast(`查询用户失败: ${userError.message}`, false);
      return;
    }

    // 构建多种匹配方式：full_name -> user_id, chinese_name -> user_id, email -> user_id
    const nameToUserId: Record<string, string> = {};
    const stripQuotes = (s: string) =>
      s
        .trim()
        .replace(/^"+|"+$/g, "")
        .trim();
    for (const u of users || []) {
      if (u.full_name?.trim())
        nameToUserId[stripQuotes(u.full_name)] = u.user_id;
      if (u.chinese_name?.trim())
        nameToUserId[stripQuotes(u.chinese_name)] = u.user_id;
      nameToUserId[u.user_id] = u.user_id;
    }

    const errors: string[] = [];
    const payload: {
      building_id: string;
      project_name: string;
      user_id: string;
      user_name: string;
    }[] = [];

    for (let i = 1; i < nonEmptyRows.length; i++) {
      const cells = nonEmptyRows[i].map((c) => cellToString(c));
      const rowNum = i + 1;
      const projectName = cells[projectNameIdx]?.trim() ?? "";
      const userName = cells[userNameIdx]?.trim() ?? "";

      const buildingId = nameToId[projectName];
      const userId = nameToUserId[userName];

      if (!buildingId) {
        errors.push(
          `第 ${rowNum} 行：找不到名为「${projectName}」的楼宇，请检查是否与系统名称完全一致`,
        );
      }
      if (!userId) {
        errors.push(
          `第 ${rowNum} 行：找不到名为「${userName}」的用户（已尝试匹配英文名、中文名和邮箱）`,
        );
      }
      if (buildingId && userId) {
        payload.push({
          building_id: buildingId,
          project_name: projectName,
          user_id: userId,
          user_name: userName,
        });
      }
    }

    if (errors.length > 0) {
      setImportErrors(errors);
      return;
    }

    setUploading(true);
    const { error } = await supabase
      .from("building_assignments")
      .insert(payload);
    setUploading(false);
    if (error) {
      showToast(`导入失败: ${error.message}`, false);
    } else {
      showToast(`成功分配 ${payload.length} 条任务`);
      const session = await getSession();
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "SMART_BULK_ASSIGN",
        table: "building_assignments",
        table_label: "填报任务分配",
        count: payload.length,
      });
      await fetchRows();
    }
  };

  const nameKey = config.cols.find(
    (c) => c.key === "name" || c.key === "user_id" || c.key === "project_name",
  )?.key;

  // ── 导出 Excel ──
  const exportToExcel = (mode: "latest" | "all" = "latest") => {
    // 🔥 新增：根据模式决定导出数据源
    let exportRows = filtered;
    let filenamePrefix = config.label;

    if (config.table === "quarterly_submissions") {
      if (mode === "latest") {
        // 导出最新数据（当前视图模式下的数据）
        if (viewMode !== "latest") {
          showToast('请先切换到"最新数据"模式再导出', false);
          return;
        }
        filenamePrefix = "季度填报数据汇总_各项目最新结果";
      } else {
        // 导出全量历史数据（需要重新查询原始表）
        filenamePrefix = "季度填报数据汇总_全量审计历史明细";
        // 注意：这里使用当前 filtered 数据，如果需要导出全量，需要先切换到"全部历史"模式
        if (viewMode !== "all") {
          showToast('请先切换到"全部历史"模式再导出', false);
          return;
        }
      }
    }

    if (exportRows.length === 0) {
      showToast("没有数据可导出", false);
      return;
    }

    // 构建导出数据（包含中文表头）
    const exportData = exportRows.map((row) => {
      const exportRow: Record<string, any> = {};
      config.cols
        .filter((c) => !c.hidden)
        .forEach((col) => {
          let value = row[col.key];

          // 特殊处理：building_id 显示项目名称
          if (col.key === "building_id" && buildingDict[value]) {
            value = buildingDict[value];
          }
          // 特殊处理：user_id 显示用户名称
          if (col.key === "user_id" && userDict[value]) {
            value = userDict[value];
          }
          // 特殊处理：created_at 格式化时间
          if (col.key === "created_at" && value) {
            value = new Date(value).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
          }

          exportRow[col.label] = value ?? "";
        });
      return exportRow;
    });

    // 创建工作簿
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, config.label);

    // 生成文件名
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    const timestamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `${filenamePrefix}_${year}Q${quarter}_${timestamp}.xlsx`;

    // 触发下载
    XLSX.writeFile(workbook, filename);
    showToast(`已导出 ${exportRows.length} 条数据`);

    // 记录审计日志
    getSession().then((session) => {
      const userId = session?.user?.email ?? session?.user?.id ?? "admin";
      logAction(userId, "ADMIN_DATA_OPERATION", {
        operation: "EXPORT_EXCEL",
        table: config.table,
        table_label: config.label,
        export_mode: mode,
        count: exportRows.length,
        filename,
      });
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.msg}
        </div>
      )}

      {/* 导入错误提示 */}
      {importErrors.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="max-w-2xl max-h-[80vh] overflow-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-red-600">
              数据校验失败，请修正后重新上传
            </h3>
            <ul className="space-y-1 text-xs text-zinc-700">
              {importErrors.map((err, i) => (
                <li key={i} className="border-l-2 border-red-400 pl-2">
                  {err}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setImportErrors([])}
              className="mt-4 rounded bg-zinc-600 px-4 py-2 text-xs text-white hover:bg-zinc-700"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="shrink-0 mb-3 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded border border-zinc-300 px-3 text-sm outline-none focus:border-[#003e7e] w-56"
        />
        <span className="text-xs text-zinc-400">{filtered.length} 条记录</span>
        {isReadOnly && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-200">
            只读
          </span>
        )}

        {config.supportsHistory && (
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-zinc-500">视图模式：</span>
            <button
              onClick={() => {
                setViewMode("latest");
                setPage(0);
              }}
              className={`h-8 rounded px-3 text-xs transition ${
                viewMode === "latest"
                  ? "bg-[#003e7e] text-white"
                  : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              最新数据
            </button>
            <button
              onClick={() => {
                setViewMode("all");
                setPage(0);
              }}
              className={`h-8 rounded px-3 text-xs transition ${
                viewMode === "all"
                  ? "bg-[#003e7e] text-white"
                  : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              全部历史
            </button>
          </div>
        )}

        <div className="ml-auto flex gap-2">
          {config.supportsHistory ? (
            <div className="relative group">
              <button className="h-8 rounded border border-emerald-300 bg-emerald-50 px-3 text-xs text-emerald-700 hover:bg-emerald-100 flex items-center gap-1">
                导出 Excel
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              <div className="absolute right-0 top-full mt-1 hidden group-hover:block bg-white border border-zinc-200 rounded shadow-lg z-50 min-w-[200px]">
                <button
                  onClick={() => exportToExcel("latest")}
                  className="w-full text-left px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 flex items-center gap-2"
                >
                  <div>
                    <div className="font-medium">导出各项目最新结果</div>
                    <div className="text-[10px] text-zinc-400">
                      每个项目每季度只显示最后一次提交
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => exportToExcel("all")}
                  className="w-full text-left px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 border-t border-zinc-100"
                >
                  <div>
                    <div className="font-medium">导出全量审计历史明细</div>
                    <div className="text-[10px] text-zinc-400">
                      包含所有提交记录（含错误信息）
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => exportToExcel("latest")}
              className="h-8 rounded border border-emerald-300 bg-emerald-50 px-3 text-xs text-emerald-700 hover:bg-emerald-100"
            >
              导出 Excel
            </button>
          )}

          <button
            onClick={fetchRows}
            className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
          >
            刷新
          </button>
          {!isReadOnly && (
            <>
              <button
                onClick={downloadTemplate}
                className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
              >
                下载模版
              </button>
              <button
                onClick={triggerUpload}
                disabled={uploading}
                className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50"
              >
                {uploading ? "上传中..." : "批量上传"}
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
          {config.table === "building_assignments" && (
            <>
              <button
                onClick={triggerSmartUpload}
                disabled={uploading}
                className="h-8 rounded border border-[#003e7e] bg-[#e8f0fb] px-3 text-xs text-[#003e7e] hover:bg-[#d0e2f7] disabled:opacity-50"
              >
                {uploading ? "处理中..." : "批量分配(XLSX)"}
              </button>
              <input
                ref={smartFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleSmartFileSelect}
                className="hidden"
              />
            </>
          )}
          {!isReadOnly && (
            <button
              onClick={startAdd}
              className="h-8 rounded bg-blue-600 px-3 text-xs text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]"
            >
              + 新增
            </button>
          )}
        </div>
      </div>

      {/* 新增行表单 */}
      {adding && (
        <div className="shrink-0 mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="mb-3 text-xs font-semibold text-emerald-800">
            新增一行
          </p>
          <div className="flex flex-wrap gap-3">
            {config.cols
              .filter((c) => !c.readOnly && !c.hidden)
              .map((c) => (
                <div key={c.key} className="flex flex-col gap-1">
                  <label className="text-[10px] text-zinc-500">{c.label}</label>
                  {c.type === "textarea" ? (
                    <textarea
                      rows={2}
                      value={newRow[c.key] ?? ""}
                      onChange={(e) =>
                        setNewRow((p) => ({ ...p, [c.key]: e.target.value }))
                      }
                      className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e] resize-none"
                    />
                  ) : c.key === "building_id" ? (
                    <SearchableSelect
                      value={newRow[c.key] ?? ""}
                      onChange={(val) => setNewRow((p) => ({ ...p, [c.key]: val }))}
                      options={Object.entries(buildingDict).map(([id, name]) => ({ value: id, label: name }))}
                      placeholder="-- 选择项目 --"
                      className="w-48"
                    />
                  ) : c.key === "user_id" ? (
                    <select
                      value={newRow[c.key] ?? ""}
                      onChange={(e) =>
                        setNewRow((p) => ({ ...p, [c.key]: e.target.value }))
                      }
                      className="w-48 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e]"
                    >
                      <option value="">-- 选择用户 --</option>
                      {Object.entries(userDict).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : c.type === "boolean" ? (
                    <select
                      value={newRow[c.key] == null ? "" : String(newRow[c.key])}
                      onChange={(e) =>
                        setNewRow((p) => ({ ...p, [c.key]: e.target.value === "" ? null : e.target.value === "true" }))
                      }
                      className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e]"
                    >
                      <option value="">-- 选择 --</option>
                      <option value="true">✅ 是</option>
                      <option value="false">❎ 否</option>
                    </select>
                  ) : (
                    <input
                      type={c.type === "number" ? "number" : "text"}
                      value={newRow[c.key] ?? ""}
                      onChange={(e) =>
                        setNewRow((p) => ({ ...p, [c.key]: e.target.value }))
                      }
                      className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e]"
                    />
                  )}
                </div>
              ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveAdd}
              disabled={saving}
              className="rounded bg-emerald-600 px-4 py-1.5 text-xs text-white transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "保存中..." : "确认新增"}
            </button>
            <button
              onClick={cancelAdd}
              className="rounded border border-zinc-300 bg-white px-4 py-1.5 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 顶部吸顶滚动条 */}
      {isScrollable && (
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="shrink-0 overflow-x-auto table-persistent-scroll mb-2 bg-white border-b border-zinc-200"
          style={{ height: "16px", position: "sticky", top: 0, zIndex: 30 }}
        >
          <div style={{ width: `${tableScrollWidth}px`, height: "1px" }} />
        </div>
      )}

      {/* 数据表格 */}
      <div
        ref={tableScrollRef}
        onScroll={handleTableScroll}
        className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200 table-persistent-scroll"
        style={{ height: "calc(100vh - 300px)" }}
      >
        <table
          className="w-full text-left text-sm whitespace-nowrap"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <thead
            style={{ position: "sticky", top: 0, zIndex: 20 }}
            className="bg-zinc-50"
          >
            <tr className="border-b border-zinc-200">
              {config.cols
                .filter((c) => !c.hidden)
                .map((c, idx) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-50 border-b border-r border-zinc-200 ${c.width ?? ""}`}
                    style={
                      idx === 0
                        ? { position: "sticky", left: 0, zIndex: 10 }
                        : undefined
                    }
                  >
                    {c.label}
                  </th>
                ))}
              <th className="px-3 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-50 border-b border-zinc-200 w-24">
                操作
              </th>
            </tr>
            <tr className="border-b border-zinc-200 bg-zinc-50/80">
              {config.cols
                .filter((c) => !c.hidden)
                .map((c, idx) => (
                  <th
                    key={c.key}
                    className="px-2 py-1.5 bg-zinc-50 border-b border-r border-zinc-200"
                    style={{
                      position: "sticky",
                      top: "41px",
                      zIndex: idx === 0 ? 20 : 10,
                      ...(idx === 0 ? { left: 0 } : {}),
                    }}
                  >
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="筛选"
                        value={columnFilters[c.key] ?? ""}
                        onChange={(e) => {
                          setColumnFilters((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }));
                          setPage(0);
                        }}
                        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]/20"
                      />
                      {columnFilters[c.key] && (
                        <button
                          onClick={() =>
                            setColumnFilters((prev) => ({
                              ...prev,
                              [c.key]: "",
                            }))
                          }
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                          title="清除筛选"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              <th className="px-2 py-1.5 bg-zinc-50 border-b border-zinc-200 sticky top-[41px] z-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td
                  colSpan={config.cols.filter((c) => !c.hidden).length + 1}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-primary"></div>
                    <span>加载中...</span>
                  </div>
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td
                  colSpan={config.cols.filter((c) => !c.hidden).length + 1}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-3">
                      <span className="text-sm font-medium tracking-wide text-zinc-400">
                        暂无数据
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paged.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors duration-150 hover:bg-zinc-50/80 ${isEditing ? "bg-blue-50" : ""}`}
                  >
                    {config.cols
                      .filter((c) => !c.hidden)
                      .map((c, idx) => (
                        <td
                          key={c.key}
                          className={`px-3 py-2 align-middle border-r border-zinc-200 ${idx === 0 ? (isEditing ? "bg-blue-50" : "bg-white") : ""}`}
                          style={
                            idx === 0
                              ? { position: "sticky", left: 0, zIndex: 10 }
                              : undefined
                          }
                        >
                          {isEditing && !c.readOnly ? (
                            c.type === "textarea" ? (
                              <textarea
                                rows={2}
                                value={editBuf[c.key] ?? ""}
                                onChange={(e) =>
                                  setEditBuf((p) => ({
                                    ...p,
                                    [c.key]: e.target.value,
                                  }))
                                }
                                className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e] resize-none"
                              />
                            ) : c.key === "building_id" ? (
                              <SearchableSelect
                                value={editBuf[c.key] ?? ""}
                                onChange={(val) => setEditBuf((p) => ({ ...p, [c.key]: val }))}
                                options={Object.entries(buildingDict).map(([id, name]) => ({ value: id, label: name }))}
                                placeholder="-- 选择项目 --"
                                className="w-full"
                              />
                            ) : c.key === "user_id" ? (
                              <select
                                value={editBuf[c.key] ?? ""}
                                onChange={(e) =>
                                  setEditBuf((p) => ({
                                    ...p,
                                    [c.key]: e.target.value,
                                  }))
                                }
                                className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e]"
                              >
                                <option value="">-- 选择用户 --</option>
                                {Object.entries(userDict).map(([id, label]) => (
                                  <option key={id} value={id}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            ) : c.type === "boolean" ? (
                              <select
                                value={editBuf[c.key] == null ? "" : String(editBuf[c.key])}
                                onChange={(e) =>
                                  setEditBuf((p) => ({
                                    ...p,
                                    [c.key]: e.target.value === "" ? null : e.target.value === "true",
                                  }))
                                }
                                className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e]"
                              >
                                <option value="">-- 选择 --</option>
                                <option value="true">✅ 是</option>
                                <option value="false">❎ 否</option>
                              </select>
                            ) : (
                              <input
                                type={c.type === "number" ? "number" : "text"}
                                value={editBuf[c.key] ?? ""}
                                onChange={(e) =>
                                  setEditBuf((p) => ({
                                    ...p,
                                    [c.key]: e.target.value,
                                  }))
                                }
                                className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e]"
                              />
                            )
                          ) : (
                            <MaskedCell masked={!!c.masked}>
                              <span
                                className="text-sm text-zinc-700"
                                title={
                                  (c.key === "owner" ||
                                    c.key === "property_management") &&
                                  String(row[c.key] ?? "").length > 10
                                    ? String(row[c.key])
                                    : undefined
                                }
                              >
                                {(() => {
                                  // boolean 字段 ✅/❎
                                  if (c.type === "boolean") {
                                    return row[c.key] === true ? "✅" : "❎";
                                  }
                                  let displayValue = "";
                                  if (
                                    c.key === "building_id" &&
                                    buildingDict[row[c.key]]
                                  ) {
                                    displayValue = buildingDict[row[c.key]];
                                  } else if (
                                    c.key === "user_id" &&
                                    userDict[row[c.key]]
                                  ) {
                                    displayValue = userDict[row[c.key]];
                                  } else if (c.key === "former_names") {
                                    // JSONB 数组 → 逗号分隔文本
                                    const arr = row[c.key];
                                    displayValue = Array.isArray(arr) ? arr.join("，") : (arr ? String(arr) : "-");
                                  } else {
                                    displayValue = String(row[c.key] ?? "-");
                                  }

                                  // 业主和物业列限制10个字符
                                  if (
                                    (c.key === "owner" ||
                                      c.key === "property_management") &&
                                    displayValue.length > 10
                                  ) {
                                    return (
                                      displayValue.substring(0, 10) + "..."
                                    );
                                  }
                                  return displayValue;
                                })()}
                              </span>
                            </MaskedCell>
                          )}
                        </td>
                      ))}
                    <td className="px-3 py-2 align-middle">
                      {isEditing ? (
                        <div className="flex gap-1.5">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
                          >
                            {saving ? "..." : "保存"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          {config.supportsHistory &&
                            row.building_id &&
                            row.record_year &&
                            row.record_quarter && (
                              <button
                                onClick={() => {
                                  setSelectedRowForHistory(row);
                                  fetchHistory(
                                    row.building_id,
                                    row.record_year,
                                    row.record_quarter,
                                  );
                                }}
                                title="查看该项目该季度的所有提交历史"
                                className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                              >
                                历史
                              </button>
                            )}
                          {!isReadOnly && (
                            <button
                              onClick={() => startEdit(row)}
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]"
                            >
                              编辑
                            </button>
                          )}
                          {config.table === "user_roles" && (
                            <button
                              onClick={() => handleResetPassword(row)}
                              disabled={resetingId === row.user_id}
                              title="重置密码为 000000"
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            >
                              {resetingId === row.user_id ? "..." : "重置密码"}
                            </button>
                          )}
                          {!isReadOnly && (
                            <button
                              onClick={() =>
                                deleteRow(
                                  row.id,
                                  nameKey ? row[nameKey] : undefined,
                                )
                              }
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 transition-all duration-150 hover:bg-red-100 active:scale-[0.98]"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="shrink-0 mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>
            第 {page + 1} / {totalPages} 页，共 {filtered.length} 条
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-zinc-300 px-2 py-1 transition-all duration-150 disabled:opacity-40 hover:bg-zinc-50 active:scale-[0.98]"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-zinc-300 px-2 py-1 transition-all duration-150 disabled:opacity-40 hover:bg-zinc-50 active:scale-[0.98]"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 🔥 新增：历史记录弹窗 */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-w-6xl max-h-[90vh] w-full mx-4 bg-white rounded-lg shadow-xl flex flex-col">
            {/* 弹窗标题 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">
                  提交历史记录
                </h3>
                {selectedRowForHistory && (
                  <p className="text-xs text-zinc-500 mt-1">
                    项目：
                    {buildingDict[selectedRowForHistory.building_id] ||
                      selectedRowForHistory.building_id}{" "}
                    | 时间：{selectedRowForHistory.record_year} Q
                    {selectedRowForHistory.record_quarter}
                  </p>
                )}
              </div>
              <button
                onClick={closeHistoryModal}
                className="text-zinc-400 hover:text-zinc-600 transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 overflow-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
                </div>
              ) : historyData.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <p>暂无历史记录</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {historyData.map((record, index) => (
                    <div
                      key={record.id}
                      className={`border rounded-lg p-4 ${
                        index === 0
                          ? "border-emerald-300 bg-emerald-50/30"
                          : "border-zinc-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {index === 0 && (
                            <span className="px-2 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-100 rounded">
                              最新版本
                            </span>
                          )}
                          <span className="text-xs text-zinc-500">
                            版本 #{historyData.length - index}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-400">
                          提交时间：
                          {new Date(record.created_at).toLocaleString("zh-CN", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-zinc-500">提交人：</span>
                          <MaskedCell masked>
                            <span className="font-medium">
                              {record.user_name}
                            </span>
                          </MaskedCell>
                        </div>
                        <div>
                          <span className="text-zinc-500">报价租金：</span>
                          <span className="font-medium">
                            {record.asking_rent ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">物业费：</span>
                          <span className="font-medium">
                            {record.management_fee ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">表面租金：</span>
                          <span className="font-medium">
                            {record.face_rent ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">免租期：</span>
                          <span className="font-medium">
                            {record.rent_free_period ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">净有效租金：</span>
                          <span className="font-medium text-emerald-600">
                            {record.net_effective_rent ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">空置面积：</span>
                          <span className="font-medium">
                            {record.vacant_area ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">空置率：</span>
                          <span className="font-medium text-blue-600">
                            {record.vacancy_rate
                              ? `${record.vacancy_rate}%`
                              : "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">总面积：</span>
                          <span className="font-medium">
                            {record.total_area ?? "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">业主：</span>
                          <MaskedCell masked>
                            <span className="font-medium">
                              {record.owner || "-"}
                            </span>
                          </MaskedCell>
                        </div>
                        <div>
                          <span className="text-zinc-500">物业：</span>
                          <MaskedCell masked>
                            <span className="font-medium">
                              {record.property_management || "-"}
                            </span>
                          </MaskedCell>
                        </div>
                        {record.notes && (
                          <div className="col-span-2 md:col-span-3 lg:col-span-4">
                            <span className="text-zinc-500">备注：</span>
                            <span className="font-medium">{record.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 弹窗底部 */}
            <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
              <button
                onClick={closeHistoryModal}
                className="rounded bg-zinc-600 px-4 py-2 text-xs text-white hover:bg-zinc-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function DatabaseManager() {
  const [activeTab, setActiveTab] = React.useState(getTabKey(TABLE_CONFIGS[0]));
  const [buildingDict, setBuildingDict] = React.useState<BuildingDict>({});
  const [userDict, setUserDict] = React.useState<UserDict>({});
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const config = TABLE_CONFIGS.find((c) => getTabKey(c) === activeTab)!;

  React.useEffect(() => {
    supabase
      .from("buildings")
      .select("id, name")
      .eq("is_active", true)
      .then(({ data }) => {
        if (data) {
          const dict: BuildingDict = {};
          for (const b of data) dict[b.id] = b.name;
          setBuildingDict(dict);
        }
      });
  }, []);

  React.useEffect(() => {
    supabase
      .from("user_roles")
      .select("user_id, role, full_name, chinese_name")
      .then(({ data }) => {
        if (data) {
          const dict: UserDict = {};
          for (const u of data) {
            // 优先显示中文名，其次英文名，最后 email
            const displayName =
              u.chinese_name?.trim() || u.full_name?.trim() || u.user_id;
            const label = u.role ? `${displayName} (${u.role})` : displayName;
            dict[u.user_id] = label;
          }
          setUserDict(dict);
        }
      });
  }, []);

  const containerClass = isFullscreen
    ? "fixed inset-0 z-50 bg-white p-4 flex flex-col"
    : "flex-1 min-h-0 flex flex-col";

  return (
    <div className={containerClass}>
      {/* 表选择 Tab */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-zinc-200 pb-3">
        {TABLE_CONFIGS.map((c) => {
          const tabKey = getTabKey(c);
          const isLedger = c.table === "project_ledger";
          const isActive = activeTab === tabKey;
          return (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isLedger
                  ? isActive
                    ? "bg-amber-600 text-white shadow-sm"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                  : isActive
                    ? "bg-[#003e7e] text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {c.emoji && <span className="mr-1">{c.emoji}</span>}
              {c.label}
            </button>
          );
        })}
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
          title={isFullscreen ? "退出全屏" : "全屏显示"}
        >
          {isFullscreen ? "退出全屏" : "全屏"}
        </button>
      </div>

      <TablePanel
        key={activeTab}
        config={config}
        buildingDict={buildingDict}
        userDict={userDict}
      />
    </div>
  );
}

"use client";

import { DatabaseManager } from "./DatabaseManager";
import { ALL_CORE_TABLE_NAMES, CORE_TABLE_CONFIGS } from "./tableConfigs";
import type { TableConfig } from "./types";

const BUILDING_BROCHURE_TABLE = "building_brochure_data";

const BUILDING_BROCHURE_CONFIG: TableConfig = {
  table: BUILDING_BROCHURE_TABLE,
  label: "楼书数据",
  emoji: "",
  orderBy: "updated_at",
  cols: [
    { key: "id", label: "ID", type: "uuid", readOnly: true, width: "w-40", hidden: true },
    { key: "building_id", label: "项目名称", type: "uuid", width: "w-40", foreignKey: "buildings", pinned: "left", required: true, masked: true },
    { key: "name_cn", label: "中文名称", type: "text", width: "w-32" },
    { key: "name_en", label: "英文名称", type: "text", width: "w-40" },
    { key: "developer", label: "开发商", type: "text", width: "w-32" },
    { key: "district", label: "行政区", type: "text", width: "w-20" },
    { key: "submarket", label: "子市场", type: "text", width: "w-28" },
    { key: "address", label: "地址", type: "text", width: "w-48" },
    { key: "grade", label: "楼宇等级", type: "text", width: "w-20", exactFilter: true },
    { key: "completion_date", label: "竣工日期", type: "date", width: "w-24" },
    { key: "gfa_total", label: "总建筑面积", type: "number", width: "w-24" },
    { key: "gfa_office", label: "办公建筑面积", type: "number", width: "w-24" },
    { key: "gfa_retail", label: "商业建筑面积", type: "number", width: "w-24" },
    { key: "building_height", label: "建筑高度", type: "number", width: "w-20" },
    { key: "building_floors", label: "总楼层数", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "floors_above", label: "地上层数", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "floors_below", label: "地下层数", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "standard_floor_area", label: "标准层面积", type: "number", width: "w-24" },
    { key: "column_free", label: "无柱设计", type: "boolean", width: "w-20" },
    { key: "depth", label: "进深", type: "number", width: "w-20" },
    { key: "column_spacing", label: "柱距", type: "number", width: "w-20" },
    { key: "floor_height", label: "层高", type: "number", width: "w-20" },
    { key: "clear_height", label: "净高", type: "number", width: "w-20" },
    { key: "raised_floor_cm", label: "架空地板(cm)", type: "number", width: "w-24", noThousandSeparator: true },
    { key: "efficiency_rate", label: "使用率", type: "number", width: "w-20" },
    { key: "floor_load_office", label: "办公区楼板承重", type: "number", width: "w-28", noThousandSeparator: true },
    { key: "floor_load_equipment", label: "设备区楼板承重", type: "number", width: "w-28", noThousandSeparator: true },
    { key: "facade_type", label: "外立面", type: "text", width: "w-28" },
    { key: "metro_access", label: "地铁交通", type: "text", width: "w-40" },
    { key: "leed_certification", label: "LEED认证", type: "text", width: "w-24" },
    { key: "well_certification", label: "WELL认证", type: "text", width: "w-24" },
    { key: "green_building_standard", label: "绿色建筑标准", type: "text", width: "w-28" },
    { key: "green_power", label: "绿电", type: "boolean", width: "w-16" },
    { key: "restrooms_per_floor", label: "每层卫生间数", type: "number", width: "w-24", noThousandSeparator: true },
    { key: "delivery_standard", label: "交付标准", type: "textarea", width: "w-48" },
    { key: "removable_floor", label: "可拆卸地板", type: "boolean", width: "w-20" },
    { key: "property_management", label: "物业公司", type: "text", width: "w-32" },
    { key: "elevator_passenger", label: "客梯数量", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "elevator_zones", label: "电梯分区", type: "text", width: "w-32" },
    { key: "elevator_vip", label: "VIP电梯", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "elevator_freight", label: "货梯数量", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "parking_total", label: "总停车位", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "parking_above", label: "地上停车位", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "parking_underground_floor", label: "地下停车层数", type: "number", width: "w-24", noThousandSeparator: true },
    { key: "parking_underground", label: "地下停车位", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "parking_charging", label: "充电车位", type: "number", width: "w-20", noThousandSeparator: true },
    { key: "power_system", label: "供电系统", type: "text", width: "w-32" },
    { key: "power_source", label: "电源配置", type: "text", width: "w-32" },
    { key: "power_backup_generator", label: "备用发电机", type: "text", width: "w-32" },
    { key: "telecom_provider", label: "通信运营商", type: "text", width: "w-32" },
    { key: "hvac_system", label: "空调系统", type: "text", width: "w-32" },
    { key: "hvac_fresh_air_capacity", label: "新风量", type: "number", width: "w-20" },
    { key: "hvac_pm25_purification", label: "PM2.5净化", type: "boolean", width: "w-20" },
    { key: "hvac_hours", label: "空调运行时间", type: "text", width: "w-32" },
    { key: "hvac_cooling_water_24h", label: "24小时冷却水", type: "boolean", width: "w-24" },
    { key: "created_at", label: "创建时间", type: "date", readOnly: true, width: "w-28", hidden: true },
    { key: "updated_at", label: "更新时间", type: "date", readOnly: true, width: "w-28", hidden: true },
  ],
  uploadMatchKeys: ["building_id"],
  uploadDescription: "按「项目名称」匹配楼书数据。已存在时只更新实际填写的字段，空白字段保留原值；不存在时新增。",
};

function registerBuildingBrochureTable() {
  if (!CORE_TABLE_CONFIGS.some((config) => config.table === BUILDING_BROCHURE_TABLE)) {
    const leaseIndex = CORE_TABLE_CONFIGS.findIndex((config) => config.table === "lease_transactions");
    const insertIndex = leaseIndex >= 0 ? leaseIndex + 1 : CORE_TABLE_CONFIGS.length;
    CORE_TABLE_CONFIGS.splice(insertIndex, 0, BUILDING_BROCHURE_CONFIG);
  }

  if (!ALL_CORE_TABLE_NAMES.includes(BUILDING_BROCHURE_TABLE)) {
    ALL_CORE_TABLE_NAMES.push(BUILDING_BROCHURE_TABLE);
  }
}

registerBuildingBrochureTable();

export function DatabaseManagerEntry() {
  return <DatabaseManager />;
}

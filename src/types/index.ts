/**
 * 数据库类型（严格 TS 接口）
 *
 * 数据表：
 * - `buildings`
 * - `building_metrics`
 */

export interface Building {
  id: string;
  name: string;
  former_names?: string[] | null;
  submarket: string;
  grade: string;
  city: string;
  district: string;
  location_lng: number;
  location_lat: number;
  completion_year: string;
  leed_certification: string;
  owner?: string;
  property_management?: string;
  contact_phone?: string;
}

export interface BuildingMetric {
  id: string;
  building_id: string;

  total_area: number;
  asking_rent: number;
  management_fee: number;
  face_rent: number;
  rent_free_period: number;

  net_effective_rent: number;
  vacancy_rate: number;
  vacant_area: number;

  record_year: number;
  record_quarter: number;
}

/**
 * building + 对应的 metrics 列表（渲染时我们会在内部取最新一条）
 */
export interface BuildingWithMetrics extends Building {
  metrics: BuildingMetric[];
}

export interface FutureSupply {
  id: string;
  name: string;
  former_names?: string[] | null;
  building_id?: string | null;
  owner: string | null;
  district: string | null;
  submarket: string | null;
  grade: string | null;
  launch_year: number | null;
  launch_quarter: string | null;
  total_area: number | null;
  notes: string | null;
  location_lng: number;
  location_lat: number;
}


export interface AuditLog {
  id: number;
  user_id: string;
  action_type: string;
  details: Record<string, any>;
  created_at: string;
}

export interface BuildingAssignment {
  id: string;
  building_id: string;
  project_name: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

// 租赁成交填报类型
export * from './lease-transaction';

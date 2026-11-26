// Isolated UI fixtures only; these identities never authenticate to production.
export const user = { id: '45678901-1111-4111-8111-111111111111', email: 'workspace@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
export const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
export const stock = [
  { id: '9ee3e3ff-4845-41a1-a78f-390c11b1917a', name: 'CBD甲楼', submarket: 'CBD', location_lng: 116.46, location_lat: 39.91 },
  { id: 'cbd-b', name: 'CBD乙楼', submarket: 'CBD', location_lng: 116.48, location_lat: 39.92 },
  { id: 'other', name: '中关村楼·' + '超长项目名称及楼座信息'.repeat(6), submarket: '中关村', location_lng: 116.32, location_lat: 39.98 },
  { id: 'missing', name: '未定位楼', submarket: 'CBD', location_lng: null, location_lat: null },
].map(building => ({ ...building, grade: 'A', district: '朝阳区', building_metrics: [{ id: `m-${building.id}`, building_id: building.id, is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 9019486, net_effective_rent: 146.1, vacancy_rate: .211 }] }));
export const future = [{ id: 'future-cbd', building_id: 'master-cbd', name: 'CBD未来楼', type: '办公', district: '朝阳区', submarket: 'CBD', launch_year: 2027, launch_quarter: 'Q2', total_area: 80000, location_lng: 116.47, location_lat: 39.92 }];
export const project = stock[0].id;
export const stacking = { building: { id: project, name: 'CBD甲楼' }, towers: [{id:'tower-A',code:'A',display_name:'A 座'}],
 floors: Array.from({length:60}, (_,i)=>({id:`floor-${i}`,tower_id:'tower-A',floor_code:String(i+1),level_order:i+1,floor_area_sqm:1000,zone:'办公',use_type:'office'})),
 spaces: Array.from({length:600}, (_,i)=>({id:`unit-${i}`,floor_id:`floor-${Math.floor(i/10)}`,unit_code:String(i),occupancy_status:'occupied',tenant_name:`连续性租户${i}`,area_sqm:100,lease_steps:[],notes:'',verification_status:'source_unverified',revision:1,source_id:'source'})),
 sources:[{id:'source',title:'隔离回归样本',source_as_of:'2026-11-18',as_of_kind:'source_data_as_of',review_state:'date_confirmed',source_note:null}], basis:'source_snapshot_unverified'};

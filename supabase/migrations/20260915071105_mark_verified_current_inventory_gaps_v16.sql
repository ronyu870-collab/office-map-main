begin;

create temp table _v16_gap(
  historical_name text primary key,
  external_canonical_name text not null,
  external_address text,
  external_lat numeric,
  external_lng numeric,
  evidence jsonb not null
) on commit drop;

insert into _v16_gap values
('嘉华大厦','金隅嘉华大厦','北京市海淀区上地三街9号',40.036804,116.307951,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图及招商资料独立列示金隅嘉华大厦，上地三街9号；历史嘉华大厦商圈为上地'),
  jsonb_build_object('type','current_company_address','detail','2025年公开公司公告仍使用上地三街9号金隅嘉华大厦地址'),
  jsonb_build_object('type','inventory_distance','detail','当前642栋无嘉华/金隅嘉华canonical或former name；最近弘源新时代约0.253km，为不同项目')
)),
('京泰大厦','京泰大厦','北京市朝阳区建国门外大街丙24号',39.906999,116.439783,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图及写字楼资料仍独立列示京泰大厦，建国门外大街丙24号'),
  jsonb_build_object('type','address_disambiguation','detail','当前库存最近赛特大厦约0.084km，但为独立项目，canonical/former names均不承接京泰大厦')
)),
('南新仓大厦','南新仓商务大厦','北京市东城区东四十条甲22号',39.932877,116.431017,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图仍独立列示南新仓商务大厦及A/B座，东四十条甲22号'),
  jsonb_build_object('type','inventory_distance','detail','当前库存最近五矿广场约0.214km、北京中汇广场约0.234km，均为不同项目')
)),
('四惠大厦','四惠大厦','北京市朝阳区高碑店乡半壁店村惠河南街1008-B号',39.904260,116.508230,jsonb_build_array(
  jsonb_build_object('type','government_current_entity','detail','北京服务业开放资源清单仍将四惠大厦作为独立楼宇列示，地址惠河南街1008-B号'),
  jsonb_build_object('type','current_company_address','detail','企业官网仍使用四惠大厦作为北京分公司办公地址'),
  jsonb_build_object('type','inventory_distance','detail','当前库存最近国粹苑约0.131km，canonical/former names均不承接四惠大厦')
)),
('大恒科技大厦','大恒科技大厦','北京市海淀区苏州街3号',39.982383,116.305225,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图仍独立列示大恒科技大厦，苏州街3号'),
  jsonb_build_object('type','inventory_distance','detail','当前库存最近鼎盛大厦约0.115km、银科大厦约0.118km，均为不同实体')
)),
('学院国际大厦','学院国际大厦','北京市海淀区知春路1号',39.977304,116.353166,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图和租赁资料仍独立列示学院国际大厦，知春路1号'),
  jsonb_build_object('type','inventory_distance','detail','当前库存最近首享科技大厦约0.096km、致真大厦约0.137km，均为不同项目')
)),
('银网中心','银网中心','北京市海淀区知春路113号',39.976633,116.320781,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图及租赁资料仍独立列示银网中心，知春路113号'),
  jsonb_build_object('type','current_company_address','detail','当前企业联系地址仍使用知春路113号银网中心'),
  jsonb_build_object('type','inventory_distance','detail','当前库存最近太平洋国际大厦约0.200km，canonical/former names均不承接银网中心')
));

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_CURRENT_ENTITY_CONFIRMED_NO_INVENTORY_CANONICAL_OR_ALIAS',confidence='ABSOLUTE',
    evidence_snapshot=g.evidence,external_canonical_name=g.external_canonical_name,external_address=g.external_address,
    external_lat=g.external_lat,external_lng=g.external_lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v16 current independent entity verified; current 642-building inventory has no safe canonical/former-name carrier',
    resolved_at=now(),updated_at=now()
from _v16_gap g
where r.historical_name=g.historical_name and r.resolution_status='NEEDS_REVIEW';

commit;

create table if not exists public.industry_classification (
  id uuid primary key default gen_random_uuid(),
  industry_level1 text not null,
  sub_industry text,
  created_at timestamptz default now(),
  unique (industry_level1, sub_industry)
);

alter table public.industry_classification enable row level security;

revoke all on table public.industry_classification from anon, authenticated;
grant select, insert, update, delete on table public.industry_classification to authenticated;
grant all on table public.industry_classification to service_role;

create policy "authenticated users can view industry classification"
on public.industry_classification
for select
to authenticated
using (true);

create policy "admins can manage industry classification"
on public.industry_classification
for all
to authenticated
using (
  exists (
    select 1
    from public.user_roles
    where user_roles.user_id = (select auth.uid())
      and user_roles.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.user_roles
    where user_roles.user_id = (select auth.uid())
      and user_roles.role = 'admin'
  )
);

insert into public.industry_classification (industry_level1, sub_industry)
values
  ('专业服务', '人力'),
  ('专业服务', '公关'),
  ('专业服务', '其他'),
  ('专业服务', '咨询'),
  ('专业服务', '安保'),
  ('专业服务', '律所'),
  ('专业服务', '物业'),
  ('专业服务', '税务'),
  ('互联网硬件技术与设备', '其他'),
  ('互联网硬件技术与设备', '半导体集成电路'),
  ('互联网硬件技术与设备', '电子设备'),
  ('互联网硬件技术与设备', '高端仪器'),
  ('互联网软件与服务', '人工智能'),
  ('互联网软件与服务', '元宇宙'),
  ('互联网软件与服务', '其他'),
  ('互联网软件与服务', '区块链'),
  ('互联网软件与服务', '大数据云计算'),
  ('互联网软件与服务', '工业互联网'),
  ('互联网软件与服务', '数字营销'),
  ('互联网软件与服务', '智慧运维平台'),
  ('互联网软件与服务', '游戏开发'),
  ('互联网软件与服务', '网络安全'),
  ('互联网软件与服务', '网络通信'),
  ('互联网软件与服务', '虚拟现实'),
  ('互联网软件与服务', '软件应用'),
  ('军事工程', '其他'),
  ('军事工程', '军事科研'),
  ('军事工程', '军工制造'),
  ('军事工程', '军工电子'),
  ('农林牧渔', '其他'),
  ('农林牧渔', '农业种植'),
  ('农林牧渔', '农产品加工'),
  ('农林牧渔', '林业'),
  ('农林牧渔', '渔业'),
  ('农林牧渔', '畜牧养殖'),
  ('制造业', '代步车'),
  ('制造业', '传统制造'),
  ('制造业', '其他'),
  ('制造业', '军工'),
  ('制造业', '新型材料'),
  ('制造业', '无人机'),
  ('制造业', '智能家居'),
  ('制造业', '机器人'),
  ('制造业', '机械设备'),
  ('制造业', '精密仪器'),
  ('制造业', '通信制造'),
  ('制造业', '雷达'),
  ('制造业', '高端设备'),
  ('医疗健康', '健康管理'),
  ('医疗健康', '其他'),
  ('医疗健康', '制药'),
  ('医疗健康', '医疗器械'),
  ('医疗健康', '医疗服务'),
  ('医疗健康', '生物技术'),
  ('广告媒体/娱乐出版', '体育'),
  ('广告媒体/娱乐出版', '其他'),
  ('广告媒体/娱乐出版', '出版传媒'),
  ('广告媒体/娱乐出版', '广告营销'),
  ('广告媒体/娱乐出版', '影视制作'),
  ('广告媒体/娱乐出版', '文化娱乐'),
  ('房地产/建筑工程', '其他'),
  ('房地产/建筑工程', '建筑工程/装修'),
  ('房地产/建筑工程', '建筑设计'),
  ('房地产/建筑工程', '房地产开发'),
  ('房地产/建筑工程', '物业管理'),
  ('批发零售', '专卖店'),
  ('批发零售', '其他'),
  ('批发零售', '批发'),
  ('批发零售', '百货'),
  ('批发零售', '经销商'),
  ('批发零售', '超市卖场'),
  ('政府及公用事业', '事业单位'),
  ('政府及公用事业', '公共设施'),
  ('政府及公用事业', '其他'),
  ('政府及公用事业', '政府机构'),
  ('政府及公用事业', '社会组织/协会'),
  ('教育培训', 'K12教育'),
  ('教育培训', '其他'),
  ('教育培训', '在线教育'),
  ('教育培训', '技能培训'),
  ('教育培训', '语言/留学培训'),
  ('教育培训', '高等教育/职业教育'),
  ('汽车及零部件', '其他'),
  ('汽车及零部件', '整车制造'),
  ('汽车及零部件', '新能源汽车'),
  ('汽车及零部件', '汽车销售/售后'),
  ('汽车及零部件', '汽车零部件'),
  ('消费品', '其他'),
  ('消费品', '奢侈品'),
  ('消费品', '家居'),
  ('消费品', '服装'),
  ('消费品', '电器/电子产品'),
  ('消费品', '美妆'),
  ('消费品', '食品/饮料/烟草'),
  ('物流运输', '交通基建'),
  ('物流运输', '公路运输'),
  ('物流运输', '其他'),
  ('物流运输', '机场'),
  ('物流运输', '火车站'),
  ('物流运输', '航空运输'),
  ('物流运输', '铁路运输'),
  ('能源化工', '其他'),
  ('能源化工', '化工制品'),
  ('能源化工', '新能源'),
  ('能源化工', '煤炭'),
  ('能源化工', '电力能源'),
  ('能源化工', '电池'),
  ('能源化工', '石油天然气'),
  ('航空航天', '其他'),
  ('航空航天', '航天器/卫星'),
  ('航空航天', '航空服务'),
  ('航空航天', '航空零部件'),
  ('航空航天', '飞机制造'),
  ('酒店/餐饮/休闲娱乐', '休闲娱乐'),
  ('酒店/餐饮/休闲娱乐', '其他'),
  ('酒店/餐饮/休闲娱乐', '旅游服务'),
  ('酒店/餐饮/休闲娱乐', '酒店'),
  ('酒店/餐饮/休闲娱乐', '餐饮'),
  ('金融', '互联网金融'),
  ('金融', '保险'),
  ('金融', '信贷'),
  ('金融', '其他'),
  ('金融', '基金'),
  ('金融', '证券'),
  ('金融', '银行')
on conflict (industry_level1, sub_industry) do nothing;

import {randomUUID} from 'node:crypto';
export const PRIVATE_CLIENT='PRIVATE_CLIENT_SENTINEL_禁止披露';
export const TEST_SCOPE={organizationId:'synthetic-org',region:'test-region',city:'test-city',businessLine:'test-line'};
export function businessFixture(kind,index=0,language='zh') {
 const sourceId=randomUUID(),t=value=>({zh:value,en:'Synthetic '+value}),dataAsOf='2025-12-31';
 const title=kind==='case'?PRIVATE_CLIENT+' 原始案例 '+index:`隔离${kind}资料 ${index} · 非真实企业素材`;
 const content={protocol:'colliers-pitch/1',locale:language,title,disclosure:'internal',isTestData:true,dataAsOf,sources:[{id:sourceId,kind:'synthetic',label:kind==='case'?PRIVATE_CLIENT+' 来源':'隔离合成业务资料',locator:'logical-unit:'+index,version:'1',dataAsOf}],blocks:[{kind:'paragraph',text:'明确标记的隔离测试资料；不代表高力国际企业、员工或客户事实。',sourceIds:[sourceId]}]};
 let profile;
 if(kind==='corporate')profile={kind,coverage:'regional',fallbackFor:[],brief:t('隔离公司简洁介绍；非正式公司事实'),detailed:t('隔离公司详细介绍；这是可复现工程测试，不代表任何真实企业。'),capabilities:[t('合成服务能力')],honors:[t('合成资质，不作正式引用')],metrics:[{label:t('测试团队数量'),value:0,unit:'组'},{label:t('未提供规模'),value:null,unit:'人'}],photos:[]};
 if(kind==='team')profile={kind,employeeAccountId:null,name:t('测试成员 '+index),position:t('合成测试角色'),team:'隔离测试团队',expertise:['测试领域'],experience:t('合成履历，仅验证排版与追溯。'),qualifications:['隔离测试资质'],representativeProjects:['合成项目，不是实际业绩'],projectRole:t('负责合成测试工作'),reportsToAssetId:null,caseAssetIds:[],photo:null};
 if(kind==='case')profile={kind,project:t('经确认的匿名项目'),city:'隔离测试城市',submarket:null,propertyType:'合成办公物业',serviceType:'测试服务',clientIndustry:'测试行业',clientType:'匿名测试客户',scale:{value:1000+index,unit:'㎡'},background:t('合成项目背景'),challenge:t('合成挑战'),strategy:t('合成策略'),process:t('合成服务过程'),outcome:t('仅为工程测试，非真实业绩'),occurredOn:dataAsOf,buildingId:null,teamAssetIds:[],photos:[],disclosureMode:'anonymous',internalClientName:PRIVATE_CLIENT,displayApproved:true,display:{...content,title:'已确认匿名案例 '+index,blocks:[{kind:'case',title:'匿名测试项目 '+index,challenge:'合成测试挑战',approach:'合成测试策略与过程',outcome:'未提供真实业务成果；仅验证文件生成',sourceIds:[sourceId]}]}};
 if(kind==='research')profile={kind,topic:'outlook',evidenceType:'forecast',methodology:t('合成预测观点，不代表最新市场事实'),content:{...content,title:'隔离历史研究观点',blocks:[{kind:'insight',claim:'隔离预测观点，非业务建议',basis:'明确标记的合成研究资料',limitations:['预测不等于已发生事实'],sourceIds:[sourceId]},{kind:'chart',chartType:'line',categories:['2024','2025'],series:[{name:'合成历史指标',values:[100,110],unit:'测试单位'}],sourceIds:[sourceId]}]}};
 if(kind==='custom')profile={kind,typeCode:'service-extension',content};
 if(kind==='case')profile.briefDisplay={...profile.display,title:'匿名案例精简摘要 '+index,blocks:[{kind:'case',title:'匿名合成案例 '+index,challenge:'隔离挑战',approach:'经确认简洁策略',outcome:'仅供工程测试',sourceIds:[sourceId]}]};
 return {content,profile};
}
export const dynamicFixture={templateId:'rent-trend',buildingIds:[],submarkets:['CBD'],inventory:'tracked',period:{year:2026,quarter:3},start:{year:2026,quarter:2},end:{year:2026,quarter:3},fields:['totalArea','netEffectiveRent'],direction:'desc',chart:'line',from:'2026-01-01',to:'2026-12-31',leaseSource:'combined',measure:'count'};

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content);
}

function replaceExact(file, from, to, expected = 1) {
  const source = read(file);
  const count = source.split(from).length - 1;
  if (count !== expected) {
    throw new Error(`${file}: expected ${expected} occurrence(s) of ${JSON.stringify(from)}, found ${count}`);
  }
  write(file, source.split(from).join(to));
}

function replaceAtLeast(file, from, to, minimum = 1) {
  const source = read(file);
  const count = source.split(from).length - 1;
  if (count < minimum) {
    throw new Error(`${file}: expected at least ${minimum} occurrence(s) of ${JSON.stringify(from)}, found ${count}`);
  }
  write(file, source.split(from).join(to));
}

// Map: keep the GIS topology, but make the route-loading shell and first visible
// identity match the final map header and the Home product name.
replaceExact(
  'src/app/map/MapRouteGate.tsx',
  `function MapAuthLoading() {\n  return (\n    <div className="flex h-screen h-[100dvh] items-center justify-center bg-gray-50">\n      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />\n    </div>\n  );\n}`,
  `function MapAuthLoading() {\n  return (\n    <div className="flex h-screen h-[100dvh] flex-col overflow-hidden bg-[#e8edf3] text-slate-900">\n      <header className="flex h-[58px] shrink-0 items-center border-b border-slate-200/90 bg-[#f8fafc]/95 px-3 shadow-sm sm:px-5">\n        <div className="flex min-w-0 items-center gap-3">\n          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003e7e] text-[10px] font-bold tracking-wide text-white shadow-sm">CD</div>\n          <div className="min-w-0">\n            <div className="truncate text-[13px] font-semibold tracking-[0.08em] text-slate-900">COLLIERS DATA</div>\n            <div className="truncate text-[10px] text-slate-400">北京办公楼市场地图</div>\n          </div>\n        </div>\n      </header>\n      <div className="flex flex-1 items-center justify-center">\n        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />\n      </div>\n    </div>\n  );\n}`,
);
replaceExact('src/app/map/MapClient.tsx', '办公楼市场监测 · 核心地图工作台', '北京办公楼市场地图');
replaceExact('src/app/map/components/MapWorkbenchView.tsx', '>MAP 2.0</span>', '>市场地图</span>');
replaceExact('src/app/map/components/MapWorkbenchView.tsx', '北京办公楼市场 · 地图工作台', '北京办公楼市场地图');

// Quarterly Update: retain the dense Data Entry 2.0 workspace and translate only
// visible product/status language that breaks the Chinese Home contract.
replaceAtLeast('src/app/update/components/QuarterlyUpdateWorkspace.tsx', 'QUARTERLY UPDATE', '季度数据填报', 2);
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', 'READ ONLY', '只读');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', 'Admin preview · ${previewUserName}', '管理员预览 · ${previewUserName}');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "React.useState('Cloud draft enabled')", "React.useState('云端草稿已启用')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage('Cloud draft loaded')", "setSaveMessage('已加载云端草稿')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage('Changes are in the database draft')", "setSaveMessage('更改已同步至云端草稿')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage(error?.message || 'Cloud draft save failed; local edits are still on this page')", "setSaveMessage(error?.message || '云端草稿保存失败；当前页面仍保留本地修改')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage('Writing submitted rows')", "setSaveMessage('正在写入提交数据')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage('Submission written; cloud draft retained')", "setSaveMessage('提交成功；云端草稿已保留')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "setSaveMessage('Submission failed; draft remains available for retry')", "setSaveMessage('提交失败；草稿仍可用于重试')");
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '>Projects</span>', '>项目</span>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '>Complete</span>', '>完整</span>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '>Review</span>', '>待检查</span>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '<ArrowLeft size={13} /> Workspace</Link>', '<ArrowLeft size={13} /> 主页</Link>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '>Retry submit</button>', '>重试提交</button>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', '<Save size={13} /> Save draft</button>', '<Save size={13} /> 保存草稿</button>');
replaceExact('src/app/update/components/QuarterlyUpdateWorkspace.tsx', "{submitting ? 'Submitting…' : 'Submit current group'}", "{submitting ? '提交中…' : '提交当前分类'}");

// Lease Submission: translate the first screen, status/error states and transfer
// interaction without changing the underlying form, tables or data flow.
replaceExact('src/app/lease-submission/page.tsx', '>My submissions</h2>', '>我的提交</h2>');
replaceExact('src/app/lease-submission/page.tsx', "{userName || '用户'} · {items.length} records", "{userName || '用户'} · 共 {items.length} 条");
replaceExact('src/app/lease-submission/page.tsx', '>Prev</button>', '>上一页</button>');
replaceExact('src/app/lease-submission/page.tsx', '>Next</button>', '>下一页</button>');
replaceExact('src/app/lease-submission/page.tsx', "['Company','Building','Area (㎡)','Effective rent','Quarter','Submitted','Actions']", "['公司','楼宇','面积 (㎡)','净有效租金','季度','提交日期','操作']");
replaceExact('src/app/lease-submission/page.tsx', '<Edit2 size={11} /> Edit</button>', '<Edit2 size={11} /> 编辑</button>');
replaceExact('src/app/lease-submission/page.tsx', '<Gift size={11} /> Transfer</button>', '<Gift size={11} /> 转交</button>');
replaceExact('src/app/lease-submission/page.tsx', '>LEASE SUBMISSION</h1>', '>租赁成交填报</h1>');
replaceExact('src/app/lease-submission/page.tsx', "{complete ? 'TARGET MET' : 'IN PROGRESS'}", "{complete ? '已完成' : '进行中'}");
replaceExact('src/app/lease-submission/page.tsx', "{userName || 'Broker'} · Data Entry Workspace", "{userName || '用户'} · 数据录入工作区");
replaceExact('src/app/lease-submission/page.tsx', '>Team monitoring</Link>', '>团队监控</Link>');
replaceExact('src/app/lease-submission/page.tsx', '<ArrowLeft size={12} /> Workspace</Link>', '<ArrowLeft size={12} /> 主页</Link>');
replaceExact('src/app/lease-submission/page.tsx', '<Plus size={13} /> New transaction</button>', '<Plus size={13} /> 新增成交</button>');
replaceExact('src/app/lease-submission/page.tsx', 'aria-label="Lease entry workspace status"', 'aria-label="租赁成交填报状态"');
replaceExact('src/app/lease-submission/page.tsx', '>Weekly target</div>', '>本周目标</div>');
replaceExact('src/app/lease-submission/page.tsx', '>My records</div>', '>我的记录</div>');
replaceExact('src/app/lease-submission/page.tsx', '>Workspace status</div>', '>工作区状态</div>');
replaceExact('src/app/lease-submission/page.tsx', "{loading ? 'Refreshing' : 'Ready'}", "{loading ? '刷新中' : '就绪'}");
replaceExact('src/app/lease-submission/page.tsx', '>Last write</div>', '>最近写入</div>');
replaceExact('src/app/lease-submission/page.tsx', "'This session: none'", "'本次会话暂无'", 1);
replaceExact('src/app/lease-submission/page.tsx', 'Weekly progress: {progressError}', '本周进度：{progressError}');
replaceExact('src/app/lease-submission/page.tsx', 'aria-label="Retry weekly progress"', 'aria-label="重试加载本周进度"');
replaceExact('src/app/lease-submission/page.tsx', 'Submission history: {submissionsError}', '提交记录：{submissionsError}');
replaceExact('src/app/lease-submission/page.tsx', 'aria-label="Retry submission history"', 'aria-label="重试加载提交记录"');
replaceExact('src/app/lease-submission/page.tsx', 'Team submissions: {teamError}', '团队成交：{teamError}');
replaceExact('src/app/lease-submission/page.tsx', '>Loading team data…</div>', '>正在加载团队数据…</div>');
replaceExact('src/app/lease-submission/page.tsx', '<Gift size={15} className="text-emerald-600" /> Transfer record</h2>', '<Gift size={15} className="text-emerald-600" /> 转交成交记录</h2>');
replaceExact('src/app/lease-submission/page.tsx', '>Cancel</button>', '>取消</button>');
replaceExact('src/app/lease-submission/page.tsx', "{transferring ? 'Transferring…' : 'Confirm transfer'}", "{transferring ? '转交中…' : '确认转交'}");

// Research Library: make browsing/search the visible identity; keep storage/API
// implementation details internal and keep management actions permission-gated.
replaceExact('src/app/oss/page.tsx', 'eyebrow="Research Library"', 'eyebrow="资料检索"');
replaceExact(
  'src/components/OSSManager.tsx',
  "return ({ folder: 'Folder', pdf: 'PDF', presentation: 'PPT', document: 'Word', spreadsheet: 'Excel', other: 'File', all: 'All' } as const)[type];",
  "return ({ folder: '文件夹', pdf: 'PDF', presentation: 'PPT', document: 'Word', spreadsheet: 'Excel', other: '文件', all: '全部' } as const)[type];",
);
replaceExact('src/components/OSSManager.tsx', '>Research Library</button>', '>研究资料库</button>');
replaceExact('src/components/OSSManager.tsx', 'OSS 单次返回上限', '云端存储单次返回上限');
replaceExact('src/components/OSSManager.tsx', '>Upload status</span>', '>上传状态</span>');
replaceExact('src/components/OSSManager.tsx', '<th className="px-3 py-2">Title</th>', '<th className="px-3 py-2">名称</th>');
replaceExact('src/components/OSSManager.tsx', '<th className="w-24 px-3 py-2">Type</th>', '<th className="w-24 px-3 py-2">类型</th>');
replaceExact('src/components/OSSManager.tsx', '<th className="w-28 px-3 py-2">Size</th>', '<th className="w-28 px-3 py-2">大小</th>');
replaceExact('src/components/OSSManager.tsx', '<th className="w-32 px-3 py-2">Modified</th>', '<th className="w-32 px-3 py-2">修改时间</th>');
replaceExact('src/components/OSSManager.tsx', '<th className="w-52 px-3 py-2 text-right">Actions</th>', '<th className="w-52 px-3 py-2 text-right">操作</th>');
replaceExact('src/components/OSSManager.tsx', "item.type === 'folder' ? 'Folder' : item.size || '—'", "item.type === 'folder' ? '文件夹' : item.size || '—'");
replaceExact('src/components/OSSManager.tsx', 'OSS 上传失败（HTTP ${xhr.status}）', '云端存储上传失败（HTTP ${xhr.status}）');
replaceExact('src/components/OSSManager.tsx', 'OSS 上传网络错误', '云端存储上传网络错误');

// Settings/Admin: align page identity with the Home user-menu contract while
// preserving their focused settings/admin layouts.
replaceExact('src/app/settings/page.tsx', '>个人设置</span>', '>设置</span>');
replaceExact('src/app/admin/layout.tsx', '>Administration</span>', '>系统管理</span>');
replaceExact('src/app/admin/layout.tsx', '>Data Administration</span>', '>数据管理后台</span>');
replaceAtLeast('src/components/admin/AdminSidebar.tsx', "label: 'Users & Access'", "label: '用户与权限'", 1);
replaceExact('src/components/admin/AdminSidebar.tsx', "users: { title: 'Users & Access', description: '用户资料、角色、账号状态与任务归属。', group: 'Users & Access' }", "users: { title: '用户与权限', description: '用户资料、角色、账号状态与任务归属。', group: '用户与权限' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "impersonate: { title: 'User Impersonation', description: '以只读方式模拟现有用户的真实业务视角。', group: 'Users & Access' }", "impersonate: { title: '用户模拟', description: '以只读方式模拟现有用户的真实业务视角。', group: '用户与权限' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "database: { title: 'Database Management', description: '维护系统现有核心业务表与记录。', group: 'Data Management' }", "database: { title: '数据库管理', description: '维护系统现有核心业务表与记录。', group: '数据管理' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "submissions: { title: 'Submission Management', description: '查看和管理现有季度填报记录。', group: 'Data Management' }", "submissions: { title: '填报管理', description: '查看和管理现有季度填报记录。', group: '数据管理' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "schema: { title: 'Data Relationships', description: '查看现有数据表之间的关联结构。', group: 'Data Management' }", "schema: { title: '数据关联', description: '查看现有数据表之间的关联结构。', group: '数据管理' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "oss: { title: 'Research Library Management', description: '管理云端研究资料、目录和文件。', group: 'Data Management' }", "oss: { title: '资料库管理', description: '管理云端研究资料、目录和文件。', group: '数据管理' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "logs: { title: 'Audit & Activity', description: '审阅系统已记录的操作和审计事件。', group: 'Audit & Activity' }", "logs: { title: '审计日志', description: '审阅系统已记录的操作和审计事件。', group: '审计与活动' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "notice: { title: 'System Notices', description: '维护系统公告和运营通知。', group: 'System / Operations' }", "notice: { title: '系统公告', description: '维护系统公告和运营通知。', group: '系统与运营' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "memo: { title: 'Memos', description: '维护后台现有备忘录内容。', group: 'System / Operations' }", "memo: { title: '备忘录', description: '维护后台现有备忘录内容。', group: '系统与运营' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "issues: { title: 'Requests & Issues', description: '处理用户提交的需求与问题反馈。', group: 'System / Operations' }", "issues: { title: '需求反馈', description: '处理用户提交的需求与问题反馈。', group: '系统与运营' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "changelog: { title: 'Change Log', description: '维护面向系统用户的更新记录。', group: 'System / Operations' }", "changelog: { title: '更新日志', description: '维护面向系统用户的更新记录。', group: '系统与运营' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "debug: { title: 'Data Diagnostics', description: '开发与维护期间使用的数据诊断工具。', group: 'Development / Maintenance' }", "debug: { title: '数据诊断', description: '开发与维护期间使用的数据诊断工具。', group: '开发与维护' }");
replaceExact('src/components/admin/AdminSidebar.tsx', "label: 'Data Management'", "label: '数据管理'");
replaceExact('src/components/admin/AdminSidebar.tsx', "label: 'Audit & Activity'", "label: '审计与活动'");
replaceExact('src/components/admin/AdminSidebar.tsx', "label: 'System / Operations'", "label: '系统与运营'");
replaceExact('src/components/admin/AdminSidebar.tsx', "label: 'Development / Maintenance'", "label: '开发与维护'");
replaceExact('src/components/admin/AdminSidebar.tsx', "description: 'OSS 文件管理'", "description: '资料文件管理'");
replaceExact('src/components/admin/AdminSidebar.tsx', '>Administration</span>', '>系统管理</span>');
replaceExact('src/components/admin/AdminSidebar.tsx', '>Development / Maintenance</h2>', '>开发与维护</h2>');

// Permanent regression coverage: user-visible page identity and return seams.
const testPath = 'src/__tests__/cross-page-product-continuity.test.ts';
const testContent = `import fs from 'node:fs';\nimport path from 'node:path';\nimport { describe, expect, it } from 'vitest';\n\nconst root = process.cwd();\nconst source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');\n\ndescribe('Cross-page product continuity', () => {\n  it('keeps Home as the canonical Chinese product naming contract', () => {\n    const home = source('src/components/home/HomeWorkspace.tsx');\n    for (const label of ['北京办公楼市场地图', '季度数据填报', '租赁成交填报', '研究资料库', '系统管理', '设置']) {\n      expect(home).toContain(label);\n    }\n  });\n\n  it('keeps the Map GIS shell branded and aligned to the Home product name', () => {\n    const gate = source('src/app/map/MapRouteGate.tsx');\n    const view = source('src/app/map/components/MapWorkbenchView.tsx');\n    expect(gate).toContain('h-[58px]');\n    expect(gate).toContain('北京办公楼市场地图');\n    expect(view).toContain('北京办公楼市场地图');\n    expect(view).not.toContain('MAP 2.0');\n    expect(view).not.toContain('MAP WORKBENCH');\n    expect(view).toContain('href="/"');\n  });\n\n  it('uses Chinese product and status language in Quarterly Update', () => {\n    const page = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');\n    expect(page).toContain('季度数据填报');\n    for (const oldLabel of ['QUARTERLY UPDATE', 'Cloud draft enabled', 'Save draft', 'Submit current group', 'Retry submit']) {\n      expect(page).not.toContain(oldLabel);\n    }\n    expect(page).toContain('href="/"');\n  });\n\n  it('uses Chinese product and workflow language in Lease Submission', () => {\n    const page = source('src/app/lease-submission/page.tsx');\n    expect(page).toContain('租赁成交填报');\n    for (const oldLabel of ['LEASE SUBMISSION', 'Data Entry Workspace', 'Weekly target', 'My submissions', 'New transaction', 'Transfer record']) {\n      expect(page).not.toContain(oldLabel);\n    }\n    expect(page).toContain('href="/"');\n  });\n\n  it('presents Research as a library rather than an OSS console', () => {\n    const page = source('src/app/oss/page.tsx');\n    const manager = source('src/components/OSSManager.tsx');\n    expect(page).toContain('title="研究资料库"');\n    expect(page).toContain('eyebrow="资料检索"');\n    expect(manager).toContain('研究资料库');\n    expect(manager).not.toContain('>Research Library</button>');\n    expect(manager).not.toContain('>Upload status</span>');\n    expect(manager).toContain('canManage ?');\n    expect(page).toContain('href="/"');\n  });\n\n  it('aligns Settings and Admin identities with the Home user menu', () => {\n    const settings = source('src/app/settings/page.tsx');\n    const adminLayout = source('src/app/admin/layout.tsx');\n    const adminSidebar = source('src/components/admin/AdminSidebar.tsx');\n    expect(settings).toContain('>设置</span>');\n    expect(adminLayout).toContain('>系统管理</span>');\n    expect(adminLayout).not.toContain('>Administration</span>');\n    expect(adminSidebar).not.toContain("label: 'Data Management'");\n    expect(adminSidebar).not.toContain('>Administration</span>');\n    expect(settings).toContain('href="/"');\n    expect(adminLayout).toContain('href="/"');\n  });\n});\n`;
write(testPath, testContent);

// Durable changelog entry.
const changelogMarker = '\n\n---\n\n## 2026-08-25 — Home visual hierarchy rebuild';
const changelogEntry = `\n\n---\n\n## 2026-08-25 — Cross-page Product Continuity QA\n\n### Area\nHome → Map / Quarterly Update / Lease Submission / Research Library / Settings / Admin\n\n### What changed\n\n- Kept the Home information architecture unchanged and treated its Chinese workspace names as the product-language contract for destination pages.\n- Aligned Map route loading and first-screen identity to “北京办公楼市场地图” while preserving the full-canvas GIS workbench.\n- Replaced legacy visible English workspace/status language in Quarterly and Lease Data Entry with Chinese equivalents without changing their dense data-entry topology or business logic.\n- Reframed the /oss surface visibly as “研究资料库 / 资料检索”; storage implementation terminology remains internal, and upload/management actions remain permission-gated.\n- Aligned Settings and Admin top-level identity to “设置” and “系统管理”, and translated visible Admin navigation groups/section names without changing routes, permissions or backend section keys.\n- Added source-contract regression coverage for canonical destination names, legacy-label removal, Map loading-shell continuity and return-to-Home seams.\n\n### Why\n\nHome had reached a coherent Chinese product language, but several destination pages still presented old English product identities and status vocabulary. That created the impression of navigating between separate systems even though routes, permissions and business workflows were shared.\n\n### Impact\n\n- Home structure and module priority are unchanged.\n- Map remains a GIS workspace; Data Entry remains dense; Research remains retrieval-first; Admin remains a compact backend.\n- Global Arial + Chinese fallback typography, Colliers brand blue, existing border/radius tokens, permissions, session boundaries, audit behavior and data flows are preserved.\n- All audited destination shells retain explicit return-to-Home links; Browser Back behavior remains native route history rather than being replaced with custom navigation.\n\n### Verification\n\n- Added \\`cross-page-product-continuity.test.ts\\` source-level regression coverage.\n- Typecheck → Lint → Test → Production Build are run in sequence on the exact patched working tree before the branch commit is created.\n- A current authenticated deployment-level click/Back visual pass is still blocked if Vercel Preview cannot be created or accessed; this must be reported separately rather than inferred from source tests.\n\n### Follow-up\n\n- When a reachable authenticated Preview is available, repeat the critical click/Back paths at desktop and 390–430px mobile widths, focusing on first-paint/header continuity and overlay behavior.\n\n## 2026-08-25 — Home visual hierarchy rebuild`;
replaceExact('CHANGELOG.md', changelogMarker, changelogEntry);

console.log('Cross-page continuity patch applied successfully.');

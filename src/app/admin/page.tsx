"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Menu } from "lucide-react";

import { AdminSidebar, ADMIN_SECTION_META, type AdminSection } from "@/src/components/admin/AdminSidebar";
import { PageErrorBoundary } from "@/src/components/ErrorBoundary/PageErrorBoundary";

function AdminSectionLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" role="status" aria-label="正在加载管理栏目">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
    </div>
  );
}

const DatabaseManager = dynamic(() => import("@/src/components/admin/DatabaseManager").then(module => module.DatabaseManager), { loading: AdminSectionLoading });
const UserManager = dynamic(() => import("@/src/components/admin/UserManager").then(module => module.UserManager), { loading: AdminSectionLoading });
const SubmissionManager = dynamic(() => import("@/src/components/admin/SubmissionManager").then(module => module.SubmissionManager), { loading: AdminSectionLoading });
const SchemaMap = dynamic(() => import("@/src/components/admin/SchemaMap"), { loading: AdminSectionLoading, ssr: false });
const OSSManager = dynamic(() => import("@/src/components/OSSManager").then(module => module.OSSManager), { loading: AdminSectionLoading });
const NoticeManager = dynamic(() => import("@/src/components/NoticeManager").then(module => module.NoticeManager), { loading: AdminSectionLoading });
const MemoManager = dynamic(() => import("@/src/components/admin-memo/MemoManager").then(module => module.MemoManager), { loading: AdminSectionLoading });
const IssueManager = dynamic(() => import("@/src/components/admin/IssueManager").then(module => module.IssueManager), { loading: AdminSectionLoading });
const ChangelogManager = dynamic(() => import("@/src/components/ChangelogManager").then(module => module.ChangelogManager), { loading: AdminSectionLoading });
const AuditLogPage = dynamic(() => import("@/src/components/admin/AuditLogPage").then(module => module.AuditLogPage), { loading: AdminSectionLoading });
const ImpersonationPanel = dynamic(() => import("@/src/components/admin/ImpersonationPanel").then(module => module.ImpersonationPanel), { loading: AdminSectionLoading });
const DataDebugPanel = dynamic(() => import("@/src/components/admin/DataDebugPanel").then(module => module.DataDebugPanel), { loading: AdminSectionLoading });

function AdminPageContent() {
  const [activeSection, setActiveSection] = useState<AdminSection>('database');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const meta = ADMIN_SECTION_META[activeSection];

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <AdminSidebar
        active={activeSection}
        onChange={setActiveSection}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--cd-color-canvas)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2 sm:px-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-md border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-50 lg:hidden"
            aria-label="打开管理导航"
          >
            <Menu size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#003e7e]">{meta.group}</span>
              <span className="text-zinc-300">/</span>
              <h1 className="truncate text-[13px] font-semibold text-zinc-900">{meta.title}</h1>
            </div>
            <p className="mt-0.5 hidden truncate text-[10px] text-zinc-500 sm:block">{meta.description}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeSection === 'database' && <DatabaseManager />}
          {activeSection === 'users' && <UserManager />}
          {activeSection === 'submissions' && <SubmissionManager />}
          {activeSection === 'schema' && <div className="h-full min-h-0 w-full overflow-hidden"><SchemaMap /></div>}
          {activeSection === 'oss' && <div className="h-full min-h-0 w-full overflow-hidden"><OSSManager userEmail="admin-console" /></div>}
          {activeSection === 'notice' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><NoticeManager adminEmail="" /></div>}
          {activeSection === 'memo' && <div className="h-full min-h-0 w-full overflow-hidden"><MemoManager adminEmail="admin-console" /></div>}
          {activeSection === 'issues' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><IssueManager adminEmail="" /></div>}
          {activeSection === 'changelog' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><ChangelogManager adminEmail="" /></div>}
          {activeSection === 'logs' && <AuditLogPage />}
          {activeSection === 'impersonate' && <ImpersonationPanel />}
          {activeSection === 'debug' && <DataDebugPanel />}
        </div>
      </main>
    </div>
  );
}

export default function AdminPage() {
  return (
    <PageErrorBoundary pageName="系统管理后台">
      <AdminPageContent />
    </PageErrorBoundary>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { AdminSidebar, type AdminSection } from "@/src/components/admin/AdminSidebar";
import { getSession } from "@/src/services/Auth";
import { PageErrorBoundary } from "@/src/components/ErrorBoundary/PageErrorBoundary";

function AdminSectionLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" role="status" aria-label="正在加载管理栏目">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
    </div>
  );
}

const DatabaseManager = dynamic(
  () => import("@/src/components/admin/DatabaseManager").then(module => module.DatabaseManager),
  { loading: AdminSectionLoading },
);
const UserManager = dynamic(
  () => import("@/src/components/admin/UserManager").then(module => module.UserManager),
  { loading: AdminSectionLoading },
);
const SubmissionManager = dynamic(
  () => import("@/src/components/admin/SubmissionManager").then(module => module.SubmissionManager),
  { loading: AdminSectionLoading },
);
const SchemaMap = dynamic(
  () => import("@/src/components/admin/SchemaMap"),
  { loading: AdminSectionLoading, ssr: false },
);
const OSSManager = dynamic(
  () => import("@/src/components/OSSManager").then(module => module.OSSManager),
  { loading: AdminSectionLoading },
);
const NoticeManager = dynamic(
  () => import("@/src/components/NoticeManager").then(module => module.NoticeManager),
  { loading: AdminSectionLoading },
);
const MemoManager = dynamic(
  () => import("@/src/components/admin-memo/MemoManager").then(module => module.MemoManager),
  { loading: AdminSectionLoading },
);
const IssueManager = dynamic(
  () => import("@/src/components/admin/IssueManager").then(module => module.IssueManager),
  { loading: AdminSectionLoading },
);
const ChangelogManager = dynamic(
  () => import("@/src/components/ChangelogManager").then(module => module.ChangelogManager),
  { loading: AdminSectionLoading },
);
const AuditLogPage = dynamic(
  () => import("@/src/components/admin/AuditLogPage").then(module => module.AuditLogPage),
  { loading: AdminSectionLoading },
);
const ImpersonationPanel = dynamic(
  () => import("@/src/components/admin/ImpersonationPanel").then(module => module.ImpersonationPanel),
  { loading: AdminSectionLoading },
);
const DataDebugPanel = dynamic(
  () => import("@/src/components/admin/DataDebugPanel").then(module => module.DataDebugPanel),
  { loading: AdminSectionLoading },
);

// ─── 主页面 ───────────────────────────────────────────────────────────────────

const RESTRICTED_ADMIN_EMAILS = ['judy.li@colliers.com'];

function AdminPageContent() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<AdminSection>('database');
  const [adminEmail, setAdminEmail] = useState('');

  useEffect(() => {
    getSession().then(s => {
      if (s?.user?.email) {
        if (RESTRICTED_ADMIN_EMAILS.includes(s.user.email)) {
          router.replace('/');
          return;
        }
        setAdminEmail(s.user.email);
      }
    });
  }, [router]);

  return (
    <div className="flex h-full overflow-hidden w-full">
      <AdminSidebar active={activeSection} onChange={setActiveSection} />

      <main className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex flex-col bg-gradient-to-br from-zinc-50 to-white">
        {activeSection === 'database'    && <DatabaseManager />}
        {activeSection === 'users'       && <UserManager />}
        {activeSection === 'submissions' && <SubmissionManager />}
        {activeSection === 'schema'      && <div className="flex-1 min-h-0 overflow-hidden w-full"><SchemaMap /></div>}
        {activeSection === 'oss'         && <div className="flex-1 min-h-0 overflow-hidden w-full"><OSSManager userEmail={adminEmail || 'unknown'} /></div>}
        {activeSection === 'notice'      && <div className="flex-1 min-h-0 overflow-auto p-6 w-full"><NoticeManager adminEmail={adminEmail} /></div>}
        {activeSection === 'memo'        && <div className="flex-1 min-h-0 overflow-hidden w-full"><MemoManager adminEmail={adminEmail || 'unknown'} /></div>}
        {activeSection === 'issues'      && <div className="flex-1 min-h-0 overflow-auto p-6 w-full"><IssueManager adminEmail={adminEmail} /></div>}
        {activeSection === 'changelog'   && <div className="flex-1 min-h-0 overflow-auto p-6 w-full"><ChangelogManager adminEmail={adminEmail} /></div>}
        {activeSection === 'logs'        && <AuditLogPage />}
        {activeSection === 'impersonate' && <ImpersonationPanel />}
        {activeSection === 'debug'       && <DataDebugPanel />}
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

"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { Menu } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { AdminSidebar, ADMIN_SECTION_META, type AdminSection } from "@/src/components/admin/AdminSidebar";
import { PageErrorBoundary } from "@/src/components/ErrorBoundary/PageErrorBoundary";
import { IconButton, LoadingState } from "@/src/components/ui";
import { useAdminOperator } from "./adminOperatorEmail";
import { noticeDraftKey } from "@/src/components/admin/noticeDraftStorage";
import { useAppSession } from "@/src/components/SessionProvider";
import { isAdminRole } from "@/src/utils/adminAccess";

function AdminSectionLoading() {
  return <div className="flex min-h-0 flex-1 items-center justify-center px-6"><LoadingState label="正在加载管理栏目" rows={0} /></div>;
}

const DatabaseManager = dynamic(() => import("@/src/components/admin/DatabaseManagerEntry").then(module => module.DatabaseManagerEntry), { loading: AdminSectionLoading });
const UserManager = dynamic(() => import("@/src/components/admin/UserManager").then(module => module.UserManager), { loading: AdminSectionLoading });
const SubmissionManager = dynamic(() => import("@/src/components/admin/SubmissionManager").then(module => module.SubmissionManager), { loading: AdminSectionLoading });
const SchemaMap = dynamic(() => import("@/src/components/admin/SchemaMap"), { loading: AdminSectionLoading, ssr: false });
const OSSManager = dynamic(() => import("@/src/components/OSSManager").then(module => module.OSSManager), { loading: AdminSectionLoading });
const NoticeManager = dynamic(() => import("@/src/components/NoticeManager").then(module => module.NoticeManager), { loading: AdminSectionLoading });
const MemoManager = dynamic(() => import("@/src/components/admin-memo/MemoManager").then(module => module.MemoManager), { loading: AdminSectionLoading });
const IssueManager = dynamic(() => import("@/src/components/admin/IssueManager").then(module => module.default), { loading: AdminSectionLoading });
const ChangelogManager = dynamic(() => import("@/src/components/ChangelogManager").then(module => module.ChangelogManager), { loading: AdminSectionLoading });
const AuditLogPage = dynamic(() => import("@/src/components/admin/AuditLogPage").then(module => module.AuditLogPage), { loading: AdminSectionLoading });
const ImpersonationPanel = dynamic(() => import("@/src/components/admin/ImpersonationPanel").then(module => module.ImpersonationPanel), { loading: AdminSectionLoading });
const DataDebugPanel = dynamic(() => import("@/src/components/admin/DataDebugPanel").then(module => module.DataDebugPanel), { loading: AdminSectionLoading });

function AdminImpersonationSection() {
  const operator = useAdminOperator();
  const { session, status } = useAppSession();
  if (status === 'loading') return <AdminSectionLoading />;
  if (!operator || !session || session.user.id !== operator.userId || session.session.user.id !== operator.userId || !isAdminRole(session.role)) {
    return <p role="status" className="p-4 text-sm">登录状态已变化，请重新进入管理后台。</p>;
  }
  return <ImpersonationPanel key={operator.userId} operatorUserId={operator.userId} />;
}

function AdminPageContent() {
  const searchParams = useSearchParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const operator = useAdminOperator();
  const adminEmail = operator?.email ?? '';
  const noticeStorageKey = operator?.sessionId ? noticeDraftKey(operator.userId, operator.sessionId) : null;
  const requestedSection = searchParams.get('section');
  const activeSection: AdminSection = requestedSection && requestedSection in ADMIN_SECTION_META && requestedSection !== 'display-overrides'
    ? requestedSection as AdminSection
    : 'database';

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <AdminSidebar active={activeSection} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--cd-color-canvas)]">
        <div className="flex h-11 shrink-0 items-center border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 lg:hidden">
          <IconButton label="打开管理导航" className="min-h-11 min-w-11" variant="ghost" size="sm" onClick={() => setMobileNavOpen(true)}><Menu size={16} /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeSection === 'database' && <DatabaseManager />}
          {activeSection === 'users' && <UserManager />}
          {activeSection === 'submissions' && <SubmissionManager />}
          {activeSection === 'schema' && <div className="h-full min-h-0 w-full overflow-hidden"><SchemaMap /></div>}
          {activeSection === 'oss' && <div className="h-full min-h-0 w-full overflow-hidden"><OSSManager userEmail={adminEmail || 'unknown'} /></div>}
          {activeSection === 'notice' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><NoticeManager key={noticeStorageKey ?? adminEmail} adminEmail={adminEmail} draftStorageKey={noticeStorageKey} /></div>}
          {activeSection === 'memo' && <div className="h-full min-h-0 w-full overflow-hidden"><MemoManager adminEmail={adminEmail || 'unknown'} /></div>}
          {activeSection === 'issues' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><IssueManager key={adminEmail} adminEmail={adminEmail} /></div>}
          {activeSection === 'changelog' && <div className="h-full min-h-0 w-full overflow-auto p-4 sm:p-6"><ChangelogManager key={adminEmail} adminEmail={adminEmail} /></div>}
          {activeSection === 'logs' && <AuditLogPage />}
          {activeSection === 'impersonate' && <AdminImpersonationSection />}
          {activeSection === 'debug' && <DataDebugPanel />}
        </div>
      </main>
    </div>
  );
}

export default function AdminPage() {
  return <PageErrorBoundary pageName="系统管理后台"><Suspense fallback={<AdminSectionLoading />}><AdminPageContent /></Suspense></PageErrorBoundary>;
}

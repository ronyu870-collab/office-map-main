import { AppHeader, LoadingState } from '@/src/components/ui';
import { WorkspaceShell } from '@/src/components/layout';

export function MapLoadingShell() {
  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden"
      header={<AppHeader title="北京办公楼市场地图" homeHref="/" />}
    >
      <div className="flex h-full items-center justify-center px-6">
        <LoadingState label="正在加载北京办公楼市场地图" rows={0} className="w-full max-w-sm" />
      </div>
    </WorkspaceShell>
  );
}

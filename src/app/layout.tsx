import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/src/components/SessionProvider";
import { SWRConfig } from "swr";
import { NavigationProgress } from "@/src/components/NavigationProgress";
import { RootErrorBoundary } from "@/src/components/ErrorBoundary/RootErrorBoundary";
import { DemoProvider, DemoBanner } from "@/src/components/demo";
import { ImpersonationProvider } from "@/src/contexts/ImpersonationContext";
import { ImpersonationBanner } from "@/src/components/ImpersonationBanner";
import { PageViewTracker } from "@/src/components/PageViewTracker";

export const metadata: Metadata = {
  title: "COLLIERS DATA | 办公楼市场监测",
  description: "高力国际内部数据看板",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full flex flex-col">
        <RootErrorBoundary>
          <NavigationProgress />
          <SWRConfig
            value={{
              revalidateOnFocus: false,
              dedupingInterval: 10000, // Increased from 5s to 10s to reduce unnecessary requests
              revalidateOnReconnect: true,
              errorRetryCount: 3,
              errorRetryInterval: 2000,
              shouldRetryOnError: true,
            }}
          >
            <SessionProvider>
              <ImpersonationProvider>
                <DemoProvider>
                  <PageViewTracker />
                  <ImpersonationBanner />
                  <DemoBanner />
                  {children}
                </DemoProvider>
              </ImpersonationProvider>
            </SessionProvider>
          </SWRConfig>
        </RootErrorBoundary>
      </body>
    </html>
  );
}

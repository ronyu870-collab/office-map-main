import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedPresentation } from "@/src/components/pitch/workspace/SharedPresentation";
import { pitchSharePath } from "@/src/lib/pitch/workspace/shareLink";

export const metadata: Metadata = {
  title: "共享演示",
  robots: { index: false, follow: false },
};

export default async function SharedPitchPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  if (!pitchSharePath(shareId)) notFound();
  return <SharedPresentation shareId={shareId.toLowerCase()} />;
}

import type { ReactNode } from "react";
import { PitchHandoffProvider } from "@/src/components/pitch/PitchHandoffLink";

export default function LeaseHistoryLayout({ children }: { children: ReactNode }) {
  return <PitchHandoffProvider enabled={process.env.PITCH_STUDIO_ENABLED === "true"}>
    {children}
  </PitchHandoffProvider>;
}

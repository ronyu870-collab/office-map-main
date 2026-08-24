"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

export type ColliersPerformanceDetail = {
  name: string;
  value: number;
  rating?: string;
  id?: string;
  navigationType?: string;
};

const EVENT_NAME = "colliers:performance";

function publish(detail: ColliersPerformanceDetail) {
  window.dispatchEvent(new CustomEvent<ColliersPerformanceDetail>(EVENT_NAME, { detail }));

  if (process.env.NODE_ENV === "development") {
    console.debug("[Colliers Performance]", detail);
  }
}

export function PerformanceReporter() {
  useReportWebVitals((metric) => {
    publish({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
    });
  });

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;

    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes("longtask")) return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        publish({
          name: "longtask",
          value: entry.duration,
        });
      }
    });

    observer.observe({ type: "longtask", buffered: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

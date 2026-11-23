"use client";

import { useEffect } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

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

const reportVital = (metric: Metric) => publish({
  name: metric.name, value: metric.value, rating: metric.rating,
  id: metric.id, navigationType: metric.navigationType,
});

// Vitals observers live for this document, including bfcache restoration.
// Subscribe once even if React remounts the reporter; the public library owns
// their page-lifecycle listeners and removes its LCP input/idle listeners.
let vitalsSubscribed = false;
function subscribeVitals() {
  if (vitalsSubscribed) return;
  vitalsSubscribed = true;
  onCLS(reportVital); onFCP(reportVital); onINP(reportVital);
  onLCP(reportVital); onTTFB(reportVital);

  // Keep the existing legacy FID event where the browser still supports it.
  // Modern Core Web Vitals use INP; this one-shot observer releases itself.
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('first-input')) {
    const observer = new PerformanceObserver(list => {
      const entry = list.getEntries()[0] as PerformanceEventTiming | undefined;
      if (!entry) return;
      const value = Math.max(0, entry.processingStart - entry.startTime);
      publish({ name: 'FID', value, rating: value > 300 ? 'poor' : value > 100 ? 'needs-improvement' : 'good' });
      observer.disconnect();
    });
    observer.observe({ type: 'first-input', buffered: true });
  }
}

export function PerformanceReporter() {
  useEffect(subscribeVitals, []);

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

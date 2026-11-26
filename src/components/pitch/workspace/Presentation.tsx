/* eslint-disable @next/next/no-img-element -- same authenticated previews as the workbench. */
"use client";

import * as React from "react";
import { Button, Dialog } from "@/src/components/ui";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import styles from "./workspace.module.css";

export type PresentationSlide = { id: string; title: string; image?: string; error?: string };

export function Presentation({
  slides, active, onRetry, disabled = false,
}: { slides: PresentationSlide[]; active: string | null; onRetry: () => void; disabled?: boolean }) {
  const [opened, setOpened] = React.useState(false);
  const [slideId, setSlideId] = React.useState<string | null>(null);
  const index = Math.max(0, slides.findIndex((slide) => slide.id === slideId));
  const slide = slides[index];
  const move = (to: number) => {
    const target = slides[Math.min(slides.length - 1, Math.max(0, to))];
    if (target) setSlideId(target.id);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && ["SELECT", "INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    const target = ["ArrowRight", "ArrowDown", "PageDown"].includes(event.key) ? index + 1
      : ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key) ? index - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? slides.length - 1 : null;
    if (target !== null) {
      event.preventDefault();
      move(target);
    }
  };

  return <>
    <Button variant="ghost" disabled={disabled || !slides.length} onClick={() => {
      setSlideId(active ?? slides[0]?.id ?? null);
      setOpened(true);
    }}>
      <Play size={16} /> 演示
    </Button>
    <div onKeyDown={onKeyDown}>
    <Dialog open={opened} onOpenChange={setOpened} title="演示文稿" closeLabel="退出演示" presentation="fullscreen">
      <div className={styles.presentation}>
        <div className={styles.presentationStage} role="region" aria-label="演示画布">
          {slide?.image ? <img src={slide.image} alt={slide.title} />
            : slide?.error ? <div role="alert"><p>{slide.error}</p><Button variant="secondary" onClick={onRetry}>重试预览</Button></div>
            : <p role="status">{slide ? "正在载入页面…" : "没有可演示的页面。"}</p>}
        </div>
        <div className={styles.presentationControls}>
          <Button variant="ghost" aria-label="上一页" disabled={index === 0} onClick={() => move(index - 1)}>
            <ChevronLeft size={18} />
          </Button>
          <output aria-live="polite">第 {slides.length ? index + 1 : 0} 页 / 共 {slides.length} 页</output>
          <Button variant="ghost" aria-label="下一页" disabled={index + 1 >= slides.length} onClick={() => move(index + 1)}>
            <ChevronRight size={18} />
          </Button>
          <label className={styles.presentationJump}>
            <span className={styles.srOnly}>跳到页面</span>
            <select value={slide?.id ?? ""} onChange={(event) => setSlideId(event.target.value)}>
              {slides.map((item, i) => <option key={item.id} value={item.id}>{i + 1}. {item.title}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Dialog>
    </div>
  </>;
}

/* eslint-disable @next/next/no-img-element -- authenticated SVG previews use disposable blob URLs. */
"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { useAppSession } from "@/src/components/SessionProvider";
import { WorkspaceShell } from "@/src/components/layout";
import { AppHeader, Button } from "@/src/components/ui";
import { pitchShareQueryKey } from "@/src/lib/pitch/workspace/shareLink";
import { supabase } from "@/src/services/supabaseClient";
import { getSessionIdFromAccessToken } from "@/src/utils/authSession";
import { WorkspaceError } from "./client";
import styles from "./sharedPresentation.module.css";

const listSchema = z.object({
  id: z.uuid(), title: z.string(), pages: z.array(z.object({ id: z.uuid(), title: z.string() })).min(1).max(50),
});
const slideSchema = z.object({ id: z.uuid(), svg: z.string().min(1) });
const unavailable = "共享演示已失效，或当前账号没有查阅权限。";

type Account = { userId: string; sessionId: string };
async function readShared(input: Record<string, string>, account: Account, signal: AbortSignal) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.id !== account.userId || getSessionIdFromAccessToken(session.access_token) !== account.sessionId) {
    throw new WorkspaceError("登录状态已变化，请重新打开演示。", 401);
  }
  const reply = await fetch("/api/intelligence/pitch/workspace?" + new URLSearchParams(input), {
    cache: "no-store", signal, headers: { Authorization: "Bearer " + session.access_token },
  });
  if (!reply.ok) throw new WorkspaceError("", reply.status);
  return reply.json() as Promise<unknown>;
}
const accessDenied = (cause: unknown) => cause instanceof WorkspaceError && [401, 403, 404].includes(cause.status);

export function SharedPresentation({ shareId }: { shareId: string }) {
  const { session, status } = useAppSession();
  const userId = session?.session.user.id;
  const sessionId = getSessionIdFromAccessToken(session?.session.access_token ?? null);
  return (
    <WorkspaceShell header={<AppHeader title="Pitch Studio" homeHref="/" />}>
      {status === "loading" ? <p role="status" className={styles.message}>正在读取登录状态…</p>
        : status !== "authenticated" || !session || !userId ? (
          <div className={styles.message}>
            <h1>共享演示</h1>
            <Link href={"/login?" + new URLSearchParams({ [pitchShareQueryKey]: shareId })}>登录查看演示</Link>
          </div>
        ) : session.user.id !== userId ? <p role="alert" className={styles.message}>请退出模拟身份后查看演示。</p>
        : !sessionId ? <p role="alert" className={styles.message}>登录会话无法验证，请重新登录。</p>
        : <ReadOnlyDeck key={JSON.stringify([shareId, userId, sessionId])} shareId={shareId} userId={userId} sessionId={sessionId} />}
    </WorkspaceShell>
  );
}

function ReadOnlyDeck({ shareId, userId, sessionId }: Account & { shareId: string }) {
  const [deck, setDeck] = useState<z.infer<typeof listSchema>>();
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<"denied" | "temporary">();
  const onDenied = useCallback(() => { setDeck(undefined); setError("denied"); }, []);
  useEffect(() => {
    const request = new AbortController();
    async function load() {
      try {
        const result = listSchema.parse(await readShared({ action: "shared_presentation", shareId }, { userId, sessionId }, request.signal));
        if (result.id !== shareId) throw new Error();
        if (!request.signal.aborted) setDeck(result);
      } catch (cause) {
        if (!request.signal.aborted) setError(accessDenied(cause) ? "denied" : "temporary");
      }
    }
    void load();
    return () => request.abort();
  }, [shareId, userId, sessionId, attempt]);

  if (error === "denied") return <p role="alert" className={styles.message}>{unavailable}</p>;
  if (error === "temporary") return (
    <div className={styles.message}>
      <p role="alert">暂时无法打开演示。</p>
      <Button variant="secondary" onClick={() => { setError(undefined); setAttempt(previous => previous + 1); }}>重试</Button>
    </div>
  );
  if (!deck) return <p role="status" className={styles.message}>正在载入演示…</p>;
  const page = deck.pages[index];
  const move = (to: number) => setIndex(Math.min(deck.pages.length - 1, Math.max(0, to)));
  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLSelectElement) return;
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? deck.pages.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    move(next);
  };
  return (
    <section className={styles.deck} aria-labelledby="shared-pitch-title" onKeyDown={handleKey}>
      <h1 id="shared-pitch-title">{deck.title}</h1>
      <div role="region" aria-label="演示画布" className={styles.canvas}>
        <SharedSlide key={page.id} shareId={shareId} page={page} userId={userId} sessionId={sessionId}
          onDenied={onDenied} />
      </div>
      <nav aria-label="演示页码" className={styles.controls}>
        <Button variant="secondary" onClick={() => move(index - 1)} disabled={index === 0}>上一页</Button>
        <label>
          <span className="sr-only">跳到页面</span>
          <select value={index} onChange={event => move(Number(event.target.value))}>
            {deck.pages.map((item, number) => <option key={item.id} value={number}>{number + 1} / {deck.pages.length}　{item.title}</option>)}
          </select>
        </label>
        <Button variant="secondary" onClick={() => move(index + 1)} disabled={index === deck.pages.length - 1}>下一页</Button>
      </nav>
    </section>
  );
}

function SharedSlide({ shareId, page, userId, sessionId, onDenied }: Account & {
  shareId: string; page: z.infer<typeof listSchema>["pages"][number]; onDenied: () => void;
}) {
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    let url: string | undefined;
    async function load() {
      try {
        const result = slideSchema.parse(await readShared({ action: "shared_slide", shareId, slideId: page.id }, { userId, sessionId }, request.signal));
        if (result.id !== page.id) throw new Error();
        if (request.signal.aborted) return;
        url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
        setImage(url);
      } catch (cause) {
        if (request.signal.aborted) return;
        if (accessDenied(cause)) onDenied();
        else setFailed(true);
      }
    }
    void load();
    return () => {
      request.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [shareId, page.id, userId, sessionId, onDenied, attempt]);
  if (image) return <img src={image} alt={page.title} draggable={false} />;
  if (failed) return <div><p role="alert">本页载入失败。</p><Button variant="secondary"
    onClick={() => { setFailed(false); setAttempt(previous => previous + 1); }}>重试</Button></div>;
  return <p role="status">正在载入页面…</p>;
}

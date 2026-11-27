"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Dialog, Input } from "@/src/components/ui";
import { pitchSharePath } from "@/src/lib/pitch/workspace/shareLink";
import { WorkspaceError, type Call } from "./client";

type ShareReceipt = {
  id: string;
  version: number;
  pageIds: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
type Props = {
  projectId: string;
  version: number;
  active: string | null;
  selected: string[];
  pageIds: string[];
  canCreate: boolean;
  call: Call;
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" });

export function SharePanel({ projectId, version, active, selected, pageIds, canCreate, call }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [range, setRange] = useState("all");
  const [links, setLinks] = useState<ShareReceipt[]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [visibleUrl, setVisibleUrl] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string>();
  const retry = useRef<{ key: string; id: string }>(null);
  const pages = pageIds.filter(id => range === "all" || (range === "current" ? id === active : selected.includes(id)));

  async function load() {
    setOpen(true);
    setPending(true);
    setError("");
    try {
      setLinks(await call<ShareReceipt[]>({ action: "shares", projectId }));
    } catch {
      setLinks(undefined);
      setError("暂时无法载入共享记录。");
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || pending || !pages.length) return;
    const recipientEmail = email.trim().toLowerCase();
    const shareKey = JSON.stringify([version, recipientEmail, pages]);
    if (retry.current?.key !== shareKey) retry.current = { key: shareKey, id: crypto.randomUUID() };
    setPending(true);
    setError("");
    setNotice("");
    setVisibleUrl("");
    try {
      const receipt = await call<ShareReceipt>({
        action: "share_create", projectId, expectedVersion: version, recipientEmail,
        shareId: retry.current.id, slideIds: pages,
      }, true);
      retry.current = null;
      setLinks(previous => [receipt, ...(previous ?? []).filter(item => item.id !== receipt.id)]);
      reveal(receipt.id);
      setNotice("已创建只读链接。");
    } catch (cause) {
      setError(cause instanceof WorkspaceError && cause.status === 409
        ? "项目版本已变化。请重新打开项目并核对页码。"
        : cause instanceof WorkspaceError && cause.status === 403
          ? "无法共享给该账号。请核对收件账号的权限，或缩小共享页码范围。"
          : "暂未确认创建结果。请使用原账号和页面范围重试。");
    } finally {
      setPending(false);
    }
  }

  function reveal(id: string) {
    const path = pitchSharePath(id);
    if (path) setVisibleUrl(window.location.origin + path);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(visibleUrl);
      setNotice("已复制链接。");
    } catch {
      setNotice("请从上方输入框手动复制链接。");
    }
  }

  async function revoke(receipt: ShareReceipt) {
    setError("");
    setNotice("");
    setPending(true);
    try {
      const revoked = await call<ShareReceipt>({ action: "share_revoke", projectId, shareId: receipt.id }, true);
      setLinks(previous => previous?.map(item => item.id === receipt.id ? revoked : item));
      if (visibleUrl.endsWith("/" + receipt.id)) setVisibleUrl("");
      setNotice("已撤销共享。");
      setConfirmRevoke(undefined);
    } catch {
      setError("暂未确认撤销结果，请重试。");
    } finally {
      setPending(false);
    }
  }

  return <>
    <Button variant="ghost" onClick={() => void load()}>共享</Button>
    <Dialog open={open} onOpenChange={setOpen} dismissible={!pending} title="共享演示"
      description="指定已获授权的账号查阅选定页面。链接固定在当前保存版本。">
      <div className="grid gap-4">
        <form className="grid gap-3" onSubmit={create}>
          <label className="grid gap-1">
            收件账号邮箱
            <Input type="email" autoComplete="off" required maxLength={254} value={email}
              onChange={event => setEmail(event.target.value)} disabled={pending || !canCreate} />
          </label>
          <label className="grid gap-1">
            共享范围
            <select className="min-h-11 rounded-md border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3"
              value={range} onChange={event => setRange(event.target.value)} disabled={pending || !canCreate}>
              <option value="all">全部页面</option>
              <option value="current" disabled={!active}>当前页</option>
              <option value="selected" disabled={!selected.length}>已选页面</option>
            </select>
          </label>
          {!canCreate && <p>请先保存项目并解决版本冲突，再创建链接。</p>}
          <Button type="submit" className="justify-self-start" disabled={pending || !canCreate || !pages.length}>创建只读链接</Button>
        </form>
        {pending && <p role="status">正在处理共享…</p>}
        {error && <p role="alert">{error}</p>}
        {!links && !pending && <Button variant="secondary" className="justify-self-start" onClick={() => void load()}>重新载入共享记录</Button>}
        {visibleUrl && <div className="grid gap-2">
          <label className="grid gap-1">共享链接<Input readOnly value={visibleUrl} onFocus={event => event.target.select()} /></label>
          <Button variant="secondary" className="justify-self-start" onClick={() => void copy()}>复制链接</Button>
        </div>}
        {notice && <p role="status">{notice}</p>}
        {links && <section aria-label="共享记录" className="grid gap-2 border-t border-[var(--cd-color-border)] pt-3">
          <h3 className="font-semibold">共享记录</h3>
          {!links.length && <p>暂无共享链接。</p>}
          <ul className="grid gap-2">
            {links.map(receipt => {
              const expired = receipt.expiresAt && Date.parse(receipt.expiresAt) <= Date.now();
              const inactive = receipt.revokedAt || expired;
              return <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{dateFormat.format(new Date(receipt.createdAt))} · 版本 {receipt.version} · {receipt.pageIds.length} 页
                  {inactive && (receipt.revokedAt ? " · 已撤销" : " · 已过期")}
                </span>
                {!inactive && <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" disabled={pending} onClick={() => { setNotice(""); reveal(receipt.id); }}>显示链接</Button>
                  {confirmRevoke === receipt.id
                    ? <>
                      <Button variant="danger" disabled={pending} onClick={() => void revoke(receipt)}>确认撤销</Button>
                      <Button variant="secondary" disabled={pending} onClick={() => setConfirmRevoke(undefined)}>取消</Button>
                    </>
                    : <Button variant="ghost" disabled={pending} onClick={() => setConfirmRevoke(receipt.id)}>撤销</Button>}
                </div>}
              </li>;
            })}
          </ul>
        </section>}
      </div>
    </Dialog>
  </>;
}

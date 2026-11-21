'use client';
import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import styles from './HomeQuery.module.css';
export function HomeQueryKnowledge({ result, requestId, scope, visible }: {
    result: QueryResultView;
    requestId: string;
    scope: QueryClientScope;
    visible: boolean;
}) {
    const [message, setMessage] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const active = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => active.current?.abort(), []);
    const docs = result.sources.filter((s, i, a) => s.original && a.findIndex(x => x.original?.documentId === s.original?.documentId) === i);
    const open = async (sourceId: string) => {
        if (active.current)
            return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        setMessage('正在复核身份、原件权限和版本…');
        try {
            const file = await trustedQueryClient.originalDocument(scope, { requestId, resultId: result.resultId, sourceId, action: 'original' }, controller.signal);
            if (controller.signal.aborted)
                return;
            const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = file.filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
            window.setTimeout(() => URL.revokeObjectURL(url), 30000);
            setMessage('原件已交给浏览器下载，请按结果中的页码／位置核对；尚未确认本机保存完成。');
        }
        catch (e) {
            if (!controller.signal.aborted)
                setMessage(e instanceof Error ? e.message : '原件不可用。');
        }
        finally {
            if (!controller.signal.aborted)
                setBusy(false);
            active.current = null;
        }
    };
    return <div hidden={!visible} className={styles.actions}>
  {docs.map((s, i) => <Button key={s.id} variant="ghost" disabled={busy} onClick={() => void open(s.id)}>下载资料 {i + 1} 原件{s.original?.page ? `（第 ${s.original.page} 页）` : ''}</Button>)}
  {result.sources.filter(s => s.table === 'external_public_web').map(s => { let u: URL; try {
        u = new URL(s.recordId);
    }
    catch {
        return null;
    } return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? <a key={s.id} href={u.href} target="_blank" rel="noopener noreferrer">公开来源：{u.hostname}</a> : null; })}
  {message && <p role="status">{message}</p>}
 </div>;
}

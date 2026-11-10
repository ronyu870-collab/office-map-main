import * as React from 'react';
import type { FeedbackComment } from '@/src/services/feedbackApi';
import { openFeedbackThread } from '@/src/services/feedbackThread';

export type FeedbackThreadSelection = { issueId: string };
type ThreadState = { comments: FeedbackComment[]; loading: boolean; error: string };
const EMPTY: ThreadState = { comments: [], loading: false, error: '' };

export function useFeedbackThread() {
  const [state, setState] = React.useState<ThreadState>(EMPTY);
  const selectionRef = React.useRef<FeedbackThreadSelection | null>(null);
  const requestRef = React.useRef<AbortController | null>(null);

  const cancel = React.useCallback(() => {
    selectionRef.current = null;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  React.useEffect(() => cancel, [cancel]);

  const clear = React.useCallback(() => { cancel(); setState(EMPTY); }, [cancel]);
  const select = (issueId: string): FeedbackThreadSelection => {
    clear();
    const selection = { issueId };
    selectionRef.current = selection;
    return selection;
  };
  const current = () => selectionRef.current;
  const isCurrent = (selection: FeedbackThreadSelection) => selectionRef.current === selection;

  const load = async (selection: FeedbackThreadSelection, confirm: (readAt: string | null) => void) => {
    if (!isCurrent(selection)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const result = await openFeedbackThread(selection.issueId, controller.signal);
      if (controller.signal.aborted || !isCurrent(selection)) return;
      setState({ comments: result.comments, loading: false, error: '' });
      confirm(result.readAt);
    } catch (error) {
      if (controller.signal.aborted || !isCurrent(selection)) return;
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : '沟通记录暂时无法加载。' }));
    }
  };

  return { ...state, clear, select, current, isCurrent, load };
}

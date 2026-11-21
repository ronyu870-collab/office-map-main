import { logAction } from './audit';
import { createReadingContext, type ReadingContext, type ReadingEntry } from './readingAuditContext';
export function observeBusinessReading(action: string, module: string, details: Record<string,unknown>, context?: ReadingContext | ReadingEntry): void {
  try {
  const scope = typeof context === 'string' || !context ? createReadingContext(context) : context;
  logAction(undefined, action, { module, ...scope, ...details });
  } catch { /* Ordinary observation must never interrupt a business view. */ }
}

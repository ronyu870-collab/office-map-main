import { safeCode } from './common.mjs';

const stages = new Set(['source-inventory', 'database-export', 'source-download', 'source-size',
  'local-file', 'encrypt', 'r2-budget', 'r2-upload', 'r2-readback', 'local-cleanup', 'source-consistency',
  'manifest', 'manifest-upload', 'manifest-readback', 'completion-upload']);
const transport = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'ERR_STREAM_PREMATURE_CLOSE', 'TimeoutError', 'AbortError']);
const io = new Set(['EACCES', 'EPERM', 'EEXIST', 'ENOENT', 'ENOSPC', 'EROFS', 'EMFILE']);

export function stageFailure(error, stage) {
  // Preserve the cause for classification and existing caller assertions. The
  // CLI never serializes this message, stack, request, response or SQL.
  return Object.assign(new Error(error?.message || 'BACKUP_FAILED', { cause: error }), {
    backupStage: stages.has(stage) ? stage : 'preflight',
  });
}

export function safeFailure(error) {
  const result = { status: 'failed', stage: stages.has(error?.backupStage) ? error.backupStage : 'preflight', code: safeCode(error) };
  const seen = new Set(); const pending = [error];
  while (pending.length && seen.size < 16) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const status = Number(current.$metadata?.httpStatusCode ?? current.status ?? current.statusCode);
    if (!result.httpStatus && Number.isInteger(status) && status >= 400 && status <= 599) result.httpStatus = status;
    if (!result.transportCode) {
      if (transport.has(current.code)) result.transportCode = current.code;
      else if (transport.has(current.name)) result.transportCode = current.name;
    }
    if (!result.ioCode && io.has(current.code)) result.ioCode = current.code;
    pending.push(current.cause, current.originalError);
  }
  return result;
}

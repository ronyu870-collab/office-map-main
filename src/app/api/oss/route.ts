import { NextResponse } from 'next/server';
import OSS from 'ali-oss';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type VerifiedUser = {
  user: { id: string; email?: string };
  role: string;
};

type DeleteStats = { total: number; success: number; failed: number };
type MoveStats = { total: number; copied: number; deleted: number; failed: number };
type OSSListObject = { name: string; size: number; lastModified?: string | Date };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getOSSClient() {
  const accessKeyId = process.env.NEW_OSS_AK?.trim();
  const accessKeySecret = process.env.NEW_OSS_SK?.trim();
  if (!accessKeyId || !accessKeySecret) throw new Error('OSS 服务配置不完整');

  return new OSS({
    region: process.env.NEW_OSS_REGION || 'oss-cn-hongkong',
    accessKeyId,
    accessKeySecret,
    bucket: process.env.NEW_OSS_BUCKET || 'colliers-reports-data',
    timeout: 7000,
    secure: true,
  });
}

type OSSClient = ReturnType<typeof getOSSClient>;

async function verifyUser(request: Request): Promise<VerifiedUser | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !serviceRoleKey) return null;

    const authorization = request.headers.get('authorization') ?? '';
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) return null;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !user) return null;

    const { data: roleRow, error: roleError } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (roleError) return null;

    return {
      user: { id: user.id, email: user.email },
      role: roleRow?.role ? String(roleRow.role).trim().toLowerCase() : 'viewer',
    };
  } catch {
    return null;
  }
}

function canManage(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}

async function requireUser(request: Request) {
  const verified = await verifyUser(request);
  if (!verified) {
    return { verified: null, response: NextResponse.json({ status: 'error', message: '未授权：请先登录' }, { status: 401 }) };
  }
  return { verified, response: null };
}

async function requireManager(request: Request) {
  const auth = await requireUser(request);
  if (!auth.verified) return auth;
  if (!canManage(auth.verified.role)) {
    return { verified: null, response: NextResponse.json({ status: 'error', message: '权限不足：只有管理员可以执行此操作' }, { status: 403 }) };
  }
  return auth;
}

async function listAllObjects(client: OSSClient, prefix: string): Promise<string[]> {
  const allObjects: string[] = [];
  let marker: string | undefined;

  do {
    const result = await client.list({ prefix, marker, 'max-keys': 1000 }, {});
    const objects = (result.objects ?? []) as OSSListObject[];
    allObjects.push(...objects.map((object) => object.name).filter((name: string) => name !== prefix));
    marker = result.nextMarker;
  } while (marker);

  return allObjects;
}

async function batchDeleteObjects(client: OSSClient, keys: string[]) {
  const batchSize = 100;
  let success = 0;
  let failed = 0;

  for (let index = 0; index < keys.length; index += batchSize) {
    const batch = keys.slice(index, index + batchSize);
    try {
      await client.deleteMulti(batch, { quiet: true });
      success += batch.length;
    } catch {
      failed += batch.length;
    }
  }

  return { success, failed };
}

async function deleteFolderRecursive(client: OSSClient, folderKey: string): Promise<{ success: boolean; message: string; stats: DeleteStats }> {
  if (!folderKey.endsWith('/')) {
    return { success: false, message: '文件夹路径必须以 / 结尾', stats: { total: 0, success: 0, failed: 0 } };
  }

  const objects = await listAllObjects(client, folderKey);
  const deleted = await batchDeleteObjects(client, objects);
  try {
    await client.delete(folderKey);
  } catch {
    // OSS 的目录对象可能不存在；子对象删除结果才是业务关键结果。
  }

  const stats = { total: objects.length, success: deleted.success, failed: deleted.failed };
  return deleted.failed
    ? { success: false, message: `部分对象删除失败：${deleted.failed} 个`, stats }
    : { success: true, message: objects.length ? `已删除文件夹及 ${objects.length} 个子对象` : '空文件夹已删除', stats };
}

async function renameFolderRecursive(client: OSSClient, oldPrefix: string, newPrefix: string): Promise<{ success: boolean; message: string; stats: MoveStats }> {
  if (!oldPrefix.endsWith('/') || !newPrefix.endsWith('/')) {
    return { success: false, message: '文件夹路径必须以 / 结尾', stats: { total: 0, copied: 0, deleted: 0, failed: 0 } };
  }

  const objects = await listAllObjects(client, oldPrefix);
  const sourceKeys = [oldPrefix, ...objects];
  let copied = 0;
  let deleted = 0;
  let failed = 0;
  const copiedPairs: Array<{ oldKey: string; newKey: string }> = [];

  for (const oldKey of sourceKeys) {
    const suffix = oldKey.slice(oldPrefix.length);
    const newKey = `${newPrefix}${suffix}`;
    try {
      if (oldKey === oldPrefix) await client.put(newKey, Buffer.from(''));
      else await client.copy(newKey, oldKey);
      copied += 1;
      copiedPairs.push({ oldKey, newKey });
    } catch {
      failed += 1;
    }
  }

  if (failed > 0) {
    // 复制阶段不完整时不删除源对象，避免把“重命名”变成数据丢失。
    return {
      success: false,
      message: `重命名未完成：${failed} 个对象复制失败，原目录已保留`,
      stats: { total: sourceKeys.length, copied, deleted, failed },
    };
  }

  for (const pair of copiedPairs.reverse()) {
    try {
      await client.delete(pair.oldKey);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return failed
    ? { success: false, message: `新目录已创建，但 ${failed} 个旧对象未能删除`, stats: { total: sourceKeys.length, copied, deleted, failed } }
    : { success: true, message: `已重命名文件夹及 ${objects.length} 个子对象`, stats: { total: sourceKeys.length, copied, deleted, failed } };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'get-signature') {
      const auth = await requireManager(request);
      if (auth.response) return auth.response;

      const client = getOSSClient();
      const accessKeyId = process.env.NEW_OSS_AK?.trim();
      const accessKeySecret = process.env.NEW_OSS_SK?.trim();
      if (!accessKeyId || !accessKeySecret) throw new Error('OSS 服务配置不完整');

      const expiration = new Date(Date.now() + 60 * 60 * 1000);
      const policy = {
        expiration: expiration.toISOString(),
        conditions: [
          ['content-length-range', 0, 104857600],
          ['starts-with', '$key', ''],
        ],
      };
      const encodedPolicy = Buffer.from(JSON.stringify(policy)).toString('base64');
      const signature = crypto.createHmac('sha1', accessKeySecret).update(encodedPolicy).digest('base64');

      return NextResponse.json({
        status: 'success',
        accessid: accessKeyId,
        host: `https://${client.options.bucket}.${client.options.region}.aliyuncs.com`,
        policy: encodedPolicy,
        signature,
        expire: Math.floor(expiration.getTime() / 1000),
      });
    }

    if (action === 'get-list') {
      // 列表本身包含一小时有效的签名下载 URL，因此读取也必须验证登录态。
      const auth = await requireUser(request);
      if (auth.response) return auth.response;

      const client = getOSSClient();
      const prefix = searchParams.get('prefix') || '';
      const result = await client.list({ prefix, delimiter: '/', 'max-keys': 1000 }, {});

      const folders = (result.prefixes ?? []).map((folder: string) => ({
        name: folder,
        shortName: folder.replace(prefix, '').replace(/\/$/, ''),
        type: 'folder' as const,
      }));
      const objects = (result.objects ?? []) as OSSListObject[];
      const files = objects
        .filter((object: OSSListObject) => object.name !== prefix && !object.name.endsWith('/') && !object.name.endsWith('.keep'))
        .map((object: OSSListObject) => ({
          name: object.name,
          shortName: object.name.replace(prefix, ''),
          size: `${(object.size / 1024 / 1024).toFixed(2)} MB`,
          sizeBytes: object.size,
          lastModified: object.lastModified,
          type: 'file' as const,
          url: client.signatureUrl(object.name, { expires: 3600 }),
        }));

      return NextResponse.json({
        status: 'success',
        currentPath: prefix,
        truncated: Boolean(result.isTruncated),
        data: [...folders, ...files],
      });
    }

    return NextResponse.json({ status: 'error', message: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const auth = await requireManager(request);
  if (auth.response) return auth.response;

  try {
    const client = getOSSClient();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    if (action === 'create-folder') {
      const rawFolder = typeof body.folder === 'string' ? body.folder.trim() : '';
      if (!rawFolder) return NextResponse.json({ status: 'error', message: '缺少文件夹名称' }, { status: 400 });
      const folder = rawFolder.endsWith('/') ? rawFolder : `${rawFolder}/`;
      await client.put(folder, Buffer.from(''));
      return NextResponse.json({ status: 'success' });
    }

    if (action === 'delete') {
      const fileKey = searchParams.get('file');
      if (!fileKey) return NextResponse.json({ status: 'error', message: 'Missing file key' }, { status: 400 });
      if (fileKey.endsWith('/')) {
        const result = await deleteFolderRecursive(client, fileKey);
        return NextResponse.json({ status: result.success ? 'success' : 'error', message: result.message, stats: result.stats }, { status: result.success ? 200 : 500 });
      }
      await client.delete(fileKey);
      return NextResponse.json({ status: 'success', message: '文件已删除' });
    }

    if (action === 'move') {
      const oldKey = typeof body.oldKey === 'string' ? body.oldKey.trim() : '';
      const newKey = typeof body.newKey === 'string' ? body.newKey.trim() : '';
      if (!oldKey || !newKey) return NextResponse.json({ status: 'error', message: 'Keys missing' }, { status: 400 });

      const oldIsFolder = oldKey.endsWith('/');
      const newIsFolder = newKey.endsWith('/');
      if (oldIsFolder !== newIsFolder) {
        return NextResponse.json({ status: 'error', message: '文件和文件夹类型不匹配（文件夹路径必须以 / 结尾）' }, { status: 400 });
      }

      if (oldIsFolder) {
        const result = await renameFolderRecursive(client, oldKey, newKey);
        return NextResponse.json({ status: result.success ? 'success' : 'error', message: result.message, stats: result.stats }, { status: result.success ? 200 : 500 });
      }

      await client.copy(newKey, oldKey);
      await client.delete(oldKey);
      return NextResponse.json({ status: 'success', message: '文件已重命名' });
    }

    return NextResponse.json({ status: 'error', message: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: errorMessage(error) }, { status: 500 });
  }
}

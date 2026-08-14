import { NextResponse } from 'next/server';
import OSS from 'ali-oss';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// 强制动态执行，确保每次获取的签名都是最新的
export const dynamic = 'force-dynamic';

// ===== 启动时环境变量健康检查 =====
console.log('[ENV Health Check] OSS 变量状态:', {
  has_AK: !!process.env.NEW_OSS_AK,
  has_SK: !!process.env.NEW_OSS_SK,
  AK_length: process.env.NEW_OSS_AK?.length ?? 0,
  SK_length: process.env.NEW_OSS_SK?.length ?? 0,
  region: process.env.NEW_OSS_REGION ?? '(未设置，将使用默认值)',
  bucket: process.env.NEW_OSS_BUCKET ?? '(未设置，将使用默认值)',
  // 检查是否有前导/尾随空格（常见的 .env 格式问题）
  AK_trimmed_match: process.env.NEW_OSS_AK === process.env.NEW_OSS_AK?.trim(),
  SK_trimmed_match: process.env.NEW_OSS_SK === process.env.NEW_OSS_SK?.trim(),
  NODE_ENV: process.env.NODE_ENV,
});
// ===================================

// 提取共用的 OSS 客户端初始化逻辑
function getOSSClient() {
  console.log('🔑 Environment Check:', {
    hasAK: !!process.env.NEW_OSS_AK,
    hasSK: !!process.env.NEW_OSS_SK,
    akLength: process.env.NEW_OSS_AK?.length || 0,
    skLength: process.env.NEW_OSS_SK?.length || 0,
    region: process.env.NEW_OSS_REGION,
    bucket: process.env.NEW_OSS_BUCKET
  });
  
  // 更详细的错误提示
  const missingVars: string[] = [];
  if (!process.env.NEW_OSS_AK) missingVars.push('NEW_OSS_AK');
  if (!process.env.NEW_OSS_SK) missingVars.push('NEW_OSS_SK');
  
  if (missingVars.length > 0) {
    const errorMsg = `❌ 环境变量丢失: ${missingVars.join(', ')}。请检查 .env.local 文件并重启开发服务器 (npm run dev)`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  return new OSS({
    region: process.env.NEW_OSS_REGION || 'oss-cn-hongkong',
    accessKeyId: process.env.NEW_OSS_AK,
    accessKeySecret: process.env.NEW_OSS_SK,
    bucket: process.env.NEW_OSS_BUCKET || 'colliers-reports-data',
    timeout: 7000,
    secure: true 
  });
}

/**
 * 权限校验：验证用户是否具有管理员权限
 * @returns { user, role } 如果验证通过；否则返回 null
 */
async function verifyAdminPermission(request: Request): Promise<{ user: any; role: string } | null> {
  try {
    // 1. 检查环境变量
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[OSS Auth] 缺少 Supabase 环境变量');
      return null;
    }

    // 2. 初始化 Admin 客户端
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3. 从请求头获取 access_token
    const authHeader = request.headers.get('authorization') ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!accessToken) {
      console.warn('[OSS Auth] 未提供认证 Token');
      return null;
    }

    // 4. 验证 token 并获取用户信息
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      console.warn('[OSS Auth] Token 验证失败:', authError?.message);
      return null;
    }

    // 5. 查询用户角色
    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (roleError) {
      console.error('[OSS Auth] 查询角色失败:', roleError.message);
      return null;
    }

    const role = roleRow?.role ? String(roleRow.role).trim().toLowerCase() : 'viewer';
    
    console.log('[OSS Auth] 用户验证成功:', { userId: user.id, email: user.email, role });
    
    return { user, role };
  } catch (err: any) {
    console.error('[OSS Auth] 权限验证异常:', err);
    return null;
  }
}

/**
 * 递归列出文件夹下的所有对象（包括子文件夹）
 * @param client OSS 客户端
 * @param prefix 文件夹前缀
 * @returns 所有对象的 key 数组
 */
async function listAllObjects(client: ReturnType<typeof getOSSClient>, prefix: string): Promise<string[]> {
  const allObjects: string[] = [];
  let marker: string | undefined = undefined;
  
  console.log(`[OSS Recursive List] 开始列出: ${prefix}`);
  
  do {
    const result = await client.list({
      prefix: prefix,
      marker: marker,
      'max-keys': 1000
    }, {}) as {
      objects?: Array<{ name: string }>;
      nextMarker?: string;
    };
    
    if (result.objects) {
      const keys = result.objects
        .map((obj) => obj.name)
        .filter((key: string) => key !== prefix); // 排除文件夹本身
      
      allObjects.push(...keys);
      console.log(`[OSS Recursive List] 找到 ${keys.length} 个对象`);
    }
    
    marker = result.nextMarker;
  } while (marker);
  
  console.log(`[OSS Recursive List] 总共找到 ${allObjects.length} 个对象`);
  return allObjects;
}

/**
 * 批量删除对象（分批处理，避免超时）
 * @param client OSS 客户端
 * @param keys 要删除的对象 key 数组
 * @returns 删除结果统计
 */
async function batchDeleteObjects(
  client: ReturnType<typeof getOSSClient>,
  keys: string[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const BATCH_SIZE = 100; // 每批删除 100 个对象
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  
  console.log(`[OSS Batch Delete] 开始批量删除 ${keys.length} 个对象`);
  
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    
    try {
      // 使用 OSS 的批量删除 API
      const result = await client.deleteMulti(batch, { quiet: true });
      
      if (result.res.status === 200) {
        successCount += batch.length;
        console.log(`[OSS Batch Delete] 批次 ${Math.floor(i / BATCH_SIZE) + 1} 成功删除 ${batch.length} 个对象`);
      } else {
        failedCount += batch.length;
        errors.push(`批次 ${Math.floor(i / BATCH_SIZE) + 1} 失败: ${result.res.statusMessage}`);
      }
    } catch (err: any) {
      failedCount += batch.length;
      errors.push(`批次 ${Math.floor(i / BATCH_SIZE) + 1} 异常: ${err.message}`);
      console.error(`[OSS Batch Delete] 批次删除失败:`, err);
    }
  }
  
  console.log(`[OSS Batch Delete] 完成: 成功 ${successCount}, 失败 ${failedCount}`);
  return { success: successCount, failed: failedCount, errors };
}

/**
 * 递归删除文件夹（包括所有子文件和子文件夹）
 * @param client OSS 客户端
 * @param folderKey 文件夹 key（必须以 / 结尾）
 * @returns 删除结果
 */
async function deleteFolderRecursive(
  client: ReturnType<typeof getOSSClient>,
  folderKey: string
): Promise<{ success: boolean; message: string; stats?: { total: number; success: number; failed: number } }> {
  try {
    if (!folderKey.endsWith('/')) {
      return { success: false, message: '文件夹 key 必须以 / 结尾' };
    }
    
    console.log(`[OSS Delete Folder] 开始递归删除文件夹: ${folderKey}`);
    
    // 1. 列出文件夹下的所有对象
    const allObjects = await listAllObjects(client, folderKey);
    
    if (allObjects.length === 0) {
      console.log(`[OSS Delete Folder] 文件夹为空，直接删除文件夹对象`);
      await client.delete(folderKey);
      return { 
        success: true, 
        message: '空文件夹删除成功',
        stats: { total: 0, success: 0, failed: 0 }
      };
    }
    
    // 2. 批量删除所有对象
    const deleteResult = await batchDeleteObjects(client, allObjects);
    
    // 3. 删除文件夹本身
    try {
      await client.delete(folderKey);
      console.log(`[OSS Delete Folder] 文件夹对象删除成功`);
    } catch (err: any) {
      console.warn(`[OSS Delete Folder] 文件夹对象删除失败（可能不存在）:`, err.message);
    }
    
    const stats = {
      total: allObjects.length,
      success: deleteResult.success,
      failed: deleteResult.failed
    };
    
    if (deleteResult.failed > 0) {
      return {
        success: false,
        message: `部分删除失败: ${deleteResult.errors.join('; ')}`,
        stats
      };
    }
    
    return {
      success: true,
      message: `成功删除文件夹及其 ${stats.total} 个子对象`,
      stats
    };
  } catch (err: any) {
    console.error(`[OSS Delete Folder] 递归删除失败:`, err);
    return {
      success: false,
      message: `删除失败: ${err.message}`
    };
  }
}

/**
 * 递归重命名/移动文件夹（复制所有子对象到新位置，然后删除旧对象）
 * @param client OSS 客户端
 * @param oldPrefix 旧文件夹前缀
 * @param newPrefix 新文件夹前缀
 * @returns 重命名结果
 */
async function renameFolderRecursive(
  client: ReturnType<typeof getOSSClient>,
  oldPrefix: string,
  newPrefix: string
): Promise<{ success: boolean; message: string; stats?: { total: number; copied: number; deleted: number; failed: number } }> {
  try {
    console.log(`[OSS Rename Folder] 开始递归重命名: ${oldPrefix} -> ${newPrefix}`);
    
    // 1. 列出旧文件夹下的所有对象
    const allObjects = await listAllObjects(client, oldPrefix);
    
    if (allObjects.length === 0) {
      console.log(`[OSS Rename Folder] 文件夹为空，只需创建新文件夹`);
      await client.put(newPrefix, Buffer.from(''));
      await client.delete(oldPrefix);
      return {
        success: true,
        message: '空文件夹重命名成功',
        stats: { total: 0, copied: 0, deleted: 0, failed: 0 }
      };
    }
    
    // 2. 逐个复制对象到新位置
    let copiedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    
    for (const oldKey of allObjects) {
      try {
        // 计算新的 key
        const newKey = oldKey.replace(oldPrefix, newPrefix);
        
        // 复制对象
        await client.copy(newKey, oldKey);
        copiedCount++;
        
        if (copiedCount % 10 === 0) {
          console.log(`[OSS Rename Folder] 已复制 ${copiedCount}/${allObjects.length} 个对象`);
        }
      } catch (err: any) {
        failedCount++;
        errors.push(`复制 ${oldKey} 失败: ${err.message}`);
        console.error(`[OSS Rename Folder] 复制失败:`, err);
      }
    }
    
    console.log(`[OSS Rename Folder] 复制完成: 成功 ${copiedCount}, 失败 ${failedCount}`);
    
    // 3. 如果复制成功，删除旧对象
    let deletedCount = 0;
    if (copiedCount > 0) {
      const deleteResult = await batchDeleteObjects(client, allObjects);
      deletedCount = deleteResult.success;
      
      // 删除旧文件夹对象
      try {
        await client.delete(oldPrefix);
        console.log(`[OSS Rename Folder] 旧文件夹对象删除成功`);
      } catch (err: any) {
        console.warn(`[OSS Rename Folder] 旧文件夹对象删除失败:`, err.message);
      }
    }
    
    // 4. 创建新文件夹对象
    try {
      await client.put(newPrefix, Buffer.from(''));
      console.log(`[OSS Rename Folder] 新文件夹对象创建成功`);
    } catch (err: any) {
      console.warn(`[OSS Rename Folder] 新文件夹对象创建失败:`, err.message);
    }
    
    const stats = {
      total: allObjects.length,
      copied: copiedCount,
      deleted: deletedCount,
      failed: failedCount
    };
    
    if (failedCount > 0) {
      return {
        success: false,
        message: `部分重命名失败: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '...' : ''}`,
        stats
      };
    }
    
    return {
      success: true,
      message: `成功重命名文件夹及其 ${stats.total} 个子对象`,
      stats
    };
  } catch (err: any) {
    console.error(`[OSS Rename Folder] 递归重命名失败:`, err);
    return {
      success: false,
      message: `重命名失败: ${err.message}`
    };
  }
}

// 处理 GET 请求 (获取签名、拉取列表)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const client = getOSSClient();

    // 1. 获取直传签名 - 需要管理员权限
    if (action === 'get-signature') {
      // ===== 🔒 权限校验：上传文件需要管理员权限 =====
      const authResult = await verifyAdminPermission(request);
      
      if (!authResult) {
        console.warn('[OSS GET] 未授权的签名请求');
        return NextResponse.json({ 
          status: 'error',
          message: '未授权：请先登录' 
        }, { status: 401 });
      }

      const { role } = authResult;
      
      if (role !== 'admin' && role !== 'super_admin') {
        console.warn('[OSS GET] 权限不足，无法获取上传签名:', { role });
        return NextResponse.json({ 
          status: 'error',
          message: '权限不足：只有管理员可以上传文件' 
        }, { status: 403 });
      }
      // =============================================

      const date = new Date();
      date.setHours(date.getHours() + 1); 
      const policy = {
        expiration: date.toISOString(),
        conditions: [
          ["content-length-range", 0, 104857600], // 限制最大 100MB
          ["starts-with", "$key", ""] 
        ]
      };

      const base64Policy = Buffer.from(JSON.stringify(policy)).toString('base64');
      const signature = crypto.createHmac('sha1', process.env.NEW_OSS_SK!).update(base64Policy).digest('base64');

      return NextResponse.json({
        status: 'success',
        accessid: process.env.NEW_OSS_AK,
        host: `https://${client.options.bucket}.${client.options.region}.aliyuncs.com`,
        policy: base64Policy,
        signature: signature,
        expire: Math.floor(date.getTime() / 1000)
      });
    }

    // 2. 获取目录列表 - 所有登录用户都可以查看
    if (action === 'get-list') {
      const prefix = searchParams.get('prefix') || ''; 
      
      console.log('🔍 OSS List Request:', { 
        prefix, 
        bucket: client.options.bucket, 
        region: client.options.region,
        hasAK: !!process.env.NEW_OSS_AK,
        hasSK: !!process.env.NEW_OSS_SK
      });
      
      const result = await client.list({
        prefix: prefix,
        delimiter: '/',
        'max-keys': 1000
      }, {});

      console.log('📦 OSS Raw Result:', { 
        prefixes: result.prefixes?.length || 0, 
        objects: result.objects?.length || 0,
        isTruncated: result.isTruncated,
        rawPrefixes: result.prefixes,
        rawObjects: result.objects?.map((o: any) => ({ name: o.name, size: o.size }))
      });

      const folders = (result.prefixes || []).map((p: string) => ({
        name: p,
        type: 'folder'
      }));

      // 彻底过滤掉 OSS 自动生成的纯目录对象和隐藏文件
      const files = (result.objects || [])
        .filter((o: any) => {
          const keep = o.name !== prefix && !o.name.endsWith('/') && !o.name.endsWith('.keep');
          if (!keep) {
            console.log('🚫 Filtered out:', o.name);
          }
          return keep;
        }) 
        .map((o: any) => {
          const url = client.signatureUrl(o.name, { expires: 3600 });
          return {
            name: o.name,
            shortName: o.name.replace(prefix, ''), 
            size: (o.size / 1024 / 1024).toFixed(2) + ' MB',
            lastModified: o.lastModified,
            type: 'file',
            url: url
          };
        });

      console.log('✅ OSS Processed:', { folders: folders.length, files: files.length });

      return NextResponse.json({ 
        status: 'success', 
        currentPath: prefix,
        data: [...folders, ...files] 
      });
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });

  } catch (e: any) {
    console.error('❌ OSS GET Error:', e);
    return NextResponse.json({ 
      status: 'error', 
      message: e.message, 
      details: e.toString(),
      code: e.code 
    }, { status: 500 });
  }
}

// 处理 POST 请求 (新建文件夹、重命名、删除)
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // ===== 🔒 权限校验：所有写操作必须是管理员 =====
  const authResult = await verifyAdminPermission(request);
  
  if (!authResult) {
    console.warn('[OSS POST] 未授权的访问尝试');
    return NextResponse.json({ 
      status: 'error',
      message: '未授权：请先登录' 
    }, { status: 401 });
  }

  const { role } = authResult;
  
  // 只有 admin 和 super_admin 可以执行写操作
  if (role !== 'admin' && role !== 'super_admin') {
    console.warn('[OSS POST] 权限不足:', { role, action });
    return NextResponse.json({ 
      status: 'error',
      message: '权限不足：只有管理员可以执行此操作' 
    }, { status: 403 });
  }
  // =============================================

  try {
    const client = getOSSClient();
    const body = await request.json().catch(() => ({}));

    // 3. 新建文件夹
    if (action === 'create-folder') {
      let { folder } = body;
      if (!folder) return NextResponse.json({ message: "缺少文件夹名称" }, { status: 400 });
      if (!folder.endsWith('/')) folder += '/';
      
      // 直接向 OSS 写入一个空 Buffer 代表文件夹
      await client.put(folder, Buffer.from(''));
      return NextResponse.json({ status: 'success' });
    }

    // 4. 删除文件或文件夹（支持递归删除）
    if (action === 'delete') {
      const fileKey = searchParams.get('file');
      if (!fileKey) return NextResponse.json({ message: "Missing file key" }, { status: 400 });
      
      // 判断是文件还是文件夹
      if (fileKey.endsWith('/')) {
        // 文件夹：递归删除
        console.log(`[OSS Delete] 检测到文件夹删除请求: ${fileKey}`);
        const result = await deleteFolderRecursive(client, fileKey);
        
        if (result.success) {
          return NextResponse.json({ 
            status: 'success', 
            message: result.message,
            stats: result.stats
          });
        } else {
          return NextResponse.json({ 
            status: 'error', 
            message: result.message,
            stats: result.stats
          }, { status: 500 });
        }
      } else {
        // 文件：直接删除
        console.log(`[OSS Delete] 删除单个文件: ${fileKey}`);
        await client.delete(fileKey);
        return NextResponse.json({ status: 'success' });
      }
    }

    // 5. 移动/重命名（支持文件夹递归重命名）
    if (action === 'move') {
      const { oldKey, newKey } = body;
      if (!oldKey || !newKey) return NextResponse.json({ message: "Keys missing" }, { status: 400 });

      // 判断是文件还是文件夹
      if (oldKey.endsWith('/') && newKey.endsWith('/')) {
        // 文件夹：递归重命名
        console.log(`[OSS Move] 检测到文件夹重命名请求: ${oldKey} -> ${newKey}`);
        const result = await renameFolderRecursive(client, oldKey, newKey);
        
        if (result.success) {
          return NextResponse.json({ 
            status: 'success', 
            message: result.message,
            stats: result.stats
          });
        } else {
          return NextResponse.json({ 
            status: 'error', 
            message: result.message,
            stats: result.stats
          }, { status: 500 });
        }
      } else if (!oldKey.endsWith('/') && !newKey.endsWith('/')) {
        // 文件：直接复制并删除
        console.log(`[OSS Move] 重命名单个文件: ${oldKey} -> ${newKey}`);
        await client.copy(newKey, oldKey);
        await client.delete(oldKey);
        return NextResponse.json({ status: 'success' });
      } else {
        // 类型不匹配
        return NextResponse.json({ 
          message: "文件和文件夹类型不匹配（文件夹必须以 / 结尾）" 
        }, { status: 400 });
      }
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });

  } catch (e: any) {
    console.error('❌ OSS POST Error:', e);
    return NextResponse.json({ 
      status: 'error', 
      message: e.message, 
      details: e.toString(),
      code: e.code 
    }, { status: 500 });
  }
}

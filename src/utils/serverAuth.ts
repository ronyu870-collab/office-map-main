import { headers } from 'next/headers';

/**
 * 从中间件注入的 Header 中读取用户信息
 * 
 * 使用场景：Server Components 或 Server Actions
 * 优势：无需查询数据库，直接读取中间件验证后的信息
 */
export interface ServerAuthInfo {
  userId: string;
  email: string;
  role: string;
  displayName: string;
  sessionId: string;
  verified: boolean;
}

export async function getServerAuth(): Promise<ServerAuthInfo | null> {
  try {
    const headersList = await headers();
    
    const verified = headersList.get('x-auth-verified');
    if (verified !== 'true') {
      return null;
    }

    const userId = headersList.get('x-user-id');
    const email = headersList.get('x-user-email');
    const role = headersList.get('x-user-role');
    const displayNameBase64 = headersList.get('x-user-display-name');
    const sessionId = headersList.get('x-session-id');

    if (!userId || !email || !role) {
      return null;
    }

    // 解码 displayName
    const displayName = displayNameBase64
      ? Buffer.from(displayNameBase64, 'base64').toString('utf-8')
      : email.split('@')[0];

    return {
      userId,
      email,
      role,
      displayName,
      sessionId: sessionId || '',
      verified: true,
    };
  } catch (err) {
    console.error('getServerAuth 失败:', err);
    return null;
  }
}

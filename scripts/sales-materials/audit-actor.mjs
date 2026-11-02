/** Service credentials identify software, so an applied import also needs its operator. */
export async function resolveImportActor(client, userId) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('正式导入必须提供 --actor-user-id，不能用工具名代替操作账号');
  }
  const { data, error } = await client.from('user_roles').select('user_id,role').eq('user_id',userId).maybeSingle();
  if (error || !data || data.user_id.toLowerCase() !== userId.toLowerCase() || !['admin','super_admin'].includes(data.role)) {
    throw new Error('导入操作账号不存在、无法核验或不是管理员；未执行资料写入');
  }
  return data.user_id;
}

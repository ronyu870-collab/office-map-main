/** Read every page or fail visibly; never silently report a truncated result. */
export async function readPagedRows<T>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await read(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('数据返回格式异常，请重新读取。');
    if (data.length === 0) return rows;
    rows.push(...data);
  }
  throw new Error('数据超过安全读取上限；结果未显示，请联系管理员缩小查询范围。');
}

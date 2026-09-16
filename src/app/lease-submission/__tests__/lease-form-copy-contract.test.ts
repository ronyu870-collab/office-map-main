import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('租赁成交填报文案连续性', () => {
  const form = readFileSync(
    'src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx',
    'utf8',
  );

  it('新增/编辑页头只保留主标题，不再堆叠状态说明', () => {
    expect(form).toContain("mode === 'edit' ? '编辑成交记录' : '新增成交记录'");
    expect(form).not.toContain('>租赁成交填报</div><h2 id="lease-entry-title"');
    expect(form).not.toContain("'校验就绪'");
    expect(form).not.toContain('<span>·</span><span>已修改');
  });

  it('底部不再显示多余的草稿解释文案', () => {
    expect(form).not.toContain('草稿可在未填完整时直接保存');
    expect(form).toContain('保存草稿');
  });

  it('恢复 Data Entry 2.0 之前的业务板块命名', () => {
    expect(form).toContain('title="企业信息与需求类型"');
    expect(form).toContain('title="交易楼宇信息"');
    expect(form).toContain('title="原址信息"');
    expect(form).toContain('title="成交核心数据"');
    expect(form).toContain('title="时间与备注"');

    expect(form).not.toContain('title="企业与需求"');
    expect(form).not.toContain('title="成交楼宇"');
    expect(form).not.toContain('title="搬迁原址"');
    expect(form).not.toContain('title="租赁商务条件"');
    expect(form).not.toContain('title="成交时间与备注"');
  });
});

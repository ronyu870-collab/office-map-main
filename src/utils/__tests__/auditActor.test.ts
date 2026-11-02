import { expect, test } from 'vitest';
import { displayAuditActor } from '../auditActor';

test('tools, systems, snapshots, current directory and unknown identities stay distinct', () => {
  expect(displayAuditActor({user_id: 'codex'})).toBe('Codex（工具执行）');
  expect(displayAuditActor({user_id: 'system'})).toBe('系统任务');
  expect(displayAuditActor({user_id: 'unknown'})).toBe('身份待核验');
  expect(displayAuditActor({user_id: '', user_name: ''})).toBe('身份待核验');
  expect(displayAuditActor({user_id: 'u1', user_name: '当前姓名', actor_kind: 'user', actor_name: '操作时姓名'})).toBe('操作时姓名');
  expect(displayAuditActor({user_id: 'u1', user_name: '目录姓名'})).toBe('目录姓名');
  expect(displayAuditActor({user_id: 'u1', actor_kind: 'unknown', actor_name: '伪称系统'})).toBe('身份待核验');
});

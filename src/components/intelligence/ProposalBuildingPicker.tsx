'use client';

import * as React from 'react';
import { Button, Dialog } from '@/src/components/ui';
import { SearchableSelect } from '@/src/components/ui/SearchableSelect';
import { useBuildings } from '@/src/hooks/useBuildings';
import { buildingChoices, matchesBuildingChoice } from '@/src/lib/broker/buildingChoices';
import { addProposalCandidate, type ProposalDraftScope } from '@/src/lib/intelligence/proposalDraft';

export function ProposalBuildingPicker({ scope, onClose }: { scope: ProposalDraftScope; onClose: () => void }) {
  const { buildings, error, isLoading, mutate } = useBuildings({ revalidateOnMount: true, scope });
  const [id, setId] = React.useState('');
  const [message, setMessage] = React.useState('');
  const options = React.useMemo(() => buildingChoices(buildings ?? []), [buildings]);
  const selected = options.find(item => item.value === id);
  const add = () => {
    if (!selected) return;
    const result = addProposalCandidate(scope, selected.value, selected.label);
    if (result.status === 'added') onClose();
    else setMessage(result.status === 'exists' ? '这个楼座已在方案中。' : result.status === 'full' ? '候选已满，请先移除一个项目。' : '草稿无法保存，请重试。');
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} title="添加候选楼宇"
    description="可按楼宇名或曾用名搜索。添加前请核对楼座及区位。"
    footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={!selected || Boolean(error)} onClick={add}>添加到方案</Button></>}>
    {isLoading ? <p role="status">正在读取楼宇主档…</p> : error ? <p role="alert">楼宇主档读取失败。<Button variant="ghost" onClick={mutate}>重试</Button></p> : <>
      <label htmlFor="proposal-building" className="mb-2 block text-sm">楼宇或曾用名</label>
      <SearchableSelect id="proposal-building" listPlacement="inline" value={id} options={options} matches={matchesBuildingChoice} onChange={value => { setId(value); setMessage(''); }} />
      {selected && <p className="mt-2 break-words text-sm">已选：{selected.label}{selected.detail ? ` · ${selected.detail}` : ''}</p>}
    </>}
    {message && <p className="mt-2 text-sm" role="status">{message}</p>}
  </Dialog>;
}

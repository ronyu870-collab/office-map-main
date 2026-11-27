"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/src/components/ui";
import type { SlideContent } from "@/src/lib/pitch/contracts/content";
import { materialMediaKey, type MaterialEvidence as Evidence } from "./DocumentBindings";
import styles from "./workspace.module.css";

const labelForVisual = { photo: "楼宇照片", map: "区位图", "stacking-plan": "历史堆叠图" };

export function PageSources({ content, manual, evidence, focus, onClear }: {
  content: SlideContent;
  manual: boolean;
  evidence: Evidence | null;
  focus?: string;
  onClear: () => void;
}) {
  const container = useRef<HTMLDetailsElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus || !container.current || !disclosure.current) return;
    container.current.open = true;
    disclosure.current.open = true;
    heading.current?.focus();
  }, [focus]);
  return <details ref={container}>
    <summary>数据与来源</summary>
    {!focus && <>
      <p>数据截至 {content.dataAsOf}</p>
      <p>{manual ? "含用户输入，仅供内部使用" : "内容来自已授权素材或业务数据"}</p>
      <ul>{content.sources.map(source => <li key={source.id}>{source.label} · {source.locator} · {source.dataAsOf}</li>)}</ul>
    </>}
    {evidence && <details ref={disclosure}>
      <summary ref={heading}>素材来源</summary>
      {focus && <Button variant="ghost" onClick={() => { onClear(); heading.current?.focus(); }}>查看本页全部来源</Button>}
      <MaterialEvidence evidence={evidence} focus={focus} />
    </details>}
  </details>;
}

function MaterialEvidence({ evidence, focus }: { evidence: Evidence; focus?: string }) {
  const { documents, media, visuals } = evidence;
  const matchingMedia = focus ? media.filter(image => materialMediaKey(image) === focus) : media;
  const matchingVisuals = focus ? visuals.filter(visual => materialMediaKey(visual) === focus) : visuals;
  const matchingDocuments = focus ? documents.filter(document => matchingMedia.some(image => image.document === document)) : documents;
  const versions = [...matchingVisuals, ...matchingDocuments, ...matchingMedia];
  return <>
    <ul className={styles.handoffPages}>
      {matchingVisuals.map(visual => <li key={visual.sourceId}>
        <strong>{visual.label}</strong>
        <p>{labelForVisual[visual.kind]} · 版本 {visual.version} · {visual.kind === "stacking-plan" ? "限获权管理员" : "仅供内部使用"}</p>
        <p>{visual.kind === "photo" ? "图库登记日" : visual.kind === "stacking-plan" ? "来源标注日期" : "目录观察日"} {visual.sourceDate}
          {visual.dataAsOf && visual.dataAsOf !== visual.sourceDate && ` · 业务日期 ${visual.dataAsOf}`}
          {visual.kind === "map" && ` · ${visual.buildingIds.length} 栋楼宇`}</p>
        <p>{visual.sourceLabel} · {visual.locator}</p>
      </li>)}
      {matchingDocuments.map(document => <li key={document.sourceId}>
        <strong>{document.label}</strong>
        <p>{document.locator} · 原件版本 {document.version}</p>
        <p>{document.dataAsOf ? `业务日期 ${document.dataAsOf}` : "业务日期待确认"}</p>
      </li>)}
      {matchingMedia.map(image => <li key={materialMediaKey(image)}>
        <strong>{image.label}</strong>
        <p>素材图片版本 {image.version} · 原件版本 {image.documentVersion}</p>
        {image.document && <p>{image.document.label} · {image.document.locator}</p>}
        <p>{image.dataAsOf ? `业务日期 ${image.dataAsOf}` : "业务日期待确认"}</p>
      </li>)}
    </ul>
    <details key={focus ?? "all"}>
      <summary>版本校验</summary>
      <ul className={styles.handoffPages}>{versions.map(item => <li key={"sourceId" in item ? item.sourceId : materialMediaKey(item)}>
        <span>{item.label}</span><p className={styles.sourceDigest}>SHA-256 {item.sha256}</p>
      </li>)}</ul>
    </details>
  </>;
}

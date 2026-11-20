'use client';

import { ArrowUpRight, X } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { IconButton } from '@/src/components/ui/IconButton';
import styles from './HomeQueryWorkspace.module.css';

export function HomeQueryHelp({ examples, onSelect, onClose }: { examples: string[]; onSelect: (question: string) => void; onClose: () => void }) {
  return <>
    <header className={styles.helpHeading}><h2 id="query-help-heading">能力与范围</h2><IconButton variant="ghost" label="关闭能力与范围" onClick={onClose}><X size={16} aria-hidden="true" /></IconButton></header>
    <div className={styles.helpContent}>
      <p>我是 Colliers AI，高力国际北京办公楼市场的智能研究助手。在你当前获权的范围内查找楼宇资料，分析净有效租金、空置率和季度变化，并查看数据来源。</p>
      <h3>继续研究</h3>
      <p>直接追问可沿用上文条件；新对话开始独立的问题。历史记录按顺序展示已保存的问答，重新查询会生成新的结果。</p>
      {examples.length > 0 && <section aria-label="更多示例问题"><h3>试着这样提问</h3><div className={styles.helpExamples}>{examples.map(question => <Button key={question} variant="ghost" onClick={() => onSelect(question)}><span>{question}</span><ArrowUpRight size={16} aria-hidden="true" /></Button>)}</div></section>}
      <h3>数据范围</h3>
      <p>楼宇目录按当前授权范围查询；季度指标采用实际跟踪样本。未收录、未授权或尚未开放的能力会明确说明，缺失信息不会按零计算。示例年份不代表该期已有数据。</p>
      <p className={styles.helpHint}>Enter 发送 · Shift+Enter 换行</p>
    </div>
  </>;
}

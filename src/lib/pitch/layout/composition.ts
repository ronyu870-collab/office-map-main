import type { SlideContent } from '../contracts/content';
import type { SceneElement } from '../contracts/scene';
import { DESIGN_PROFILES, textSize } from '../design/theme';
import { contain, cover } from '../render/geometry';
import { cellText } from '../render/format';
import type { sceneComponents } from './components';
import { LayoutError, lineHeight, wrapText } from './metrics';

type Tools = ReturnType<typeof sceneComponents>;
type Block<K extends SlideContent['blocks'][number]['kind']> = Extract<SlideContent['blocks'][number], { kind: K }>;
type Text = Extract<SceneElement, { kind: 'text' }>;
type Image = Extract<SceneElement, { kind: 'image' }>;
type Box = Pick<SceneElement, 'x' | 'y' | 'w' | 'h'>;
type Plan = { composition: string; groups: SceneElement[][]; footer?: Box };
type Candidate = { name: string; box: Box; fit: Image['fit']; text: Box; preferred?: boolean };

function groupsOf<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

function measured(t: Tools, value: string, width: number, role: Text['role'], semantic: Text['semantic']) {
  const size = textSize(t.theme, role, semantic);
  return wrapText(value, width, size, t.font).length * lineHeight(size);
}

function place(t: Tools, value: string, x: number, y: number, w: number, role: Text['role'], semantic: Text['semantic'], bold = false) {
  return t.text(value, x, y, w, measured(t, value, w, role, semantic) + .008, role, bold, undefined, semantic);
}

function paragraphs(content: SlideContent) {
  return content.blocks.flatMap(b => b.kind === 'paragraph' ? [b.text] : []);
}

function caption(image: Block<'image'>) {
  return [image.caption ?? image.alt, image.credit].filter(Boolean).join(' · ');
}

function photo(t: Tools, image: Block<'image'>, box: Box, fit: Image['fit'] = 'cover', reservedCaption?: number) {
  const label = caption(image), captionHeight = reservedCaption ?? measured(t, label, box.w, 'body', 'caption') + .008;
  const h = box.h - captionHeight - .11;
  if (h < .85) throw new LayoutError('PITCH_IMAGE_CAPTION_CAPACITY', '照片说明与署名需要更多空间，请拆分页面。');
  const frame = { ...box, h };
  if ((image.fit ?? fit) === 'contain' && image.aspectRatio) {
    const fitted = contain(frame, image.aspectRatio, 1);
    return [t.image(image, fitted.x, fitted.y, fitted.w, fitted.h, fit),
      place(t, label, fitted.x, fitted.y + fitted.h + .11, box.x + box.w - fitted.x, 'body', 'caption')];
  }
  return [t.image(image, box.x, box.y, box.w, h, fit), place(t, label, box.x, box.y + h + .11, box.w, 'body', 'caption')];
}

function cropLoss(box: Box, image: Block<'image'>, fit: Image['fit']) {
  if (!image.aspectRatio || (image.fit ?? fit) !== 'cover') return 0;
  const relative = box.w / box.h / image.aspectRatio;
  return 1 - Math.min(relative, 1 / relative);
}

function coverPlan(content: SlideContent, t: Tools, images: Block<'image'>[], alternate: boolean): Plan {
  if (images.length > 1) throw new LayoutError('PITCH_IMAGE_COUNT', '封面最多接受一张图片，请拆分页面。');
  const { margin: m, width: page, height } = t.theme, w = page - m * 2;
  const image = images[0], profile = DESIGN_PROFILES[t.theme.profile!];
  const description = [content.subtitle, ...paragraphs(content)].filter(Boolean).join('\n\n');
  const candidates: Candidate[] = [
    { name: 'portrait', box: { x: page * .48, y: 0, w: page * .52, h: 5.88 }, text: { x: m, y: 2.08, w: page * .42 - m, h: 3.47 }, fit: 'cover' },
    { name: 'framed', box: { x: page * .55, y: 1.02, w: page * .45 - m, h: 4.9 }, text: { x: m, y: 1.42, w: page * .48 - m, h: 4.45 }, fit: 'contain' },
    { name: 'landscape', box: { x: m, y: 2.86, w, h: 3.12 }, text: { x: m, y: .63, w, h: 2.12 }, fit: 'cover' },
    { name: 'masthead', box: { x: page * .52, y: 2.0, w: page * .48 - m, h: 3.8 }, text: { x: m, y: 1.15, w: page * .47 - m, h: 4.5 }, fit: 'contain' },
    { name: 'folio', box: { x: m, y: .57, w: page * .57, h: 5.39 }, text: { x: page * .57 + m + .34, y: 1.48, w: page * .43 - 2 * m - .34, h: 4.45 }, fit: 'cover' },
    { name: 'full-bleed', box: { x: 0, y: 0, w: page, h: height }, text: { x: m, y: 3.80, w: 7.35 - m, h: 2.20 }, fit: 'cover' },
  ];
  const ranked = image ? candidates.filter(c => c.name !== 'full-bleed' || image.fit !== 'contain').map(c => {
    const focus = image.focus;
    const crop = c.name === 'full-bleed' && focus && image.aspectRatio ? cover(c.box, image.aspectRatio, 1, focus) : undefined;
    const masked = crop && focus && focus.x * crop.w - crop.x < 7.78 && focus.y * crop.h - crop.y > 3.57;
    return { candidate: c, score: (c.name === profile.cover ? 1.4 : 0) + (alternate && c.name === 'folio' ? 1.6 : 0)
      - 2.25 * cropLoss(c.box, image, c.fit) - (masked ? 1.4 : 0) };
  }).sort((a, b) => b.score - a.score) : [];
  const plainTop = profile.cover === 'masthead' ? 1.14 : profile.cover === 'landscape' ? 2.18 : 1.76;
  const plain: Candidate = { name: 'text-cover', box: { x: 0, y: 0, w: 0, h: 0 }, text: { x: m, y: plainTop, w: w * .81, h: 5.9 - plainTop }, fit: 'contain' };
  if (!image) ranked.push({ candidate: plain, score: 0 });
  for (const { candidate: c } of ranked) {
    const title = place(t, content.title, c.text.x, c.text.y, c.text.w, 'title', 'cover', true);
    const subY = title.y + title.h + .19;
    const detail = description ? place(t, description, c.text.x, subY, c.text.w, 'body', 'body') : undefined;
    if ((detail ? detail.y + detail.h : title.y + title.h) > c.text.y + c.text.h) continue;
    if (c.name === 'full-bleed' && image) {
      const frame: SceneElement = { kind: 'shape', shape: 'rect', fill: 'background', background: true, x: 0, y: 3.57, w: 7.78, h: height - 3.57 };
      const visual = t.image(image, 0, 0, page, height, 'cover');
      const label = place(t, caption(image), m, 6.02, 7.15 - m, 'body', 'caption');
      if (label.y + label.h > 6.48) continue;
      return { composition: c.name, groups: [[{ ...visual, bleed: true }, frame, title, ...(detail ? [detail] : []), label]], footer: { x: m, y: 6.52, w: 7.15 - m, h: .53 } };
    }
    try {
      return { composition: c.name, groups: [[title, ...(detail ? [detail] : []), ...(image ? photo(t, image, c.box, c.fit) : [])]] };
    } catch (error) {
      if (!(error instanceof LayoutError) || error.code !== 'PITCH_IMAGE_CAPTION_CAPACITY') throw error;
    }
  }
  throw new LayoutError('PITCH_TITLE_CAPACITY', '封面标题、说明与图片无法完整排入同一页，请拆分。');
}

function imageTextPlan(content: SlideContent, t: Tools, images: Block<'image'>[], safe: Box, alternate: boolean): Plan {
  if (images.length > 1) throw new LayoutError('PITCH_IMAGE_COUNT', '单图文布局最多接受一张图片。');
  const copy = paragraphs(content).join('\n\n'), image = images[0], profile = DESIGN_PROFILES[t.theme.profile!];
  if (!copy) throw new LayoutError('PITCH_REQUIRED_CONTENT', '图文布局需要至少一段正文。');
  const gap = t.theme.gridGap + .13, imageW = (safe.w - gap) * profile.imageShare, textW = safe.w - gap - imageW;
  const options: Candidate[] = [
    { name: alternate ? 'image-left' : 'image-right',
      box: { ...safe, x: alternate ? safe.x : safe.x + textW + gap, w: imageW },
      text: { ...safe, x: alternate ? safe.x + imageW + gap : safe.x, w: textW }, fit: 'cover', preferred: true },
    { name: 'image-above', box: { ...safe, h: safe.h * .66 },
      text: { ...safe, y: safe.y + safe.h * .66 + .16, h: safe.h * .34 - .16 }, fit: 'cover' },
    { name: 'image-contained', box: { ...safe, w: safe.w * .52 },
      text: { ...safe, x: safe.x + safe.w * .52 + gap, w: safe.w * .48 - gap }, fit: 'contain' },
  ];
  const candidates = image ? options : [{ name: 'text-only', box: safe, text: { ...safe, w: safe.w * .76 }, fit: 'contain' as const }];
  const ranked = candidates.flatMap(candidate => {
    const lines = t.lines(copy, candidate.text.w), per = Math.floor(candidate.text.h / t.lh);
    if (per < 1) return [];
    const pages = Math.ceil(lines.length / per);
    return [{ candidate, lines, per, score: (candidate.preferred ? .8 : 0) - (image ? cropLoss(candidate.box, image, candidate.fit) * 2.5 : 0) - (pages - 1) * 2 }];
  }).sort((a, b) => b.score - a.score);
  for (const { candidate: c, lines, per } of ranked) {
    try {
      const media = image ? photo(t, image, c.box, c.fit) : [];
      return { composition: c.name, groups: groupsOf(lines, per).map(group => [
        t.text(group.join('\n'), c.text.x, c.text.y, c.text.w, group.length * t.lh + .008, 'body', false, undefined, 'body'), ...media,
      ]) };
    } catch (error) {
      if (!(error instanceof LayoutError) || error.code !== 'PITCH_IMAGE_CAPTION_CAPACITY') throw error;
    }
  }
  throw new LayoutError('PITCH_TEXT_CAPACITY', '图文与图片说明需要更多空间，请拆分页面。');
}

export function designComposition(id: string, content: SlideContent, t: Tools, safe: Box, alternate: boolean): Plan | undefined {
  if (!t.theme.profile) return;
  const images = content.blocks.filter(b => b.kind === 'image');
  if (id === 'cover') return coverPlan(content, t, images, alternate);
  if (id === 'section-divider') {
    const description = [content.subtitle, ...paragraphs(content)].filter(Boolean).join('\n\n');
    const title = place(t, content.title, safe.x, 2.05, safe.w * .84, 'title', 'section', true);
    const body = description ? place(t, description, title.x, title.y + title.h + .22, title.w, 'body', 'body') : undefined;
    if ((body ? body.y + body.h : title.y + title.h) > 5.95) throw new LayoutError('PITCH_TEXT_CAPACITY', '章节说明过长，请拆分。');
    return { composition: 'section-statement', groups: [[title, ...(body ? [body] : [])]] };
  }
  if (id === 'image-text') return imageTextPlan(content, t, images, safe, alternate);
  if (id === 'strategy-framework' || id === 'decision-next-steps') {
    const steps = content.blocks.flatMap(block => block.kind === 'timeline' ? block.entries : []);
    if (!steps.length) throw new LayoutError('PITCH_REQUIRED_CONTENT', '行动计划需要至少一个有日期的步骤。');
    const copy = paragraphs(content).join('\n\n');
    if (id === 'decision-next-steps' && !copy) throw new LayoutError('PITCH_REQUIRED_CONTENT', '决策页需要提供决策内容。');
    const inset = copy ? safe.w * .34 : 0, x = safe.x + inset, w = safe.w - inset;
    const copyWidth = inset - .45;
    const dateW = w * .24, textX = x + dateW, textW = w - dateW;
    const groups: SceneElement[][] = [];
    let rowY = safe.y, group: SceneElement[] = [];
    for (const step of steps) {
      const headingH = measured(t, step.title, textW, 'body', 'subheading');
      const height = Math.max(
        measured(t, step.date, dateW - .14, 'body', 'body'),
        headingH + .07 + measured(t, step.description, textW, 'body', 'body'),
      ) + .38;
      if (height > safe.h) throw new LayoutError('PITCH_TEXT_CAPACITY', '单条行动过长，请拆分。');
      if (rowY + height > safe.y + safe.h) {
        groups.push(group); group = []; rowY = safe.y;
      }
      group.push({ kind: 'line', direction: 'horizontal', arrow: false, x, y: rowY, w, h: .001 },
        place(t, step.date, x, rowY + .18, dateW - .14, 'body', 'body'),
        place(t, step.title, textX, rowY + .18, textW, 'body', 'subheading', true),
        place(t, step.description, textX, rowY + .25 + headingH, textW, 'body', 'body'));
      rowY += height;
    }
    groups.push(group);
    if (copy) {
      const copyPages = groupsOf(t.lines(copy, copyWidth), Math.floor(safe.h / t.lh));
      copyPages.forEach((lines, i) => { (groups[i] ??= []).unshift(place(t, lines.join('\n'), safe.x, safe.y, copyWidth, 'body', 'body')); });
    }
    return { composition: copy ? 'decision-and-actions' : 'action-ledger', groups };
  }
  if (['photo-triptych', 'photo-gallery', 'hero-caption', 'photo-pair'].includes(id) && images.length) {
    const copy = paragraphs(content);
    const photoCount = images.length;
    // Keep unmatched or additional paragraphs on continuation pages in reading order.
    const paired = id === 'photo-triptych' || id === 'photo-gallery';
    const cols = safe.w >= 10 && photoCount >= 5 ? 5 : Math.min(photoCount, id === 'hero-caption' ? 1 : 4);
    const gap = .19, w = (safe.w - (cols - 1) * gap) / cols;
    const groups = groupsOf(images, cols).map((set, page) => {
      const photos = set.map((image, i) => ({
        ...image,
        caption: [image.caption ?? image.alt, paired ? copy[page * cols + i] : undefined].filter(Boolean).join('\n'),
      }));
      const reserved = Math.max(...photos.map(image => measured(t, caption(image), w, 'body', 'caption'))) + .008;
      return photos.flatMap((image, i) => photo(t, image, { ...safe, x: safe.x + (w + gap) * i, w,
        h: cols >= 4 ? Math.min(safe.h, 3.7) : Math.min(safe.h, 4.05) }, 'cover', reserved));
    });
    for (const paragraph of copy.slice(paired ? photoCount : 0)) {
      if (!paired && groups.length === 1) {
        const group = groups[0], used = Math.max(...group.map(e => e.y + e.h));
        const candidate = place(t, paragraph, safe.x, used + .16, safe.w, 'body', 'body');
        if (candidate.y + candidate.h <= safe.y + safe.h) { group.push(candidate); continue; }
      }
      groups.push(...groupsOf(t.lines(paragraph, safe.w), Math.floor(safe.h / t.lh)).map(lines =>
        [place(t, lines.join('\n'), safe.x, safe.y, safe.w, 'body', 'body')]));
    }
    return { composition: cols >= 3 ? 'photo-matrix' : 'photo-spread', groups };
  }
  if (id === 'photo-kpi' && images.length === 1) {
    const w = safe.w * DESIGN_PROFILES[t.theme.profile].imageShare, x = safe.x + w + .38;
    const metrics = content.blocks.filter(b => b.kind === 'metric');
    if (!metrics.length) throw new LayoutError('PITCH_REQUIRED_CONTENT', '照片指标页需要至少一个指标。');
    const image = photo(t, images[0], { ...safe, w });
    const groups = groupsOf(metrics, 3).map(set => {
      const elements: SceneElement[] = [...image];
      let y = safe.y;
      for (const metric of set) {
        const width = safe.x + safe.w - x;
        const label = place(t, metric.label, x, y, width, 'body', 'subheading', true);
        const number = place(t, cellText(metric.value), x, label.y + label.h + .06, width, 'title', 'metric', true);
        const units = [metric.unit, ...(['yoy', 'qoq'] as const).flatMap(key => metric[key] === undefined ? [] : [
          `${content.locale.startsWith('zh') ? key === 'yoy' ? '同比' : '环比' : key.toUpperCase()} ${metric[key] === null ? '—' : metric[key] + '%'}`,
        ])].filter(Boolean).join(' · ');
        elements.push(label, number);
        y = number.y + number.h;
        if (units) {
          const unit = place(t, units, x, y + .02, width, 'body', 'unit');
          elements.push(unit); y = unit.y + unit.h;
        }
        y += .22;
      }
      return elements;
    });
    if (groups.some(group => group.some(e => e.y + e.h > safe.y + safe.h + .01))) throw new LayoutError('PITCH_TEXT_CAPACITY', '指标名称或单位需要更多空间，请拆分页面。');
    return { composition: 'photo-with-metrics', groups };
  }
}

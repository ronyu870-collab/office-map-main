import assert from 'node:assert/strict';

const COLLAPSE = '收起 Colliers AI 工作空间';
const FULLSCREEN = '全屏 Colliers AI 工作空间';
const FOCUS = '退出全屏 Colliers AI 工作空间';

const waitMode = (page, mode) => page.waitForFunction(expected => {
  const node = document.querySelector('#colliers-ai');
  return node?.dataset.mode === expected && node.dataset.transitioning === 'false';
}, mode);

async function draftSnapshot(input) {
  return input.evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd }));
}

async function assertFocusBounds(page) {
  const bounds = await page.evaluate(() => {
    const root = document.querySelector('#colliers-ai'), input = document.querySelector('#home-query');
    const dialog = root.getBoundingClientRect(), editor = input.getBoundingClientRect(), viewport = visualViewport;
    const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const close = root.querySelector('button[aria-label="收起 Colliers AI 工作空间"]').getBoundingClientRect();
    return {
      mode: root.dataset.mode, singleInput: document.querySelectorAll('#home-query').length === 1,
      modal: root.getAttribute('role') === 'dialog' && root.getAttribute('aria-modal') === 'true',
      contained: dialog.left >= left - 1 && dialog.top >= top - 1 && dialog.right <= left + width + 1 && dialog.bottom <= top + height + 1,
      centered: Math.abs(dialog.left + dialog.right - (left * 2 + width)) <= 3,
      substantial: dialog.width >= width * .6 && dialog.height >= height * .6,
      full: Math.abs(dialog.width - width) <= 3 && Math.abs(dialog.height - height) <= 3,
      nearFullscreenRequired: innerWidth < 640 || height < 500,
      editorVisible: editor.top >= dialog.top && editor.bottom <= dialog.bottom + 1,
      touchClose: close.width >= 43 && close.height >= 43,
    };
  });
  assert.equal(bounds.mode, 'focus');
  for (const key of ['singleInput', 'modal', 'contained', 'centered', 'substantial', 'editorVisible', 'touchClose']) {
    assert.equal(bounds[key], true, `focus layout: ${key}`);
  }
  if (bounds.nearFullscreenRequired) assert.equal(bounds.full, true, 'narrow or keyboard-sized focus occupies the visual viewport');
  return bounds;
}

/** Real React DOM and trusted browser pointer/keyboard actions, reusing the
 * existing isolated HTTP fixture. Synthetic composition/viewport events remain
 * explicitly distinct from OS IME and physical-phone acceptance. */
export async function checkFocusTransitions(session, examples) {
  const { page, calls, width } = session;
  const input = page.locator('#home-query'), node = await input.elementHandle();
  const posts = () => calls.filter(call => call.path === '/api/intelligence/query' && call.method === 'POST').length;
  const historyReads = () => calls.filter(call => call.path === '/api/intelligence/query/history').length;
  const beforePosts = posts(), beforeHistory = historyReads();
  await input.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const scroller = document.querySelector('main > div'), input = document.querySelector('#home-query');
    if (!scroller) return;
    // Keep the entry visible while using a nonzero real homepage position when
    // the responsive business page is taller than its viewport.
    scroller.scrollTop = Math.min(64, Math.max(0, input.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24),
      Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  });
  await page.evaluate(() => {
    const input = document.querySelector('#home-query'), surface = document.querySelector('#colliers-ai');
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height };
    };
    const snapshot = () => ({ composer: rect(input.parentElement), input: rect(input),
      pageTop: document.querySelector('main > div')?.scrollTop ?? 0 });
    const start = event => {
      if (event.target !== input || !event.isTrusted) return;
      document.removeEventListener('pointerdown', start, true);
      window.__queryFocusOrigin = { before: snapshot(), first: null };
      const observer = new MutationObserver(() => {
        if (surface.dataset.mode !== 'focus') return;
        window.__queryFocusOrigin.first = snapshot(); observer.disconnect();
      });
      observer.observe(surface, { attributes: true, attributeFilter: ['data-mode'] });
    };
    document.addEventListener('pointerdown', start, true);
  });
  if (width < 640) await input.tap();
  else await input.click();
  await waitMode(page, 'focus');
  const origin = await page.evaluate(() => window.__queryFocusOrigin);
  assert.ok(origin?.first, 'input pointer action entered focus');
  for (const field of ['top', 'left', 'width', 'height']) {
    assert.ok(Math.abs(origin.before.composer[field] - origin.first.composer[field]) <= 3,
      `composer starts at its existing ${field}: ${origin.before.composer[field]} -> ${origin.first.composer[field]}`);
  }
  assert.equal(await node.evaluate(element => element === document.querySelector('#home-query') && element === document.activeElement), true,
    'entering focus retains the original focused editor');
  assert.equal(posts(), beforePosts, 'focus does not submit');
  assert.equal(historyReads(), beforeHistory, 'focus does not preload history');
  assert.equal(await page.getByRole('complementary', { name: '历史工作记录', exact: true }).isVisible(), false);
  const geometry = await assertFocusBounds(page);

  await input.fill('CBD 中文草稿，尚未发送');
  await input.press('ArrowLeft'); await input.press('Shift+ArrowLeft');
  const draft = await draftSnapshot(input);
  await input.dispatchEvent('compositionstart', { data: '中文' });
  for (const [label, target] of [[FULLSCREEN, 'expanded'], [FOCUS, 'focus'], [COLLAPSE, 'compact']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await waitMode(page, target);
    assert.deepEqual(await draftSnapshot(input), draft, 'mode switch preserves draft and selection during composition');
    assert.equal(await node.evaluate(element => element === document.activeElement && element === document.querySelector('#home-query')), true,
      'mode switch preserves the actual composing editor');
  }
  // The same focused editor must reopen on an explicit pointer action even
  // when composition prevented a focus change during the previous collapse.
  await input.click(); await waitMode(page, 'focus');
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  await input.dispatchEvent('keydown', { key: 'Escape', keyCode: 229, isComposing: true, bubbles: true });
  assert.equal(posts(), beforePosts, 'composition Enter never submits');
  await waitMode(page, 'focus');
  await input.dispatchEvent('compositionend', { data: '中文' });
  await page.getByRole('button', { name: COLLAPSE, exact: true }).click();
  await waitMode(page, 'compact');
  const restoredTop = await page.evaluate(() => document.querySelector('main > div')?.scrollTop ?? 0);
  assert.equal(restoredTop, origin.before.pageTop, 'collapse restores the actual homepage scroller');

  // Verify the original authorized question, not its shortened display label.
  const suggestion = page.getByRole('button', { name: `查找办公楼：${examples[0]}`, exact: true });
  await suggestion.click(); await waitMode(page, 'focus');
  assert.equal(await input.inputValue(), examples[0], 'suggestion fills the complete original question');
  assert.equal(await node.evaluate(element => element === document.activeElement), true, 'suggestion remains editable');
  assert.equal(posts(), beforePosts, 'suggestion waits for confirmation');
  await input.press('End'); await input.pressSequentially(' 继续编辑');
  const edited = await input.inputValue();
  await page.getByRole('button', { name: COLLAPSE, exact: true }).click(); await waitMode(page, 'compact');
  await input.focus(); await waitMode(page, 'focus');
  assert.equal(await input.inputValue(), edited, 'keyboard focus restores the same editable draft');
  await page.getByRole('button', { name: '历史记录', exact: true }).focus();
  await waitMode(page, 'focus');
  assert.equal(posts(), beforePosts, 'ordinary blur does not submit');

  // Deliberately interrupt both directions before 300ms. Native pointer events
  // hit the live controls; animation callbacks must not win over the last action.
  await page.getByRole('button', { name: COLLAPSE, exact: true }).press('Enter');
  await input.focus();
  await page.getByRole('button', { name: COLLAPSE, exact: true }).press('Enter');
  await waitMode(page, 'compact');
  assert.equal(await input.inputValue(), edited);
  assert.equal(await node.evaluate(element => element === document.querySelector('#home-query')), true);

  // Reduced motion uses the same controls and state without geometry animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.focus(); await waitMode(page, 'focus');
  assert.equal(await page.locator('#colliers-ai').evaluate(element => element.getAnimations({ subtree: true })
    .some(animation => animation.playState === 'running')), false, 'reduced motion removes transition animations');
  await input.fill('');
  await page.getByRole('button', { name: COLLAPSE, exact: true }).click(); await waitMode(page, 'compact');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(posts(), beforePosts);
  assert.equal(historyReads(), beforeHistory);
  await node.dispose();
  session.interactionChecks = { ...session.interactionChecks, focusTransition: {
    passed: true, origin, geometry, inputNodeAndSelection: true, syntheticComposition: true,
    explicitSuggestionConfirmation: true, rapidReversal: true, backgroundScrollRestored: true, reducedMotion: true,
    noQueryAndNoHistoryRead: true,
  } };
}

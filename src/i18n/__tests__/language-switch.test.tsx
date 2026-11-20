import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HtmlLanguage, useLanguage } from '../useLanguage';

function Harness() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <>
      <HtmlLanguage />
      <output data-testid="language">{language}</output>
      <button type="button" onClick={() => setLanguage('en-US')}>{t('修改密码')}</button>
      <button type="button" onClick={() => setLanguage('zh-CN')}>中文</button>
    </>
  );
}

describe('browser-local basic language switch', () => {
  beforeEach(() => {
    window.localStorage.removeItem('colliers.interface-language.v1');
    document.documentElement.lang = 'zh-CN';
  });
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem('colliers.interface-language.v1');
  });
  it('switches immediately without navigation and persists on remount', () => {
    const view = render(<Harness />);
    expect(screen.getByRole('button', { name: '修改密码' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy();
    expect(screen.getByTestId('language').textContent).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(window.localStorage.getItem('colliers.interface-language.v1')).toBe('en-US');
    view.unmount();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

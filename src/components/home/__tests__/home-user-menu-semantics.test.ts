import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const home = readFileSync(resolve(process.cwd(), 'src/components/home/HomeWorkspace.tsx'), 'utf8');

describe('Home user menu semantics', () => {
  it('keeps System Administration inside the menu keyboard model', () => {
    const adminLinkStart = home.indexOf('href={ADMIN_WORKSPACE.href}');
    const adminLinkEnd = home.indexOf('</Link>', adminLinkStart);
    const adminLink = home.slice(adminLinkStart, adminLinkEnd);

    expect(adminLinkStart).toBeGreaterThan(-1);
    expect(adminLink).toContain('{...adminAccessibilityProps}');
    expect(adminLink).toContain('role="menuitem"');
    expect(adminLink.indexOf('{...adminAccessibilityProps}')).toBeLessThan(adminLink.indexOf('role="menuitem"'));
  });
});

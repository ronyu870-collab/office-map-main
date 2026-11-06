import { describe, expect, it } from 'vitest';

import { canSeeOccupierReportCard } from '../occupierReportCard';

describe('occupier report card visibility', () => {
  it('lets administrators see the card regardless of their email', () => {
    expect(canSeeOccupierReportCard('admin', 'someone@colliers.com')).toBe(true);
    expect(canSeeOccupierReportCard('admin', null)).toBe(true);
  });

  it('lets the named report owner see the card, ignoring case and surrounding spaces', () => {
    expect(canSeeOccupierReportCard('editor', 'tony.yan@colliers.com')).toBe(true);
    expect(canSeeOccupierReportCard('viewer', '  Tony.Yan@Colliers.com ')).toBe(true);
  });

  it('hides the card from every other signed-in user and from unknown sessions', () => {
    expect(canSeeOccupierReportCard('editor', 'editor@colliers.com')).toBe(false);
    expect(canSeeOccupierReportCard('viewer', 'viewer@colliers.com')).toBe(false);
    expect(canSeeOccupierReportCard('viewer', undefined)).toBe(false);
    expect(canSeeOccupierReportCard(null, 'tony.yan@colliers.com')).toBe(false);
  });
});

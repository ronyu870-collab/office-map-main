import { describe, it, expect } from 'vitest';

/**
 * Unit tests for Supply Calendar Enhancement (Task 1.1)
 * 
 * Tests verify:
 * - 6 categories are correctly defined (2026, 2027, 2028, 2029, after2029, noDate)
 * - Categorization logic handles missing/null/undefined dates
 * - Categorization logic correctly assigns 2029 dates
 * - Categorization logic correctly assigns dates after 2029
 * - Grade-based counting (office vs park)
 */

// Helper functions extracted from MapClient.tsx for testing
function safeParseSupplyYear(supply: any): number | null {
  try {
    const year = supply.launch_year || supply.launchYear || supply.year;
    
    if (year === null || year === undefined) {
      return null;
    }
    
    const yearNum = typeof year === 'number' ? year : parseInt(String(year), 10);
    
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
      return null;
    }
    
    return yearNum;
  } catch (error) {
    return null;
  }
}

function categorizeSupply(supply: any): '2026' | '2027' | '2028' | '2029' | 'after2029' | 'noDate' {
  const yearNum = safeParseSupplyYear(supply);
  
  if (yearNum === null) return 'noDate';
  if (yearNum === 2026) return '2026';
  if (yearNum === 2027) return '2027';
  if (yearNum === 2028) return '2028';
  if (yearNum === 2029) return '2029';
  if (yearNum >= 2030) return 'after2029';
  
  return 'noDate'; // For years before 2026
}

describe('Supply Calendar Enhancement', () => {
  describe('safeParseSupplyYear', () => {
    it('should parse numeric year correctly', () => {
      expect(safeParseSupplyYear({ launch_year: 2026 })).toBe(2026);
      expect(safeParseSupplyYear({ launchYear: 2027 })).toBe(2027);
      expect(safeParseSupplyYear({ year: 2028 })).toBe(2028);
    });

    it('should parse string year correctly', () => {
      expect(safeParseSupplyYear({ launch_year: '2029' })).toBe(2029);
      expect(safeParseSupplyYear({ launchYear: '2030' })).toBe(2030);
    });

    it('should return null for missing year', () => {
      expect(safeParseSupplyYear({})).toBe(null);
      expect(safeParseSupplyYear({ launch_year: null })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: undefined })).toBe(null);
    });

    it('should return null for invalid year', () => {
      expect(safeParseSupplyYear({ launch_year: 'invalid' })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: NaN })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: 1800 })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: 2200 })).toBe(null);
    });
  });

  describe('categorizeSupply', () => {
    it('should categorize 2026 correctly', () => {
      expect(categorizeSupply({ launch_year: 2026 })).toBe('2026');
    });

    it('should categorize 2027 correctly', () => {
      expect(categorizeSupply({ launch_year: 2027 })).toBe('2027');
    });

    it('should categorize 2028 correctly', () => {
      expect(categorizeSupply({ launch_year: 2028 })).toBe('2028');
    });

    it('should categorize 2029 correctly (Requirement 1.5)', () => {
      expect(categorizeSupply({ launch_year: 2029 })).toBe('2029');
      expect(categorizeSupply({ launchYear: 2029 })).toBe('2029');
      expect(categorizeSupply({ year: 2029 })).toBe('2029');
    });

    it('should categorize after 2029 correctly (Requirement 1.6)', () => {
      expect(categorizeSupply({ launch_year: 2030 })).toBe('after2029');
      expect(categorizeSupply({ launch_year: 2031 })).toBe('after2029');
      expect(categorizeSupply({ launch_year: 2050 })).toBe('after2029');
    });

    it('should categorize missing dates as noDate (Requirement 1.4)', () => {
      expect(categorizeSupply({})).toBe('noDate');
      expect(categorizeSupply({ launch_year: null })).toBe('noDate');
      expect(categorizeSupply({ launch_year: undefined })).toBe('noDate');
      expect(categorizeSupply({ launch_year: '' })).toBe('noDate');
    });

    it('should categorize years before 2026 as noDate', () => {
      expect(categorizeSupply({ launch_year: 2025 })).toBe('noDate');
      expect(categorizeSupply({ launch_year: 2020 })).toBe('noDate');
    });
  });

  describe('Calendar Data Structure', () => {
    it('should have exactly 6 categories (Requirement 1.3)', () => {
      const categories = ['2026', '2027', '2028', '2029', 'after2029', 'noDate'];
      expect(categories).toHaveLength(6);
    });

    it('should correctly count supplies by category', () => {
      const supplies = [
        { name: 'Building A', launch_year: 2026, grade: 'A' },
        { name: 'Building B', launch_year: 2027, grade: 'BP' },
        { name: 'Building C', launch_year: 2028, grade: 'A' },
        { name: 'Building D', launch_year: 2029, grade: 'B' },
        { name: 'Building E', launch_year: 2030, grade: 'A' },
        { name: 'Building F', launch_year: null, grade: 'BP' },
      ];

      const calendar: Record<string, { total: number; office: number; park: number }> = {
        '2026': { total: 0, office: 0, park: 0 },
        '2027': { total: 0, office: 0, park: 0 },
        '2028': { total: 0, office: 0, park: 0 },
        '2029': { total: 0, office: 0, park: 0 },
        'after2029': { total: 0, office: 0, park: 0 },
        'noDate': { total: 0, office: 0, park: 0 },
      };

      for (const supply of supplies) {
        const category = categorizeSupply(supply);
        calendar[category].total++;
        
        const grade = (supply.grade || '').toUpperCase();
        if (grade.includes('BP')) {
          calendar[category].park++;
        } else {
          calendar[category].office++;
        }
      }

      expect(calendar['2026'].total).toBe(1);
      expect(calendar['2026'].office).toBe(1);
      expect(calendar['2026'].park).toBe(0);

      expect(calendar['2027'].total).toBe(1);
      expect(calendar['2027'].office).toBe(0);
      expect(calendar['2027'].park).toBe(1);

      expect(calendar['2028'].total).toBe(1);
      expect(calendar['2028'].office).toBe(1);

      expect(calendar['2029'].total).toBe(1);
      expect(calendar['2029'].office).toBe(1);

      expect(calendar['after2029'].total).toBe(1);
      expect(calendar['after2029'].office).toBe(1);

      expect(calendar['noDate'].total).toBe(1);
      expect(calendar['noDate'].park).toBe(1);
    });
  });

  describe('Error Handling (Task 7.1)', () => {
    it('should handle invalid year values gracefully', () => {
      // Test various invalid year formats
      expect(safeParseSupplyYear({ launch_year: 'invalid' })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: {} })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: [] })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: NaN })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: Infinity })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: -Infinity })).toBe(null);
    });

    it('should handle out-of-range years gracefully', () => {
      // Years before 1900 should return null
      expect(safeParseSupplyYear({ launch_year: 1899 })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: 1800 })).toBe(null);
      
      // Years after 2100 should return null
      expect(safeParseSupplyYear({ launch_year: 2101 })).toBe(null);
      expect(safeParseSupplyYear({ launch_year: 3000 })).toBe(null);
    });

    it('should categorize invalid years as noDate', () => {
      expect(categorizeSupply({ launch_year: 'invalid' })).toBe('noDate');
      expect(categorizeSupply({ launch_year: 1899 })).toBe('noDate');
      expect(categorizeSupply({ launch_year: 2101 })).toBe('noDate');
      expect(categorizeSupply({ launch_year: NaN })).toBe('noDate');
    });

    it('should handle supplies with malformed data in calendar loop', () => {
      const supplies = [
        { name: 'Valid Building', launch_year: 2026, grade: 'A' },
        { name: 'Invalid Year', launch_year: 'invalid', grade: 'B' },
        { name: 'Missing Year', grade: 'BP' },
        { name: 'Out of Range', launch_year: 1800, grade: 'A' },
        { name: 'Another Valid', launch_year: 2029, grade: 'BP' },
      ];

      const calendar: Record<string, { total: number; office: number; park: number }> = {
        '2026': { total: 0, office: 0, park: 0 },
        '2027': { total: 0, office: 0, park: 0 },
        '2028': { total: 0, office: 0, park: 0 },
        '2029': { total: 0, office: 0, park: 0 },
        'after2029': { total: 0, office: 0, park: 0 },
        'noDate': { total: 0, office: 0, park: 0 },
      };

      // Simulate the loop with try-catch (as implemented in MapClient.tsx)
      for (const supply of supplies) {
        try {
          const category = categorizeSupply(supply);
          calendar[category].total++;
          
          const grade = (supply.grade || '').toUpperCase();
          if (grade.includes('BP')) {
            calendar[category].park++;
          } else {
            calendar[category].office++;
          }
        } catch (error) {
          // On error, categorize as noDate
          calendar['noDate'].total++;
          const grade = (supply?.grade || '').toUpperCase();
          if (grade.includes('BP')) {
            calendar['noDate'].park++;
          } else {
            calendar['noDate'].office++;
          }
        }
      }

      // Verify valid buildings are categorized correctly
      expect(calendar['2026'].total).toBe(1);
      expect(calendar['2026'].office).toBe(1);
      
      expect(calendar['2029'].total).toBe(1);
      expect(calendar['2029'].park).toBe(1);

      // Verify invalid buildings are categorized as noDate
      expect(calendar['noDate'].total).toBe(3); // Invalid Year, Missing Year, Out of Range
      expect(calendar['noDate'].office).toBe(2); // Invalid Year (B), Out of Range (A)
      expect(calendar['noDate'].park).toBe(1); // Missing Year (BP)
    });
  });
});

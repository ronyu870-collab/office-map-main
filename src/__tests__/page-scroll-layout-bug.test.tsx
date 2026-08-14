/**
 * Bug Condition Exploration Test - Page Scroll Layout Fix
 * 
 * **Property 1: Bug Condition** - 页面级滚动存在于非管理员页面
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * 
 * **GOAL**: Surface counterexamples that demonstrate page-level scrolling exists
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fc from 'fast-check';

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: (fn: any) => {
    const Component = () => <div>Dynamic Component</div>;
    return Component;
  },
}));

// Mock Auth service
vi.mock('@/src/services/Auth', () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { email: 'test@example.com' },
    displayName: 'Test User',
    role: 'viewer',
  }),
  getSessionFast: vi.fn().mockResolvedValue({
    user: { email: 'test@example.com' },
    displayName: 'Test User',
    role: 'viewer',
  }),
  signOut: vi.fn(),
}));

// Mock other dependencies
vi.mock('@/src/utils/audit', () => ({
  logAction: vi.fn(),
}));

vi.mock('@/src/utils/performanceLogger', () => ({
  perfStart: vi.fn(),
  perfEnd: vi.fn(),
  perfMark: vi.fn(),
  perfReport: vi.fn(),
}));

vi.mock('@/src/components/CommunicationBoard', () => ({
  CommunicationBoard: ({ userEmail, userName }: any) => (
    <div data-testid="communication-board">
      <div>Communication Board</div>
      <div>User: {userName}</div>
      {/* Simulate many messages to create overflow */}
      {Array.from({ length: 50 }, (_, i) => (
        <div key={i} style={{ height: '100px' }}>
          Message {i + 1}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/src/components/NoticeBanner', () => ({
  NoticeBanner: () => (
    <div data-testid="notice-banner">
      Notice Banner
    </div>
  ),
}));

// Import pages after mocks are set up
import LobbyPage from '@/src/app/page';
import BIPage from '@/src/app/bi/page';
import SettingsPage from '@/src/app/settings/page';
import OSSPage from '@/src/app/oss/page';

/**
 * Page types for testing
 */
type PageType = 'home' | 'bi' | 'settings' | 'oss';

interface PageLayoutInfo {
  pageType: PageType;
  containerElement: HTMLElement | null;
  mainContentElement: HTMLElement | null;
  hasPageScroll: boolean;
  containerClasses: string;
  mainContentClasses: string;
  containerHeight: string;
  containerOverflow: string;
}

/**
 * Bug Condition Function
 * 
 * Returns true when page exhibits page-level scrolling
 * Expected behavior: Page container should be h-screen + overflow-hidden
 */
function isBugCondition(layoutInfo: PageLayoutInfo): boolean {
  const { containerClasses, containerOverflow, hasPageScroll } = layoutInfo;
  
  // Bug exists if:
  // 1. Container uses min-h-dvh (allows content to exceed viewport)
  // 2. Container doesn't have overflow-hidden
  // 3. Page has scrollbar (hasPageScroll = true)
  
  const usesMinHeight = containerClasses.includes('min-h-dvh') || containerClasses.includes('min-h-screen');
  const lacksOverflowHidden = !containerClasses.includes('overflow-hidden');
  
  return (usesMinHeight && lacksOverflowHidden) || hasPageScroll;
}

/**
 * Analyze page layout structure
 */
function analyzePageLayout(container: HTMLElement): PageLayoutInfo {
  const pageType = container.getAttribute('data-page-type') as PageType || 'home';
  
  // Find the main content area
  const mainContentElement = container.querySelector('main');
  
  // Get computed styles
  const containerStyles = window.getComputedStyle(container);
  const containerClasses = container.className;
  const mainContentClasses = mainContentElement?.className || '';
  
  // Check if page has scroll
  const hasPageScroll = container.scrollHeight > container.clientHeight;
  
  return {
    pageType,
    containerElement: container,
    mainContentElement,
    hasPageScroll,
    containerClasses,
    mainContentClasses,
    containerHeight: containerStyles.height,
    containerOverflow: containerStyles.overflow,
  };
}

describe('Bug Condition Exploration - Page Scroll Layout', () => {
  beforeEach(() => {
    // Reset viewport
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 800,
    });
  });

  describe('Property 1: Bug Condition - 页面级滚动存在', () => {
    it('✅ Home page (/) should have fixed layout without page scrolling', async () => {
      const { container } = render(<LobbyPage />);
      
      // Wait for async content to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Find the outermost page container
      const pageContainer = container.firstChild as HTMLElement;
      if (pageContainer) {
        pageContainer.setAttribute('data-page-type', 'home');
      }
      
      const layoutInfo = analyzePageLayout(pageContainer);
      
      console.log('\n📊 Home Page Layout Analysis:');
      console.log(`   Container Classes: ${layoutInfo.containerClasses}`);
      console.log(`   Main Content Classes: ${layoutInfo.mainContentClasses}`);
      console.log(`   Container Height: ${layoutInfo.containerHeight}`);
      console.log(`   Container Overflow: ${layoutInfo.containerOverflow}`);
      console.log(`   Has Page Scroll: ${layoutInfo.hasPageScroll ? '❌ YES (BUG!)' : '✅ NO'}`);
      console.log(`   Bug Condition: ${isBugCondition(layoutInfo) ? '❌ TRUE (BUG EXISTS)' : '✅ FALSE'}`);
      
      // Expected Behavior:
      // - Container should use h-screen (not min-h-dvh)
      // - Container should have overflow-hidden
      // - Main content should have overflow-hidden (home page has fixed sections, no scrolling needed)
      // - Page should NOT have page-level scrolling
      
      expect(layoutInfo.containerClasses).toContain('h-screen');
      expect(layoutInfo.containerClasses).toContain('overflow-hidden');
      expect(layoutInfo.mainContentClasses).toContain('overflow-hidden');
      expect(layoutInfo.hasPageScroll).toBe(false);
    });

    it('❌ EXPECTED TO FAIL: BI page (/bi) should NOT have page-level scrolling', async () => {
      // Mock buildings data
      vi.mock('@/src/hooks/useBuildingsWithPerformance', () => ({
        useBuildingsWithPerformance: () => ({
          buildings: Array.from({ length: 100 }, (_, i) => ({
            id: i,
            name: `Building ${i}`,
            '总面积': 10000,
            '空置面积': 1000,
            '净有效租金': 100,
            '写字楼等级': 'A',
            '子市场': 'CBD',
            record_year: '2025',
            record_quarter: 'Q4',
          })),
          isLoading: false,
          error: null,
          mutate: vi.fn(),
        }),
      }));
      
      const { container } = render(<BIPage />);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pageContainer = container.firstChild as HTMLElement;
      if (pageContainer) {
        pageContainer.setAttribute('data-page-type', 'bi');
      }
      
      const layoutInfo = analyzePageLayout(pageContainer);
      
      console.log('\n📊 BI Page Layout Analysis:');
      console.log(`   Container Classes: ${layoutInfo.containerClasses}`);
      console.log(`   Main Content Classes: ${layoutInfo.mainContentClasses}`);
      console.log(`   Has Page Scroll: ${layoutInfo.hasPageScroll ? '❌ YES (BUG!)' : '✅ NO'}`);
      console.log(`   Bug Condition: ${isBugCondition(layoutInfo) ? '❌ TRUE (BUG EXISTS)' : '✅ FALSE'}`);
      
      // Expected Behavior (will FAIL on unfixed code):
      expect(layoutInfo.containerClasses).toContain('h-screen');
      expect(layoutInfo.containerClasses).toContain('overflow-hidden');
      expect(layoutInfo.mainContentClasses).toContain('overflow-y-auto');
      expect(layoutInfo.hasPageScroll).toBe(false);
    });

    it('❌ EXPECTED TO FAIL: Settings page (/settings) should NOT have page-level scrolling', async () => {
      const { container } = render(<SettingsPage />);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pageContainer = container.firstChild as HTMLElement;
      if (pageContainer) {
        pageContainer.setAttribute('data-page-type', 'settings');
      }
      
      const layoutInfo = analyzePageLayout(pageContainer);
      
      console.log('\n📊 Settings Page Layout Analysis:');
      console.log(`   Container Classes: ${layoutInfo.containerClasses}`);
      console.log(`   Main Content Classes: ${layoutInfo.mainContentClasses}`);
      console.log(`   Has Page Scroll: ${layoutInfo.hasPageScroll ? '❌ YES (BUG!)' : '✅ NO'}`);
      console.log(`   Bug Condition: ${isBugCondition(layoutInfo) ? '❌ TRUE (BUG EXISTS)' : '✅ FALSE'}`);
      
      // Expected Behavior:
      expect(layoutInfo.containerClasses).toContain('h-screen');
      expect(layoutInfo.containerClasses).toContain('overflow-hidden');
      expect(layoutInfo.mainContentClasses).toContain('overflow-y-auto');
      expect(layoutInfo.hasPageScroll).toBe(false);
    });

    it('❌ EXPECTED TO FAIL: OSS page (/oss) should NOT have page-level scrolling', async () => {
      const { container } = render(<OSSPage />);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pageContainer = container.firstChild as HTMLElement;
      if (pageContainer) {
        pageContainer.setAttribute('data-page-type', 'oss');
      }
      
      const layoutInfo = analyzePageLayout(pageContainer);
      
      console.log('\n📊 OSS Page Layout Analysis:');
      console.log(`   Container Classes: ${layoutInfo.containerClasses}`);
      console.log(`   Main Content Classes: ${layoutInfo.mainContentClasses}`);
      console.log(`   Has Page Scroll: ${layoutInfo.hasPageScroll ? '❌ YES (BUG!)' : '✅ NO'}`);
      console.log(`   Bug Condition: ${isBugCondition(layoutInfo) ? '❌ TRUE (BUG EXISTS)' : '✅ FALSE'}`);
      
      // Expected Behavior:
      expect(layoutInfo.containerClasses).toContain('h-screen');
      expect(layoutInfo.containerClasses).toContain('overflow-hidden');
      expect(layoutInfo.mainContentClasses).toContain('overflow-y-auto');
      expect(layoutInfo.hasPageScroll).toBe(false);
    });
  });

  describe('Property-Based Testing: Layout Structure Across Pages', () => {
    it('❌ EXPECTED TO FAIL: Property - All non-admin pages should use fixed height layout', async () => {
      const pageComponents = [
        { name: 'home', component: LobbyPage },
        { name: 'bi', component: BIPage },
        { name: 'settings', component: SettingsPage },
        { name: 'oss', component: OSSPage },
      ];

      const counterexamples: Array<{ page: string; layoutInfo: PageLayoutInfo }> = [];

      for (const { name, component: PageComponent } of pageComponents) {
        const { container } = render(<PageComponent />);
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const pageContainer = container.firstChild as HTMLElement;
        if (pageContainer) {
          pageContainer.setAttribute('data-page-type', name as PageType);
        }
        
        const layoutInfo = analyzePageLayout(pageContainer);
        
        // Check if this is a bug condition
        if (isBugCondition(layoutInfo)) {
          counterexamples.push({ page: name, layoutInfo });
          console.log(`\n❌ Counterexample found: ${name} page`);
          console.log(`   Container uses min-h-dvh: ${layoutInfo.containerClasses.includes('min-h-dvh')}`);
          console.log(`   Container lacks overflow-hidden: ${!layoutInfo.containerClasses.includes('overflow-hidden')}`);
          console.log(`   Has page scroll: ${layoutInfo.hasPageScroll}`);
        }
      }

      // Document counterexamples
      if (counterexamples.length > 0) {
        console.log(`\n📋 Counterexamples Summary:`);
        console.log(`   Total pages with bug: ${counterexamples.length}/${pageComponents.length}`);
        console.log(`   Pages affected:`);
        counterexamples.forEach(({ page, layoutInfo }) => {
          console.log(`     - ${page}: ${layoutInfo.containerClasses.substring(0, 100)}...`);
        });
      }

      // Expected Behavior: No pages should have bug condition
      // This will FAIL on unfixed code
      expect(counterexamples.length).toBe(0);
    });
  });

  describe('Root Cause Analysis', () => {
    it('📊 Document layout patterns in unfixed code', () => {
      console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                    BUG CONDITION DOCUMENTATION                             ║
╚════════════════════════════════════════════════════════════════════════════╝

🎯 GOAL: Identify pages with page-level scrolling bug

❌ BUG CONDITION:
   Pages use min-h-dvh (minimum height = viewport) instead of h-screen (fixed height)
   This allows content to exceed viewport height, causing page-level scrolling

🔍 ROOT CAUSE ANALYSIS:
   1. Home page (/): Uses 'min-h-dvh flex-col' on container
      - When沟通看板 has many messages, page height exceeds viewport
      - Result: Entire page scrolls (not just content area)
   
   2. BI page (/bi): Main content area uses 'overflow-y-auto' at wrong level
      - When multiple charts exist, page height exceeds viewport
      - Result: Entire page scrolls (not just chart area)
   
   3. Settings/OSS pages: Similar pattern to home page
      - Use min-h-dvh or lack overflow-hidden on container
      - Result: Page-level scrolling when content overflows

📋 EXPECTED BEHAVIOR (AFTER FIX):
   ✅ Page container: h-screen + overflow-hidden (fixed at viewport height)
   ✅ Header: shrink-0 (doesn't shrink)
   ✅ Main content: flex-1 + overflow-y-auto (scrolls internally)
   ✅ Result: Page fixed, content scrolls in dedicated area

🎯 FIX STRATEGY:
   1. Replace 'min-h-dvh' with 'h-screen' on page containers
   2. Add 'overflow-hidden' to page containers
   3. Ensure main content uses 'flex-1 overflow-y-auto'
   4. Verify header uses 'shrink-0'

⚠️ PRESERVATION REQUIREMENTS:
   - Admin page (/admin) should keep page-level scrolling
   - Table/chart internal scrolling must continue working
   - Responsive layout must work on all screen sizes
   - Keyboard navigation must remain functional
      `);
      
      expect(true).toBe(true);
    });
  });
});

describe('Bug Condition Verification Results', () => {
  it('📝 Document test execution results', () => {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                    TEST EXECUTION SUMMARY                                  ║
╚════════════════════════════════════════════════════════════════════════════╝

🎯 TEST PURPOSE: Bug Condition Exploration (Task 1)

❌ EXPECTED OUTCOME: Tests FAIL on unfixed code
   This confirms the bug exists and needs to be fixed

✅ WHAT HAPPENS AFTER FIX:
   When Task 3 implements the fix, these SAME tests will PASS
   This validates that the expected behavior is achieved

📊 TEST COVERAGE:
   ✅ Home page (/) - Tests for page-level scrolling
   ✅ BI page (/bi) - Tests for page-level scrolling  
   ✅ Settings page (/settings) - Tests for page-level scrolling
   ✅ OSS page (/oss) - Tests for page-level scrolling
   ✅ Property-based test - Tests all pages systematically

🔍 COUNTEREXAMPLES TO DOCUMENT:
   When tests fail, note which pages exhibit the bug:
   - Which pages use min-h-dvh?
   - Which pages lack overflow-hidden?
   - Which pages have page-level scrolling?

📋 NEXT STEPS:
   1. ✅ Task 1 Complete: Bug condition test written and run
   2. ⏭️  Task 2: Write preservation property tests
   3. ⏭️  Task 3: Implement fix
   4. ⏭️  Task 3.3: Re-run this test (should PASS after fix)
    `);
    
    expect(true).toBe(true);
  });
});

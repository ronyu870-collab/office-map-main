const fs = require('node:fs');

const file = 'src/__tests__/page-scroll-layout-preservation.test.tsx';
const source = fs.readFileSync(file, 'utf8');

const oldMock = `// Mock Next.js modules
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/',
}));`;

const newMock = `// Mock Next.js navigation with stable functions that are re-seeded before each test.
// This prevents mock implementation leakage between preservation tests and covers
// the current Next.js navigation APIs used by AdminPage and UpdatePage.
const navigationMocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: navigationMocks.useRouter,
  useSearchParams: navigationMocks.useSearchParams,
  usePathname: navigationMocks.usePathname,
}));`;

const oldBeforeEach = `  beforeEach(() => {
    // Reset viewport
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 800,
    });
  });`;

const newBeforeEach = `  beforeEach(() => {
    navigationMocks.useRouter.mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    });
    navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams());
    navigationMocks.usePathname.mockReturnValue('/');

    // Reset viewport
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 800,
    });
  });`;

let next = source;
if (next.includes(oldMock)) {
  next = next.replace(oldMock, newMock);
} else if (!next.includes('const navigationMocks = vi.hoisted')) {
  throw new Error('Expected next/navigation mock block was not found. Refusing fuzzy edit.');
}

if (next.includes(oldBeforeEach)) {
  next = next.replace(oldBeforeEach, newBeforeEach);
} else if (!next.includes('navigationMocks.useSearchParams.mockReturnValue')) {
  throw new Error('Expected preservation beforeEach block was not found. Refusing fuzzy edit.');
}

if (next !== source) {
  fs.writeFileSync(file, next);
  console.log(`Updated ${file}`);
} else {
  console.log(`${file} already contains the isolation fix`);
}

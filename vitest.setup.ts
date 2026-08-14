// Setup file for Vitest
import { beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock Image constructor for testing
beforeAll(() => {
  // Store original Image
  const OriginalImage = global.Image;
  
  // Mock Image to allow testing without actual image loading
  global.Image = class MockImage extends OriginalImage {
    constructor() {
      super();
      // Set default dimensions
      Object.defineProperty(this, 'naturalWidth', { value: 100, writable: true });
      Object.defineProperty(this, 'naturalHeight', { value: 100, writable: true });
      Object.defineProperty(this, 'complete', { value: false, writable: true });
    }
    
    set src(value: string) {
      // Simulate async loading
      setTimeout(() => {
        Object.defineProperty(this, 'complete', { value: true, writable: true });
        if (this.onload) {
          this.onload(new Event('load'));
        }
      }, 0);
    }
    
    get src() {
      return '';
    }
  } as any;
});

afterEach(() => {
  // Clean up DOM
  document.body.innerHTML = '';
});

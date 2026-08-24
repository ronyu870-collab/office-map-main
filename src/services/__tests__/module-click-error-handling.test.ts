/**
 * Test suite for module click handler error handling (Task 7.3)
 * 
 * Validates Requirements: 4.6, 4.7
 * - Requirement 4.6: WHEN a user clicks the 周边项目对比 Action_Module, THE Bottom_Panel SHALL trigger the comparison functionality
 * - Requirement 4.7: WHEN a user clicks a Grayed_Module, THE Bottom_Panel SHALL not trigger any action
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Module Click Handler Error Handling', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let alertSpy: any;
  let MapController: any;

  beforeEach(async () => {
    // Ensure window and document are available for isBrowser() check
    if (typeof global.window === 'undefined') {
      (global as any).window = {};
    }
    if (typeof global.document === 'undefined') {
      (global as any).document = {};
    }

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock alert
    alertSpy = vi.fn();
    global.alert = alertSpy;

    // Dynamically import MapController after setting up the environment
    const module = await import('../MapController');
    MapController = module.MapController;
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    
    // Clean up global function
    if ((global.window as any)?.__colliers_analyzeCompetitors) {
      delete (global.window as any).__colliers_analyzeCompetitors;
    }
  });

  describe('Error Handling', () => {
    it('should log module click events for analytics', () => {
      const controller = new MapController();

      // Mock the analyzeCompetitors method
      controller.analyzeCompetitors = vi.fn();

      // Mock map initialization
      (controller as any).map = { mock: 'map' };
      (controller as any).AMap = { mock: 'AMap' };

      // Simulate module click
      const buildingId = 'test-building-123';
      const lng = 116.460787;
      const lat = 39.905477;
      const rent = 150;

      (global.window as any).__colliers_analyzeCompetitors(buildingId, lng, lat, rent);

      // Verify analytics logging
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Action Module] 周边项目对比 clicked',
        expect.objectContaining({
          buildingId,
          lng,
          lat,
          rent,
          timestamp: expect.any(String),
        })
      );
    });

    it('should display user-friendly error message when map is not initialized', () => {
      const controller = new MapController();

      // Don't initialize the map (map will be null)
      const buildingId = 'test-building-123';
      const lng = 116.460787;
      const lat = 39.905477;
      const rent = 150;

      (global.window as any).__colliers_analyzeCompetitors(buildingId, lng, lat, rent);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Action Module] Failed to analyze competitors',
        expect.any(Error)
      );

      // Verify user-friendly alert was shown
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('周边项目对比功能暂时不可用')
      );
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('请稍后再试或联系技术支持')
      );
    });

    it('should display user-friendly error message with invalid parameters', () => {
      new MapController();

      // Call with invalid parameters
      (global.window as any).__colliers_analyzeCompetitors('', 'invalid', null, undefined);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Action Module] Failed to analyze competitors',
        expect.any(Error)
      );

      // Verify user-friendly alert was shown
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('周边项目对比功能暂时不可用')
      );
    });

    it('should remove the global comparison bridge when controller is destroyed', () => {
      const controller = new MapController();

      expect(typeof (global.window as any).__colliers_analyzeCompetitors).toBe('function');

      controller.destroy();

      expect((global.window as any).__colliers_analyzeCompetitors).toBeUndefined();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('should successfully call analyzeCompetitors when all conditions are met', () => {
      const controller = new MapController();

      // Mock the analyzeCompetitors method
      const analyzeCompetitorsSpy = vi.fn();
      controller.analyzeCompetitors = analyzeCompetitorsSpy;

      // Mock map initialization
      (controller as any).map = { mock: 'map' };
      (controller as any).AMap = { mock: 'AMap' };

      const buildingId = 'test-building-123';
      const lng = 116.460787;
      const lat = 39.905477;
      const rent = 150;

      (global.window as any).__colliers_analyzeCompetitors(buildingId, lng, lat, rent);

      // Verify analyzeCompetitors was called
      expect(analyzeCompetitorsSpy).toHaveBeenCalledWith(buildingId, lng, lat, rent);

      // Verify no error alert was shown
      expect(alertSpy).not.toHaveBeenCalled();

      // Verify analytics logging occurred
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Action Module] 周边项目对比 clicked',
        expect.objectContaining({ buildingId, lng, lat, rent })
      );
    });
  });

  describe('Requirement 4.6: Active Module Click Triggers Functionality', () => {
    it('should trigger comparison functionality when 周边项目对比 is clicked', () => {
      const controller = new MapController();

      // Mock the analyzeCompetitors method
      const analyzeCompetitorsSpy = vi.fn();
      controller.analyzeCompetitors = analyzeCompetitorsSpy;

      // Mock map initialization
      (controller as any).map = { mock: 'map' };
      (controller as any).AMap = { mock: 'AMap' };

      const buildingId = 'test-building-123';
      const lng = 116.460787;
      const lat = 39.905477;
      const rent = 150;

      // Simulate clicking the active module
      (global.window as any).__colliers_analyzeCompetitors(buildingId, lng, lat, rent);

      // Verify the comparison functionality was triggered
      expect(analyzeCompetitorsSpy).toHaveBeenCalledTimes(1);
      expect(analyzeCompetitorsSpy).toHaveBeenCalledWith(buildingId, lng, lat, rent);
    });
  });

  describe('Requirement 4.7: Grayed Module Click Prevention', () => {
    it('should not have onclick handlers for grayed modules', () => {
      // Create a controller to set up the global function
      new MapController();
      
      // Verify that only the active module (周边项目对比) has a global function
      expect(typeof (global.window as any).__colliers_analyzeCompetitors).toBe('function');
      
      // Disabled modules should not register global functions.
      expect((global.window as any).__colliers_latestSales).toBeUndefined();
    });
  });
});
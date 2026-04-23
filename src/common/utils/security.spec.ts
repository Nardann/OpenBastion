import { safeCompare } from './security';

describe('Security Utils', () => {
  describe('safeCompare', () => {
    it('should return true for identical strings', () => {
      expect(safeCompare('hello', 'hello')).toBe(true);
      expect(safeCompare('', '')).toBe(true);
      expect(safeCompare('a'.repeat(200), 'a'.repeat(200))).toBe(true);
      expect(safeCompare('a'.repeat(300), 'a'.repeat(300))).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(safeCompare('hello', 'world')).toBe(false);
      expect(safeCompare('hello', 'hell')).toBe(false);
      expect(safeCompare('hell', 'hello')).toBe(false);
    });

    it('should be resistant to timing attacks (constant time logic)', () => {
      // This is a unit test, so we can't easily measure micro-timings,
      // but we verify the logic handles various lengths correctly.
      expect(safeCompare('short', 'a'.repeat(255))).toBe(false);
      expect(safeCompare('short', 'a'.repeat(300))).toBe(false);
    });
  });
});

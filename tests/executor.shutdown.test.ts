import executor, { __getScheduledTimeoutCount, __shutdownExecutorForTest } from '../src/services/executor';

describe('executor shutdown helpers', () => {
  afterEach(() => {
    try { executor.clearScheduledTimeouts && executor.clearScheduledTimeouts(); } catch (e) { /* ignore */ }
  });

  test('clearScheduledTimeouts empties registry and shutdown helper runs', () => {
    // We can't easily create a real scheduled timeout without plumbing into internal map,
    // but we can assert that calling clearScheduledTimeouts leaves the map at zero and
    // that the shutdown helper runs without throwing.

    // Ensure initial count is a number
    const before = __getScheduledTimeoutCount();
    expect(typeof before).toBe('number');

    // Call the exported clear function
    executor.clearScheduledTimeouts();
    const afterClear = __getScheduledTimeoutCount();
    expect(afterClear).toBe(0);

    // Call the shutdown helper for coverage and ensure no throw
    expect(() => __shutdownExecutorForTest()).not.toThrow();
  });
});

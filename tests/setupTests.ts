// Centralized, defensive test cleanup to avoid timer/database leaks between tests.
// This restores timers, clears mocks, cancels executor timeouts, and attempts to close the DB if it was opened.
import executor from '../src/services/executor';
import { closeDb } from '../src/plugins/db';

// Run after each test to revert mocking/timers and clear any scheduled timeouts
afterEach(() => {
  // restore any mocked timers/mocks
  try { jest.useRealTimers(); } catch (e) { /* ignore */ }
  try { jest.clearAllTimers(); } catch (e) { /* ignore */ }
  try { jest.restoreAllMocks(); } catch (e) { /* ignore */ }

  // clear executor scheduled timeouts (if the executor is present)
  try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }

  // NOTE: Do not close the shared DB between tests — closing it here can break later tests
  // that expect the DB to remain initialized for the app under test. We keep a best-effort
  // close in afterAll instead.
});

// Final global cleanup in case some handles were left open beyond a single test
afterAll(() => {
  try { jest.useRealTimers(); } catch (e) { /* ignore */ }
  try { (executor as any).clearScheduledTimeouts && (executor as any).clearScheduledTimeouts(); } catch (e) { /* ignore */ }
  try { closeDb && closeDb(); } catch (e) { /* ignore */ }
});

import { useEffect, useRef } from 'react';

/**
 * Authoritative cooldown window (4.5 seconds = 4500ms) to ignore rapid-fire
 * visibilitychange/blur/focus events from a single tab switch or app switch.
 */
export const TAB_SWITCH_COOLDOWN_MS = 4500;

/**
 * Maximum tab switches allowed across all quiz modes before terminal disqualification.
 */
export const MAX_TAB_SWITCH_ALLOWED = 4;

/**
 * Pure evaluation function for tab-switch throttling.
 * Returns whether the event should be ignored (throttled) and the updated timestamp.
 *
 * @param {number} lastSwitchTime - Timestamp of the last counted tab-switch (in ms)
 * @param {number} [cooldownMs=4500] - Cooldown duration in ms
 * @param {number} [now=Date.now()] - Current timestamp in ms
 * @returns {{ isThrottled: boolean, updatedTime: number }}
 */
export function checkTabSwitchThrottle(lastSwitchTime, cooldownMs = TAB_SWITCH_COOLDOWN_MS, now = Date.now()) {
  if (!lastSwitchTime) {
    return { isThrottled: false, updatedTime: now };
  }
  const elapsed = now - lastSwitchTime;
  if (elapsed < cooldownMs) {
    return { isThrottled: true, updatedTime: lastSwitchTime };
  }
  return { isThrottled: false, updatedTime: now };
}

/**
 * Shared custom hook for tab-switch & window blur monitoring across all quiz contexts:
 * - Live Quiz Room (Pre-loaded / Default Question Sets)
 * - Live Quiz Room (AI-Generated Question Sets)
 * - Self Practice (AI-Generated & Manual Question Sets)
 * - Mobile & Desktop browsers
 *
 * Enforces a strict 4.5-second debounce cooldown window to prevent rapid-fire false positives.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether monitoring is currently active
 * @param {Function} options.onViolation - Callback invoked when a genuine tab switch is detected
 * @param {number} [options.cooldownMs=4500] - Cooldown duration in ms
 */
export function useTabSwitchMonitor({
  enabled = true,
  onViolation,
  cooldownMs = TAB_SWITCH_COOLDOWN_MS,
}) {
  const lastSwitchTimeRef = useRef(0);
  const onViolationRef = useRef(onViolation);

  // Keep latest callback reference without triggering listener re-binding
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!enabled) return;

    const handleSwitchViolation = () => {
      const now = Date.now();
      const { isThrottled, updatedTime } = checkTabSwitchThrottle(lastSwitchTimeRef.current, cooldownMs, now);
      if (isThrottled) {
        // Within 4.5s cooldown: ignore duplicate events from the same tab-switch cycle
        return;
      }
      lastSwitchTimeRef.current = updatedTime;

      if (typeof onViolationRef.current === 'function') {
        onViolationRef.current();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleSwitchViolation();
      }
    };

    const handleWindowBlur = () => {
      handleSwitchViolation();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [enabled, cooldownMs]);
}

export default function AntiCheatModal({
  isOpen,
  count = 1,
  maxLimit = 10,
  isLimitReached = false,
  onAcknowledge,
  onTerminalProceed,
}) {
  if (!isOpen) return null;

  const remaining = Math.max(0, maxLimit - count);

  return (
    <div className="modal-backdrop anti-cheat-backdrop" role="alertdialog" aria-modal="true">
      <div className={`modal-content anti-cheat-modal ${isLimitReached ? 'limit-reached' : ''}`}>
        <div className="anti-cheat-icon" aria-hidden>
          {isLimitReached ? '🚨' : '⚠️'}
        </div>

        <h3 className="anti-cheat-title">
          {isLimitReached ? 'Test Terminated: Limit Exceeded' : 'Tab Switching Detected!'}
        </h3>

        <div className={`warning-counter-pill ${isLimitReached ? 'critical' : ''}`}>
          <span>Warning count:</span>
          <strong>{count}/{maxLimit}</strong>
        </div>

        <p className="anti-cheat-message">
          {isLimitReached ? (
            <>
              You have exceeded the maximum limit of <strong>{maxLimit} tab switches</strong>.
              Your quiz has been automatically submitted to maintain assessment integrity.
            </>
          ) : (
            <>
              Leaving the test window or switching browser tabs is strictly monitored.
              You have <strong>{remaining} warning{remaining === 1 ? '' : 's'}</strong> remaining
              before your quiz is automatically terminated and submitted.
            </>
          )}
        </p>

        <div className="anti-cheat-actions">
          {isLimitReached ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={onTerminalProceed}
            >
              View Results →
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={onAcknowledge}
            >
              I Understand — Return to Quiz
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

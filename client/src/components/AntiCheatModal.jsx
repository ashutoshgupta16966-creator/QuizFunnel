export default function AntiCheatModal({
  isOpen,
  count = 1,
  maxLimit = 4,
  isLimitReached = false,
  onAcknowledge,
  onTerminalProceed,
}) {
  if (!isOpen) return null;

  const displayCount = Math.min(count, maxLimit);
  const remaining = Math.max(0, maxLimit - displayCount);

  return (
    <div className="modal-backdrop anti-cheat-backdrop" role="alertdialog" aria-modal="true">
      <div className={`modal-content anti-cheat-modal ${isLimitReached ? 'limit-reached' : ''}`}>
        <div className="anti-cheat-icon" aria-hidden>
          {isLimitReached ? '🚨' : '⚠️'}
        </div>

        <h3 className="anti-cheat-title">
          {isLimitReached
            ? 'Violation: Tab-Switch Limit Exceeded (4/4)'
            : 'Tab Switching Detected!'}
        </h3>

        <div className={`warning-counter-pill ${isLimitReached ? 'critical' : ''}`}>
          <span>Warning count:</span>
          <strong>{displayCount}/{maxLimit}</strong>
        </div>

        <p className="anti-cheat-message">
          {isLimitReached ? (
            <>
              Your quiz attempt was terminated and locked due to exceeding the maximum allowed limit of <strong>{maxLimit} tab switches</strong>.
              All answers and performance scores for this session have been disqualified to uphold academic integrity.
            </>
          ) : (
            <>
              Leaving the test window or switching browser tabs is strictly monitored.
              You have <strong>{remaining} warning{remaining === 1 ? '' : 's'}</strong> remaining.
              The <strong>{maxLimit}th switch</strong> will automatically
              disqualify you from this quiz.
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

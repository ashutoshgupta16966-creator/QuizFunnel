export default function AntiCheatModal({
  isOpen,
  count = 1,
  maxLimit = 4,
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
          {isLimitReached
            ? `Violation: Tab-Switch Limit Exceeded (${maxLimit}/${maxLimit})`
            : 'Tab Switching Detected!'}
        </h3>

        <div className={`warning-counter-pill ${isLimitReached ? 'critical' : ''}`}>
          <span>Warning count:</span>
          <strong>{count}/{maxLimit}</strong>
        </div>

        <p className="anti-cheat-message">
          {isLimitReached ? (
            <>
              You have been <strong>automatically disqualified</strong> for exceeding the maximum
              allowed tab switches (<strong>{maxLimit}/{maxLimit}</strong>). Your quiz session has
              been terminated and submitted to maintain assessment integrity. Contact your host if
              you believe this was a mistake.
            </>
          ) : (
            <>
              Leaving the test window or switching browser tabs is strictly monitored.
              You have <strong>{remaining} warning{remaining === 1 ? '' : 's'}</strong> remaining.
              The <strong>{maxLimit}{maxLimit === 4 ? 'th' : 'th'} switch</strong> will automatically
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

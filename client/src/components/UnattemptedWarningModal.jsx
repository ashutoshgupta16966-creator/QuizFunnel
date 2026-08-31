export default function UnattemptedWarningModal({
  isOpen,
  unattemptedCount,
  level,
  onGoBack,
  onSubmitAnyway,
  submitting = false,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop unattempted-modal-backdrop"
      onClick={onGoBack}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="modal-content unattempted-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="unattempted-modal-icon" role="img" aria-label="Warning">
          ⚠️
        </div>

        <h3 className="unattempted-modal-title">
          Unanswered Questions Remaining
        </h3>

        <div className="unattempted-count-pill">
          <span>Unattempted:</span>
          <strong>
            {unattemptedCount} Question{unattemptedCount === 1 ? '' : 's'}
          </strong>
        </div>

        <p className="unattempted-modal-body">
          You have{' '}
          <strong className="text-highlight">
            {unattemptedCount} unattempted question{unattemptedCount === 1 ? '' : 's'}
          </strong>{' '}
          left in <strong>Level {level}</strong>. Would you like to go back and attempt{' '}
          {unattemptedCount === 1 ? 'it' : 'them'} before submitting?
        </p>

        <div className="unattempted-modal-actions">
          <button
            type="button"
            className="btn btn-primary btn-review"
            onClick={onGoBack}
            disabled={submitting}
          >
            ← Go Back &amp; Review
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-submit-anyway"
            onClick={onSubmitAnyway}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="btn-spinner" /> Submitting…
              </>
            ) : (
              'Submit Anyway →'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

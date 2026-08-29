export default function ExitConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-content exit-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="exit-icon" role="img" aria-label="Warning">⚠️</div>
        <h3 className="exit-title">Are you sure you want to exit this quiz?</h3>
        <p className="exit-subtitle">
          If you exit now, your current quiz attempt progress will be discarded and you will return to the home screen.
        </p>

        <div className="exit-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel / Stay
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Yes, Exit
          </button>
        </div>
      </div>
    </div>
  );
}

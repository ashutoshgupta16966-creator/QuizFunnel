export default function DuplicateConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-content exit-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="exit-icon" role="img" aria-label="Notice">ℹ️</div>
        <h3 className="exit-title">Attempt Notice</h3>
        <p className="exit-subtitle">
          You have already attempted this quiz with this number. Do you want to continue anyway?
        </p>

        <div className="exit-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

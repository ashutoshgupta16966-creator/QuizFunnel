export default function ExitConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title = "Are you sure you want to exit this quiz?",
  subtitle = "If you exit now, your current quiz attempt progress will be discarded and you will return to the home screen.",
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-content exit-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="exit-icon" role="img" aria-label="Warning">⚠️</div>
        <h3 className="exit-title">{title}</h3>
        <p className="exit-subtitle">{subtitle}</p>

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

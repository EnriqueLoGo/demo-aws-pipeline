export default function ConfirmDialog({ open, message, onConfirm, onCancel }) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button className="modal-btn-confirm" onClick={onConfirm}>
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
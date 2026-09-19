import { useState, useEffect, useRef } from "react"

/**
 * Modal para editar un producto de la lista maestra.
 * Se abre con press largo (~500ms) sobre la tarjeta.
 */
export default function EditDialog({ open, item, onSave, onCancel }) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState("General")
  const [type, setType] = useState("WHEN_MISSING")
  const nameRef = useRef(null)

  // Precarga los valores actuales del producto al abrir
  useEffect(() => {
    if (open && item) {
      setName(item.name)
      setCategory(item.category || "General")
      setType(item.type || "WHEN_MISSING")
      setTimeout(() => nameRef.current?.focus(), 80)
    }
  }, [open, item])

  if (!open || !item) return null

  function handleSave() {
    if (!name.trim()) return
    onSave(item.id, name.trim(), type, category || "General")
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") onCancel()
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Editar producto">
      <div className="modal-box edit-dialog-box">
        <p className="modal-message">Editar producto</p>

        <div className="edit-dialog-fields">
          <label className="edit-dialog-label" htmlFor="edit-name">Nombre</label>
          <input
            ref={nameRef}
            id="edit-name"
            className="edit-dialog-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nombre del producto"
          />

          <label className="edit-dialog-label" htmlFor="edit-category">Categoría</label>
          <input
            id="edit-category"
            className="edit-dialog-input"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="General"
          />

          <label className="edit-dialog-label" htmlFor="edit-type">Tipo</label>
          <select
            id="edit-type"
            className="edit-dialog-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="WHEN_MISSING">Cuando falte</option>
            <option value="FIXED">Fijo (siempre en lista)</option>
          </select>
        </div>

        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="modal-btn-confirm"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

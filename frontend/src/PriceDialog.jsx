import { useState, useEffect, useRef } from "react"

/**
 * Dialog para capturar el precio de etiqueta de un producto.
 * El subtotal se calcula en tiempo real: precio × quantity.
 */
export default function PriceDialog({ open, item, currentPrice, onSave, onCancel }) {
  const [value, setValue] = useState("")
  const inputRef = useRef(null)

  // Al abrir, precarga el precio existente si ya tenía uno
  useEffect(() => {
    if (open) {
      setValue(currentPrice != null ? String(currentPrice) : "")
      // Pequeño delay para que el DOM esté listo antes de enfocar
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open, currentPrice])

  if (!open || !item) return null

  const qty = Number(item.quantity) || 1
  const parsed = parseFloat(value.replace(",", "."))
  const subtotal = !isNaN(parsed) && parsed > 0 ? parsed * qty : null

  function handleSave() {
    const price = parseFloat(value.replace(",", "."))
    if (!isNaN(price) && price > 0) onSave(item.id, price)
    else onCancel()
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") onCancel()
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Ingresar precio">
      <div className="modal-box price-dialog-box">
        <p className="modal-message">
          <strong>{item.name}</strong>
          {qty > 1 && <span className="price-dialog-qty"> × {qty}</span>}
        </p>

        <label className="price-dialog-label" htmlFor="price-input">
          Precio en etiqueta
        </label>
        <div className="price-dialog-input-row">
          <span className="price-dialog-currency">$</span>
          <input
            ref={inputRef}
            id="price-input"
            className="price-dialog-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {subtotal != null && (
          <p className="price-dialog-subtotal">
            Subtotal estimado: <strong>${subtotal.toFixed(2)}</strong>
            {qty > 1 && <span className="price-dialog-qty-note"> ({qty} × ${parsed.toFixed(2)})</span>}
          </p>
        )}

        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="modal-btn-confirm price-dialog-save"
            onClick={handleSave}
            disabled={isNaN(parsed) || parsed <= 0}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

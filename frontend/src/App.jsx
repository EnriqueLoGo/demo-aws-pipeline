import { useEffect, useState, useCallback, useRef } from "react"
import {
  getMasterList,
  getShoppingList,
  createProduct,
  updateProduct,
  deleteProduct,
  markNeeded,
  markBought,
} from "./api"
import "./App.css"
import ConfirmDialog from "./ConfirmDialog"

const TABS = {
  SHOPPING: "shopping",
  MASTER: "master",
}

const SWIPE_THRESHOLD = 96

function ShoppingItem({ item, onBought }) {
  const [swipeStart, setSwipeStart] = useState(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setSwipeStart({ x: event.clientX, y: event.clientY })
    setSwipeOffset(0)
    setIsSwiping(false)
  }

  function handlePointerMove(event) {
    if (!swipeStart) return

    const deltaX = event.clientX - swipeStart.x
    const deltaY = event.clientY - swipeStart.y

    if (!isSwiping && Math.abs(deltaY) > Math.abs(deltaX)) {
      setSwipeStart(null)
      setSwipeOffset(0)
      return
    }

    if (deltaX <= 0) {
      setSwipeOffset(0)
      return
    }

    setIsSwiping(true)
    setSwipeOffset(Math.min(deltaX, SWIPE_THRESHOLD + 24))
  }

  function finishSwipe(event) {
    if (!swipeStart) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (swipeOffset >= SWIPE_THRESHOLD) onBought(item.id)
    setSwipeStart(null)
    setSwipeOffset(0)
    setIsSwiping(false)
  }

  function cancelSwipe() {
    setSwipeStart(null)
    setSwipeOffset(0)
    setIsSwiping(false)
  }

  return (
    <li
      className={`product-item shopping-item${isSwiping ? " is-swiping" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={cancelSwipe}
      style={{ "--swipe-offset": `${swipeOffset}px` }}
    >
      <span className="swipe-confirmation" aria-hidden="true">
        ✓ Comprado
      </span>
      <span className="product-name">
        {item.name}
        <small>
          {" "}
          · {item.category || "General"} · {item.quantity || 1}
        </small>
      </span>
      <button
        className="btn-bought"
        aria-label={`Marcar ${item.name} como comprado`}
        title="Marcar como comprado"
        onClick={() => onBought(item.id)}
      >
        ✓
      </button>
    </li>
  )
}

function playProductAddedSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null

  const audioContext = new AudioContext()
  audioContext.resume()

  return () => {
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const startTime = audioContext.currentTime

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(660, startTime)
    oscillator.frequency.setValueAtTime(880, startTime + 0.1)
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22)

    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + 0.22)
    oscillator.addEventListener("ended", () => audioContext.close())
  }
}

function MasterItem({ item, onEdit, onDelete, onNeed }) {
  const [swipeStart, setSwipeStart] = useState(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  // "right" = eliminar, "left" = agregar a lista
  const [swipeDir, setSwipeDir] = useState(null)

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setSwipeStart({ x: event.clientX, y: event.clientY })
    setSwipeOffset(0)
    setIsSwiping(false)
    setSwipeDir(null)
  }

  function handlePointerMove(event) {
    if (!swipeStart) return

    const deltaX = event.clientX - swipeStart.x
    const deltaY = event.clientY - swipeStart.y

    // Si el gesto es más vertical que horizontal, lo ignoramos (scroll normal)
    if (!isSwiping && Math.abs(deltaY) > Math.abs(deltaX)) {
      setSwipeStart(null)
      setSwipeOffset(0)
      setSwipeDir(null)
      return
    }

    // Izquierda solo si el producto no está ya en la lista
    if (deltaX < 0 && item.needed) {
      setSwipeOffset(0)
      return
    }

    const dir = deltaX >= 0 ? "right" : "left"
    setSwipeDir(dir)
    setIsSwiping(true)
    setSwipeOffset(
      deltaX >= 0
        ? Math.min(deltaX, SWIPE_THRESHOLD + 24)
        : Math.max(deltaX, -(SWIPE_THRESHOLD + 24))
    )
  }

  function finishSwipe(event) {
    if (!swipeStart) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (swipeOffset >= SWIPE_THRESHOLD) onDelete(item.id)
    else if (swipeOffset <= -SWIPE_THRESHOLD) onNeed(item.id)

    setSwipeStart(null)
    setSwipeOffset(0)
    setIsSwiping(false)
    setSwipeDir(null)
  }

  function cancelSwipe() {
    setSwipeStart(null)
    setSwipeOffset(0)
    setIsSwiping(false)
    setSwipeDir(null)
  }

  const isSwipingRight = isSwiping && swipeDir === "right"
  const isSwipingLeft  = isSwiping && swipeDir === "left"

  return (
    <li
      className={`product-item master-item master-swipe-item${isSwipingRight ? " is-swiping-delete" : ""}${isSwipingLeft ? " is-swiping-need" : ""}`}
      onDoubleClick={() => onEdit(item)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={cancelSwipe}
      style={{ "--swipe-offset": `${swipeOffset}px` }}
      title="Doble toque para editar · → eliminar · ← agregar a lista"
    >
      {/* Fondo rojo — eliminar (derecha) */}
      <span className="master-delete-hint" aria-hidden="true">
        🗑 Eliminar
      </span>
      {/* Fondo verde — agregar a lista (izquierda) */}
      {!item.needed && (
        <span className="master-need-hint" aria-hidden="true">
          ✓ A la lista
        </span>
      )}
      <span
        className="product-name"
        style={{ transform: "translateX(var(--swipe-offset, 0px))", transition: isSwiping ? "none" : "transform 160ms ease" }}
      >
        {item.name}
        <small> · {item.category || "General"} · {item.quantity || 1}</small>
        {item.type === "FIXED" && <span className="badge">FIJO</span>}
      </span>
      <div
        className="item-actions"
        style={{ transform: "translateX(var(--swipe-offset, 0px))", transition: isSwiping ? "none" : "transform 160ms ease" }}
      >
        {item.needed && <span className="hint-inline">✓ En lista</span>}
      </div>
    </li>
  )
}

export default function App() {
  const [tab, setTab] = useState(TABS.SHOPPING)
  const [shoppingList, setShoppingList] = useState([])
  const [masterList, setMasterList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState("WHEN_MISSING")
  const [newCategory, setNewCategory] = useState("General")
  const [newQuantity, setNewQuantity] = useState(1)
  const [search, setSearch] = useState("")
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editName, setEditName] = useState("")
  const [editType, setEditType] = useState("WHEN_MISSING")
  const [editCategory, setEditCategory] = useState("General")
  const [editQuantity, setEditQuantity] = useState(1)
  const [categoryFilter, setCategoryFilter] = useState("ALL")

  // Estado para el "Deshacer" después de marcar como comprado
  const [pendingBought, setPendingBought] = useState(null)
  // { item: {...}, timer: timeoutId }
  const pendingBoughtRef = useRef(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [shopping, master] = await Promise.all([
        getShoppingList(),
        getMasterList(),
      ])
      setShoppingList(shopping)
      setMasterList(master)
    } catch (err) {
      setError(err.message || "No se pudo conectar con el servidor.")
    } finally {
      setLoading(false)
    }
  }, [])

  // Confirma la operación pendiente (llama a la API)
  // Declarada después de loadAll para que pueda referenciarla correctamente
  const flushPendingBought = useCallback(async (itemId) => {
    try {
      await markBought(itemId)
    } catch (err) {
      setError(err.message)
      loadAll()
    }
  }, [loadAll])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const categoryOptions = [
  "ALL",
  ...new Set(
    masterList
      .map((item) => (item.category || "General").trim())
      .filter(Boolean)
  ),
]
const filteredShoppingList = shoppingList.filter((item) => {
  const matchesName = item.name.toLowerCase().includes(search.toLowerCase())
  const matchesCategory =
    categoryFilter === "ALL" || (item.category || "General") === categoryFilter
  return matchesName && matchesCategory
})

const filteredMasterList = masterList.filter((item) => {
  const matchesName = item.name.toLowerCase().includes(search.toLowerCase())
  const matchesCategory =
    categoryFilter === "ALL" || (item.category || "General") === categoryFilter
  return matchesName && matchesCategory
})

const totalNeeded = shoppingList.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)

  function handleBought(id) {
    // Si ya había un pendiente, lo confirmamos de inmediato antes de crear el nuevo
    if (pendingBoughtRef.current) {
      clearTimeout(pendingBoughtRef.current.timer)
      flushPendingBought(pendingBoughtRef.current.item.id)
      pendingBoughtRef.current = null
    }

    const item = shoppingList.find((p) => p.id === id)
    if (!item) return

    // Quitamos el ítem de la lista visualmente
    setShoppingList((prev) => prev.filter((p) => p.id !== id))

    // Creamos el timer de 5 segundos
    const timer = setTimeout(() => {
      setPendingBought(null)
      pendingBoughtRef.current = null
      flushPendingBought(id)
    }, 5000)

    const pending = { item, timer }
    pendingBoughtRef.current = pending
    setPendingBought(pending)
  }

  function handleUndoBought() {
    if (!pendingBoughtRef.current) return
    clearTimeout(pendingBoughtRef.current.timer)
    const { item } = pendingBoughtRef.current
    // Devolvemos el ítem a la lista
    setShoppingList((prev) => [...prev, item])
    setPendingBought(null)
    pendingBoughtRef.current = null
  }

  async function handleNeed(id) {
    const playSound = playProductAddedSound()
    try {
      await markNeeded(id)
      playSound?.()
      loadAll()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddProduct(event) {
    event.preventDefault()
    if (!newName.trim()) return
    try {
      await createProduct(newName.trim(), newType, newCategory, Number(newQuantity) || 1)
      setNewName("")
      setNewCategory("General")
      setNewQuantity(1)
      setNewType("WHEN_MISSING")
      loadAll()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditName(item.name)
    setEditType(item.type)
    setEditCategory(item.category || "General")
    setEditQuantity(item.quantity || 1)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleSaveEdit(event, id) {
    event.preventDefault()
    if (!editName.trim()) return
    try {
      await updateProduct(
        id,
        editName.trim(),
        editType,
        editCategory || "General",
        Number(editQuantity) || 1
      )
      setEditingId(null)
      loadAll()
    } catch (err) {
      setError(err.message)
    }
  }

  function askDelete(id) {
    setConfirmDeleteId(id)
  }

  async function confirmDelete() {
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    try {
      await deleteProduct(id)
      loadAll()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🛒 Lista de Mandado</h1>
      </header>

      {error && <div className="banner-error">{error}</div>}

      <nav className="tabs">
        <button
          className={tab === TABS.SHOPPING ? "tab active" : "tab"}
          onClick={() => setTab(TABS.SHOPPING)}
        >
          Por comprar ({filteredShoppingList.length})
        </button>
        <button
          className={tab === TABS.MASTER ? "tab active" : "tab"}
          onClick={() => setTab(TABS.MASTER)}
        >
          Lista maestra
        </button>
      </nav>

      <div className="toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="ALL">Todas las categorías</option>
          {categoryOptions
            .filter((category) => category !== "ALL")
            .map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
        </select>
      </div>

      <div className="summary-box">
        <strong>Total por comprar:</strong> {totalNeeded} unidades
      </div>

      <main className="content">
        {loading && <p className="hint">Cargando...</p>}

        {!loading && tab === TABS.SHOPPING && (
          <ul className="product-list">
            {filteredShoppingList.length === 0 && (
              <li className="hint">No hay productos pendientes 🎉</li>
            )}
            {filteredShoppingList.map((item) => (
              <ShoppingItem key={item.id} item={item} onBought={handleBought} />
            ))}
          </ul>
        )}

        {!loading && tab === TABS.MASTER && (
          <>
            <form className="add-form" onSubmit={handleAddProduct}>
              <input
                type="text"
                placeholder="Nuevo producto"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />

              <input
                type="text"
                placeholder="Categoría"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />

              <input
                type="number"
                min="1"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                style={{ width: 80 }}
              />

              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="WHEN_MISSING">Cuando falte</option>
                <option value="FIXED">Fijo (siempre)</option>
              </select>

              <button type="submit">Agregar</button>
            </form>

            <ul className="product-list">
              {filteredMasterList.map((item) =>
                editingId === item.id ? (
                  <li key={item.id} className="product-item edit-row">
                    <form className="add-form" onSubmit={(e) => handleSaveEdit(e, item.id)}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />

                      <input
                        type="text"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                      />

                      <input
                        type="number"
                        min="1"
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                        style={{ width: 80 }}
                      />

                      <select value={editType} onChange={(e) => setEditType(e.target.value)}>
                        <option value="WHEN_MISSING">Cuando falte</option>
                        <option value="FIXED">Fijo (siempre)</option>
                      </select>

                      <button type="submit">Guardar</button>
                      <button type="button" onClick={cancelEdit}>Cancelar</button>
                    </form>
                  </li>
                ) : (
                  <MasterItem
                    key={item.id}
                    item={item}
                    onEdit={startEdit}
                    onDelete={askDelete}
                    onNeed={handleNeed}
                  />
                )
              )}
            </ul>
          </>
        )}
      </main>

      {pendingBought && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>✓ {pendingBought.item.name} marcado como comprado</span>
          <button className="btn-undo" onClick={handleUndoBought}>
            Deshacer
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        message="¿Eliminar este producto de la lista maestra?"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
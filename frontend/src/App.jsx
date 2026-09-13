import { useEffect, useState, useCallback } from "react"
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

  async function handleBought(id) {
    setShoppingList((prev) => prev.filter((item) => item.id !== id))
    try {
      await markBought(id)
    } catch (err) {
      setError(err.message)
      loadAll()
    }
  }

  async function handleNeed(id) {
    try {
      await markNeeded(id)
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
              <li key={item.id} className="product-item">
                <span className="product-name">
                  {item.name}
                  <small>
                    {" "}
                    · {item.category || "General"} · {item.quantity || 1}
                  </small>
                </span>
                <button
                  className="btn-bought"
                  onClick={() => handleBought(item.id)}
                >
                  ✔ Comprado
                </button>
              </li>
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
                  <li key={item.id} className="product-item">
                    <span className="product-name">
                      {item.name}
                      <small>
                        {" "}
                        · {item.category || "General"} · {item.quantity || 1}
                      </small>
                      {item.type === "FIXED" && <span className="badge">FIJO</span>}
                    </span>

                    <div className="item-actions">
                      {!item.needed && (
                        <button
                          className="btn-need"
                          onClick={() => handleNeed(item.id)}
                        >
                          + A la lista
                        </button>
                      )}
                      {item.needed && <span className="hint">En la lista</span>}
                      <button className="btn-edit" onClick={() => startEdit(item)}>✎</button>
                      <button className="btn-delete" onClick={() => askDelete(item.id)}>🗑️</button>
                    </div>
                  </li>
                )
              )}
            </ul>
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        message="¿Eliminar este producto de la lista maestra?"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
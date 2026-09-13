import { useEffect, useState, useCallback } from "react"
import {
  getMasterList,
  getShoppingList,
  createProduct,
  markNeeded,
  markBought,
} from "./api"
import "./App.css"

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

  async function handleBought(id) {
    // Actualización optimista: lo quitamos de la vista antes de confirmar con el servidor.
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
      await createProduct(newName.trim(), newType)
      setNewName("")
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
          Por comprar ({shoppingList.length})
        </button>
        <button
          className={tab === TABS.MASTER ? "tab active" : "tab"}
          onClick={() => setTab(TABS.MASTER)}
        >
          Lista maestra
        </button>
      </nav>

      <main className="content">
        {loading && <p className="hint">Cargando...</p>}

        {!loading && tab === TABS.SHOPPING && (
          <ul className="product-list">
            {shoppingList.length === 0 && (
              <li className="hint">No hay productos pendientes 🎉</li>
            )}
            {shoppingList.map((item) => (
              <li key={item.id} className="product-item">
                <span className="product-name">{item.name}</span>
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
              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="WHEN_MISSING">Cuando falte</option>
                <option value="FIXED">Fijo (siempre)</option>
              </select>
              <button type="submit">Agregar</button>
            </form>

            <ul className="product-list">
              {masterList.map((item) => (
                <li key={item.id} className="product-item">
                  <span className="product-name">
                    {item.name}
                    {item.type === "FIXED" && <span className="badge">FIJO</span>}
                  </span>
                  {!item.needed && (
                    <button
                      className="btn-need"
                      onClick={() => handleNeed(item.id)}
                    >
                      + A la lista
                    </button>
                  )}
                  {item.needed && <span className="hint">En la lista</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}

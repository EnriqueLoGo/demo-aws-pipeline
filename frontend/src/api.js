// Base de la API se inyecta en build time vía la variable de entorno VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL || ""

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `Error ${res.status} al llamar ${path}`)
  }
  return res.status === 204 ? null : res.json()
}

export function getMasterList() {
  return request("/master")
}

export function getShoppingList() {
  return request("/shopping")
}

export function createProduct(name, type) {
  return request("/products", {
    method: "POST",
    body: JSON.stringify({ name, type }),
  })
}

export function markNeeded(id) {
  return request(`/products/${id}/need`, { method: "POST" })
}

export function markBought(id) {
  return request(`/products/${id}/bought`, { method: "POST" })
}

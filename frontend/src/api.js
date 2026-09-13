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
  return request("/master").then((data) => data.products)
}

export function getShoppingList() {
  return request("/shopping").then((data) => data.products)
}

export function createProduct(name, type, category = "General", quantity = 1) {
  return request("/products", {
    method: "POST",
    body: JSON.stringify({ name, type, category, quantity }),
  }).then((data) => data.product)
}

export function updateProduct(id, name, type, category = "General", quantity = 1) {
  return request(`/products/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, type, category, quantity }),
  }).then((data) => data.product)
}

export function deleteProduct(id) {
  return request(`/products/${id}`, { method: "DELETE" })
}

export function markNeeded(id) {
  return request(`/products/${id}/need`, { method: "POST" }).then((data) => data.product)
}

export function markBought(id) {
  return request(`/products/${id}/bought`, { method: "POST" }).then((data) => data.product)
}
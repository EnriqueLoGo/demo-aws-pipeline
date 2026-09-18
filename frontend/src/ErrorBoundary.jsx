import { Component } from "react"

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: "" }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Error inesperado" }
  }

  componentDidCatch(error, info) {
    // En producción se podría enviar a un servicio de logging aquí
    console.error("ErrorBoundary capturó:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
          background: "#f6f8f6",
          textAlign: "center",
          gap: "16px",
        }}>
          <span style={{ fontSize: 48 }}>😕</span>
          <h2 style={{ margin: 0, color: "#333" }}>Algo salió mal</h2>
          <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
            {this.state.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#1b6e3c",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "12px 24px",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "8px",
            }}
          >
            Reintentar
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

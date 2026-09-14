# Demo AWS + GitHub Pipeline
Mi primer proyecto conectado con AWS nativo y CI/CD

## Documentación del proyecto

La documentación de continuidad, arquitectura, endpoints, infraestructura, pipeline, incidentes
resueltos y cambios recientes se mantiene en [PROJECT_STATUS.md](PROJECT_STATUS.md).

El último cambio documentado corresponde a la mejora de responsividad móvil del frontend:

- El formulario de alta de productos ahora se apila correctamente en pantallas pequeñas.
- La búsqueda y el filtro de categorías ocupan el ancho disponible.
- En la vista "Por comprar", los nombres largos se ajustan sin empujar el botón "Comprado"
	debajo de la tarjeta.
- En "Lista maestra", las acciones de cada producto permanecen alineadas junto al contenido
	y las tarjetas ya no crecen innecesariamente en el celular.
- Al agregar un producto desde "Lista maestra" a "Por comprar", se reproduce un tono corto de
	confirmación. Crear un producto nuevo en la lista maestra no reproduce sonido.
- La compilación de producción fue validada con `npm run build`.

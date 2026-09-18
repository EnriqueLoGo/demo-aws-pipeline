# Pantry API + Lista de Mandado — Documento de continuidad del proyecto

> Este documento existe para que cualquier persona (o cualquier IA) pueda retomar el proyecto
> sin necesidad de reconstruir el contexto desde cero. Se actualiza conforme avanza el proyecto.
>
> Última actualización: 2026-09-17 (sesión 3)

---

## 1. Visión del producto

App tipo "lista de supermercado inteligente" para uso doméstico/familiar. Permite:
- Mantener una **lista maestra** de productos que se compran habitualmente.
- Marcar productos como **"necesarios"** cuando se agotan, pasando a una **lista de compras**.
- Marcar productos como **comprados** mientras se recorre el supermercado (pensado para uso
  desde el celular, en los pasillos, con botones grandes tipo PWA instalable).
- Productos **FIJOS** (ej. leche, pan) siempre aparecen en la lista de compras; productos
  **CUANDO FALTE** solo aparecen cuando se marcan explícitamente como necesarios.

## 2. Arquitectura

```
┌─────────────┐     HTTPS      ┌──────────────────┐      ┌───────────────┐
│  PWA React   │ ───────────▶  │  API Gateway      │ ───▶ │  AWS Lambda    │
│  (S3+CF)     │ ◀───────────  │  (HttpApi)        │ ◀─── │  function_     │
└─────────────┘                └──────────────────┘      │  lambda.py     │
                                                            └───────┬───────┘
                                                                    │
                                                            ┌───────▼───────┐
                                                            │  DynamoDB      │
                                                            │  pantry-{env}- │
                                                            │  products      │
                                                            └───────────────┘
```

- **Backend**: AWS Lambda (Python 3.12) + API Gateway (HttpApi) + DynamoDB. Definido como
  Infraestructura como Código en [template.yaml](template.yaml) (AWS SAM).
- **Frontend**: React + Vite, PWA instalable (offline-ready vía `vite-plugin-pwa`), en la
  carpeta [frontend/](frontend/). Hosteado en S3 (bucket privado) + CloudFront (con Origin
  Access Control, sin exponer el bucket públicamente).
- **CI/CD**: GitHub Actions ([.github/workflows/aws-demo.yml](.github/workflows/aws-demo.yml)),
  autenticación sin llaves fijas vía **OIDC** (OpenID Connect), 3 ambientes desplegados
  automáticamente: `dev`, `staging`, `prod` (mapeados a las ramas del mismo nombre, `prod`
  se activa desde `main`).

## 3. Endpoints de la API (backend)

Todos definidos en [function_lambda.py](function_lambda.py), enrutados manualmente dentro de
`lambda_handler` (no usa un framework de rutas, es un router simple por método+path).

| Método | Ruta | Función | Notas |
|---|---|---|---|
| GET | `/master` | Lista completa de productos | Responde `{ "products": [...] }` |
| GET | `/shopping` | Productos FIJOS o marcados como `needed` | Responde `{ "products": [...] }` |
| POST | `/products` | Crear producto (`name`, `type`) | Responde `{ "product": {...} }`, status 201 |
| PUT | `/products/{id}` | Editar nombre/tipo de un producto | Responde `{ "product": {...} }` |
| DELETE | `/products/{id}` | Eliminar un producto | Responde 204 |
| POST | `/products/{id}/need` | Marcar producto como necesario (pasa a "por comprar") | |
| POST | `/products/{id}/bought` | Marcar como comprado (los `WHEN_MISSING` salen de la lista, los `FIXED` permanecen) | |
| OPTIONS | cualquiera | Preflight CORS | Manejado vía ruta catch-all `/{proxy+}` |

**⚠️ Importante para cualquier cliente/frontend**: las respuestas del backend SIEMPRE vienen
envueltas en un objeto (`{"products": [...]}` o `{"product": {...}}`), nunca como array/objeto
plano directo. Esto causó un bug real (ver sección 6, "Incidentes resueltos").

### Modelo de datos (tabla DynamoDB `pantry-{env}-products`)
```json
{
  "id": "uuid",
  "name": "string",
  "type": "FIXED | WHEN_MISSING",
  "needed": true | false,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## 4. Infraestructura AWS (IaC)

Todo lo desplegable automáticamente vive en [template.yaml](template.yaml):
- `PantryTable` (DynamoDB, PAY_PER_REQUEST)
- `PantryApi` (API Gateway HttpApi)
- `PantryFunction` (Lambda)
- `FrontendBucket` (S3 privado)
- `FrontendOAC` + `FrontendDistribution` (CloudFront con Origin Access Control)
- `FrontendBucketPolicy` (solo permite acceso desde CloudFront)

Parametrizado por `Environment` (dev/staging/prod), cada uno crea un stack independiente
(`pantry-dev`, `pantry-staging`, `pantry-prod`) vía `sam deploy --config-env <env>`
([samconfig.toml](samconfig.toml)).

### Lo que NO está en IaC (gestionado manualmente en la consola AWS)
- El **proveedor OIDC** de GitHub (`token.actions.githubusercontent.com`) — es compartido con
  otros proyectos de la misma cuenta AWS, por lo que deliberadamente no se gestiona desde este
  repo (evita que borrar este stack rompa otros pipelines).
- El **rol IAM `GitHubActionsOIDCRole`** que asume GitHub Actions — se creó manualmente en
  consola. Existe una plantilla de referencia en [iam/github-actions-role.yaml](iam/github-actions-role.yaml)
  por si se necesita recrear desde cero, pero **no está desplegada como stack** (se dejó como
  documentación/referencia a propósito, para no arriesgar el rol que ya funciona).
- El archivo [trust-policy.json](trust-policy.json) en la raíz es también solo de referencia,
  reflejando lo que está aplicado manualmente en el rol.

## 5. Pipeline CI/CD

Archivo: [.github/workflows/aws-demo.yml](.github/workflows/aws-demo.yml)

Se dispara en push a `dev`, `staging`, `main` (main = ambiente `prod`). Pasos:
1. Checkout, setup Python 3.12, instalar SAM CLI.
2. Autenticación AWS vía OIDC (`aws-actions/configure-aws-credentials@v4`, rol
   `GitHubActionsOIDCRole`).
3. `sam validate` + `sam build` + `sam deploy --config-env $DEPLOY_ENV`.
4. Lee los Outputs del stack recién desplegado (`ApiUrl`, `FrontendBucketName`,
   `FrontendDistributionId`).
5. Instala dependencias del frontend, lo construye con `VITE_API_URL` inyectada desde el
   Output real del stack.
6. Sube el build (`frontend/dist`) a S3 (`aws s3 sync --delete`).
7. Invalida la caché de CloudFront (`aws cloudfront create-invalidation --paths "/*"`).

## 6. Incidentes resueltos (bitácora)

### 6.1 OIDC: `Not authorized to perform sts:AssumeRoleWithWebIdentity`
- **Síntoma**: el pipeline nunca lograba autenticarse contra AWS, pese a que el trust policy
  del rol "se veía bien" (probamos con environments específicos, luego con wildcard `*`, sin
  éxito en ningún caso).
- **Causa raíz real**: GitHub agrega **IDs inmutables** al claim `sub` del token OIDC
  (formato `repo:OWNER@orgId/REPO@repoId:environment:NAME` en vez del clásico
  `repo:OWNER/REPO:environment:NAME`). Es una función de seguridad de GitHub para prevenir
  ataques de "repo-jacking" (alguien renombra/transfiere un repo para heredar sus permisos).
- **Cómo se descubrió**: ni el mensaje de error de GitHub Actions ni de AWS mostraban el
  detalle. Se encontró revisando **CloudTrail → Event history**, evento
  `AssumeRoleWithWebIdentity`, campo `userIdentity.principalId`, que mostraba el `sub` real.
- **Solución**: actualizar el trust policy del rol para incluir los IDs inmutables exactos:
  `repo:EnriqueLoGo@217252427/demo-aws-pipeline@1367686115:environment:{dev|staging|prod}`.
- **Lección**: cuando `AssumeRoleWithWebIdentity` falla pese a que todo "se ve bien",
  CloudTrail Event history es la fuente de verdad para ver el claim real enviado.

### 6.2 GitHub Actions dejó de disparar workflows silenciosamente
- **Síntoma**: pushes a `dev` no generaban ningún run nuevo en la pestaña Actions (ni
  siquiera fallido) — como si el evento no existiera.
- **Causa raíz**: se agotaron los minutos incluidos de GitHub Actions (el repo era privado,
  plan gratuito ~2000 min/mes).
- **Solución**: se hizo el repositorio **público** (Settings → Danger Zone → Change
  visibility). Los repos públicos tienen minutos ilimitados en runners estándar. Nota: los
  commits vacíos (`git commit --allow-empty`) no dispararon un run nuevo tampoco — hubo que
  hacer un commit con cambio de contenido real para confirmar que ya funcionaba.
- **Lección**: si Actions deja de correr sin ningún error visible, revisar
  Settings → Billing → Actions (o el account-level billing) antes que el propio workflow.

### 6.3 Frontend en blanco (`n.map is not a function`)
- **Síntoma**: la PWA cargaba brevemente y luego quedaba en blanco, en desktop y celular.
- **Causa raíz**: el frontend (`api.js`) esperaba que `/master` y `/shopping` devolvieran un
  array directo, pero el backend los envuelve en `{"products": [...]}`. Al hacer
  `masterList.map(...)` sobre un objeto (no un array), React lanzaba una excepción no
  capturada durante el render y crasheaba toda la app (sin Error Boundary).
- **Solución**: `api.js` ahora extrae explícitamente `.products` / `.product` de la respuesta.
- **Pendiente relacionado**: no hay Error Boundary en React; un error similar en el futuro
  volvería a dejar la pantalla en blanco en vez de mostrar un mensaje de error legible.

### 6.4 Producto con acento corrupto en DynamoDB ("Papel higi�nico")
- **Diagnóstico**: se probó crear un producto con acento ("Café") directo contra la API
  (`Invoke-RestMethod` desde PowerShell) y se guardó/devolvió perfecto. Se concluyó que el
  backend maneja UTF-8 correctamente y que fue un dato corrupto puntual al crearse esa vez
  desde el navegador/celular (no un bug sistemático).
- **Estado**: pendiente de limpiar ese registro (se puede borrar ahora fácilmente desde la
  propia app, gracias al nuevo botón de eliminar — ver sección 7).

### 6.5 Ajustes de responsividad para celular
- **Síntoma**: en pantallas pequeñas la búsqueda, el filtro de categorías y el formulario de
  alta se comprimían; además, en "Por comprar" el botón "Comprado" bajaba debajo del producto
  cuando el nombre era largo.
- **Causa raíz**: el contenedor estaba limitado a `480px` y la regla móvil convertía todas las
  tarjetas `.product-item` en una sola columna. Esto hacía que el botón compartiera la misma
  fila visual con un nombre largo de forma incorrecta.
- **Solución**: en [frontend/src/App.css](frontend/src/App.css), el contenedor ocupa todo el
  ancho disponible en móviles, el toolbar y el formulario se apilan correctamente, y las
  tarjetas de compras usan dos columnas: nombre flexible y botón fijo. Los nombres largos
  ahora se ajustan dentro de su columna mediante `overflow-wrap`.
- **Cambio de UI**: en [frontend/src/App.jsx](frontend/src/App.jsx), las tarjetas de la vista
  "Por comprar" reciben la clase `shopping-item` para aplicarles ese layout sin alterar la
  lista maestra.
- **Validación**: `cd frontend; npm run build` terminó correctamente con Vite y generó el
  frontend en `frontend/dist`.
- **Pendiente**: sincronizar `frontend/dist` con S3 e invalidar CloudFront para comprobar el
  cambio en el dispositivo móvil publicado.

### 6.6 Ajuste de tarjetas en "Lista maestra"
- **Síntoma**: las tarjetas de productos se volvían demasiado altas en móvil y la categoría
  podía quedar separada visualmente del nombre; los botones de acciones terminaban muy abajo.
- **Causa**: la regla móvil convertía las tarjetas maestras en una sola columna y el contenido
  de `.product-name` se comportaba como elementos flexibles independientes.
- **Solución**: en [frontend/src/App.jsx](frontend/src/App.jsx), las tarjetas no editadas de
  la lista maestra reciben la clase `master-item`. En [frontend/src/App.css](frontend/src/App.css)
  esa clase usa dos columnas en móvil: contenido flexible a la izquierda y acciones compactas
  a la derecha; el nombre y sus metadatos se muestran como un bloque continuo.
- **Validación**: `cd frontend; npm run build` terminó correctamente con Vite y regeneró
  `frontend/dist`.
- **Pendiente**: publicar el build actualizado en S3 e invalidar CloudFront.

### 6.7 Sonido al agregar un producto a "Por comprar"
- **Solicitud**: reproducir una confirmación sonora cuando un producto de la lista maestra se
  agrega a la lista de compras; no reproducir sonido al dar de alta un producto nuevo.
- **Implementación**: en [frontend/src/App.jsx](frontend/src/App.jsx), `handleNeed` prepara un
  contexto de Web Audio desde el toque del usuario y reproduce un tono corto únicamente después
  de que `markNeeded` confirma correctamente la operación.
- **Compatibilidad**: el sonido se genera con Web Audio API, sin archivo adicional ni dependencia
  externa. El contexto se prepara durante el clic para evitar bloqueos de reproducción automática
  en navegadores móviles.
- **Error de API**: si la operación falla, no se reproduce el sonido y se conserva el manejo de
  error existente.
- **Validación**: `cd frontend; npm run build` terminó correctamente. `npm run lint` también
  terminó, mostrando únicamente la advertencia preexistente del efecto de carga en `App.jsx`.

### 6.8 Marcar como comprado deslizando la tarjeta
- **Solicitud**: evitar el botón grande "Comprado" y permitir que el usuario marque un producto
  deslizando su tarjeta hacia la derecha en la vista "Por comprar".
- **Implementación**: en [frontend/src/App.jsx](frontend/src/App.jsx) se agregó el componente
  `ShoppingItem`, que detecta gestos con Pointer Events. El producto se marca como comprado al
  superar un umbral horizontal de `96px` y reutiliza la función existente `handleBought`.
- **Comportamiento móvil**: el gesto solo se considera horizontal; el desplazamiento vertical
  normal de la pantalla sigue funcionando. La tarjeta muestra el movimiento y una confirmación
  visual mientras se desliza.
- **Accesibilidad y respaldo**: el botón grande fue reemplazado por un control compacto con
  etiqueta accesible, `title` y acción equivalente para usuarios que no puedan deslizar o usen
  desktop.
- **Backend**: no fue necesario modificar la API ni el modelo de datos.
- **Validación**: `cd frontend; npm run build` terminó correctamente. `npm run lint` terminó
  con la advertencia preexistente del efecto de carga en `App.jsx`.
- **Pendiente**: publicar `frontend/dist` en S3, invalidar CloudFront y probar el gesto en el
  dispositivo móvil real, especialmente con nombres largos y desplazamiento vertical.

### 6.9 Corrección visual de confirmación del deslizamiento
- **Síntoma**: el texto "✓ Comprado" aparecía traslapado sobre todas las tarjetas desde que se
  cargaba la pantalla, aunque el usuario todavía no hubiera iniciado un gesto.
- **Causa**: `.swipe-confirmation` tenía `display: flex` permanentemente y no contaba con un
  estado visual oculto inicial.
- **Solución**: en [frontend/src/App.css](frontend/src/App.css), la confirmación inicia con
  `opacity: 0` y solo pasa a visible cuando la tarjeta recibe la clase `.is-swiping`.
- **Resultado**: la lista queda limpia al cargar; la indicación "✓ Comprado" aparece únicamente
  mientras el usuario desliza una tarjeta hacia la derecha.
- **Validación**: `cd frontend; npm run build` terminó correctamente y regeneró `frontend/dist`.

### 6.10 `flushPendingBought` declarada antes de `loadAll` (pantalla blanca)
- **Síntoma**: tras el deploy del "Deshacer", la app mostraba pantalla blanca tanto en web
  como en el dispositivo móvil.
- **Causa raíz**: `flushPendingBought` fue declarada con `useCallback` antes de `loadAll`.
  Los `const` con `useCallback` no se elevan (no tienen hoisting), así que cuando
  `flushPendingBought` intentaba capturar `loadAll` en su closure, `loadAll` aún era
  `undefined`. El lint señaló exactamente este problema con la advertencia
  `Cannot access variable while it is being initialized`, que no fue tratada como bloqueante.
- **Solución**: mover `flushPendingBought` para después de la declaración de `loadAll` en
  el archivo.
- **Lección**: las advertencias de lint sobre orden de inicialización de `const`/`useCallback`
  deben tratarse como errores, no como advertencias ignorables.

### 6.11 Gesto de deslizamiento horizontal no funcionaba en móvil (lista maestra)
- **Síntoma**: en el dispositivo Android el gesto derecha para eliminar no se activaba;
  en su lugar se movía toda la página horizontalmente (scroll horizontal visible).
- **Causa raíz**: el `<li>` de `MasterItem` tenía `touchAction: "manipulation"` como
  `style` inline, que sobreescribía la regla CSS `touch-action: pan-y` de
  `.master-swipe-item`. El navegador móvil interpretaba el gesto horizontal como scroll
  de página en vez de entregárselo al componente.
- **Solución**: eliminar `touchAction` del `style` inline y agregar `overflow-x: hidden`
  al contenedor `.app` para prevenir scroll horizontal de página.
- **Archivos**: [frontend/src/App.jsx](frontend/src/App.jsx),
  [frontend/src/App.css](frontend/src/App.css).

## 7. Historial de avance (qué se construyó, en orden)

1. Pipeline base con SAM + GitHub Actions, autenticación con llaves (luego migrado a OIDC).
2. Backend Pantry API (Lambda + DynamoDB + HttpApi): endpoints master/shopping/create/need/bought.
3. Resolución del problema de OIDC (ver 6.1) — rol y trust policy reconstruidos desde cero.
4. Frontend PWA (React + Vite): dos vistas (Por comprar / Lista maestra), instalable, mobile-first.
5. Infraestructura de hosting del frontend (S3 + CloudFront) agregada a `template.yaml`.
6. Pipeline extendido para build+deploy automático del frontend tras el backend.
7. Fix del bug de parseo de respuestas (`n.map is not a function`, ver 6.3).
8. Repo hecho público para resolver bloqueo de minutos de Actions (ver 6.2).
9. **ABC completo** en el backend: se agregaron `PUT /products/{id}` (editar) y
   `DELETE /products/{id}` (eliminar), con su UI correspondiente (edición en línea).
10. Modal de confirmación (`ConfirmDialog.jsx`) para reemplazar el `window.confirm()` nativo
    al eliminar productos.
11. Ajuste responsive inicial: búsqueda, filtro y formulario de alta se adaptan a pantallas
    pequeñas ocupando el ancho disponible.
12. Ajuste responsive de "Por comprar": nombres largos se envuelven, botón fijo en columna.
13. Ajuste responsive de "Lista maestra": tarjetas compactas con acciones alineadas.
14. Interacción de compra por deslizamiento en "Por comprar": deslizar derecha marca comprado.
15. **"Deshacer" después de marcar como comprado**: toast de 5 segundos con botón Deshacer;
    la llamada al backend se hace solo si el usuario no deshace en ese tiempo.
16. **Doble tap para editar** en lista maestra: reemplazó el botón lápiz ✎.
17. **Deslizar derecha para eliminar** en lista maestra: componente `MasterItem` con Pointer
    Events, abre el modal de confirmación existente al superar el umbral.
18. **Deslizar izquierda para agregar a lista** en lista maestra: mismo componente `MasterItem`,
    gesto `deltaX < 0` llama `handleNeed`. Botón "+ A la lista" eliminado.
19. **Actualización optimista en `handleNeed`**: elimina el parpadeo/refresh visible al agregar
    a la lista — el estado local se actualiza al instante, la API se llama en segundo plano.
20. **Hint de gestos de primera vez**: banner verde en lista maestra con los tres gestos.
    Se cierra con "Entendido" o se auto-descarta a los 8 segundos. Guardado en `localStorage`.
21. **Sonido retirado**: `playProductAddedSound` eliminada de `App.jsx`. No funcionaba en
    Android por restricciones de autoplay del navegador móvil. El feedback visual del gesto
    es suficiente. Nota: el caso de uso real (notificar a otro familiar cuando se agrega un
    producto) requiere notificaciones push, no sonido local.
22. **Error Boundary**: nuevo componente `ErrorBoundary.jsx` (clase React). Captura cualquier
    excepción en el árbol de componentes y muestra pantalla con mensaje + botón "Reintentar"
    en vez de pantalla blanca. Envuelve `<App />` en `main.jsx`.
23. **Controles de cantidad `-`/`+`**: botones inline en cada tarjeta de lista maestra.
    Actualización optimista — la cantidad cambia al instante y se sincroniza con el backend
    vía `PUT /products/{id}`. `e.stopPropagation()` evita que doble tap en `+` abra edición.
24. **Campo de cantidad eliminado del formulario de alta**: la cantidad siempre inicia en 1
    al crear un producto; el usuario la ajusta con los botones `-`/`+` en la tarjeta.
25. **Captura de precio por etiqueta en "Por comprar"**: press largo (~500ms) sobre una
    tarjeta abre `PriceDialog.jsx` — muestra nombre, campo de precio y subtotal en tiempo
    real (`precio × quantity`). Los precios se guardan en `sessionStorage` y sobreviven
    recargas de la app durante la sesión de compra.
    - Tarjeta muestra subtotal en verde si tiene precio, o hint discreto si no.
    - Resumen muestra **"🛒 Estimado del carrito"** (suma de productos con precio pendientes)
      y **"✓ Pagado hasta ahora"** (suma de productos ya marcados comprados con precio).
    - Al deshacer un producto comprado, se revierte también del contador "Pagado hasta ahora".
    - Long press y swipe coexisten sin colisión: cualquier movimiento >8px cancela el timer
      del long press y activa el swipe normalmente.

## 8. Pendientes / backlog priorizado

Ideas propuestas y aún no iniciadas, ordenadas por impacto y riesgo:

1. ~~Confirmación visual (modal) al eliminar~~ ✅ **Hecho**.
2. ~~Deshacer después de marcar comprado~~ ✅ **Hecho** (paso 15).
3. ~~Guía visual del gesto~~ ✅ **Hecho** (paso 20).
4. ~~Sonido al agregar a lista~~ ✅ **Retirado** (paso 21) — no funcionaba en Android; el
   caso de uso real requiere notificaciones push (ver pendiente #6).
5. ~~Error Boundary~~ ✅ **Hecho** (paso 22).
6. ~~Controles rápidos de cantidad `-`/`+`~~ ✅ **Hecho** (paso 23-24).
7. **Categorías predefinidas**: descartado — el usuario prefiere la simplicidad actual.
8. **Historial de compras**: registrar producto, cantidad, fecha/hora cuando se marca como
   comprado. Requiere tabla nueva en DynamoDB y endpoints nuevos en el backend. Base para
   estadísticas futuras de consumo familiar.
9. **Notificaciones push**: cuando un familiar agrega un producto a la lista de compras,
   notificar al resto aunque la app esté cerrada. Requiere Web Push API en el frontend y
   un mecanismo de suscripción/envío en el backend (SNS o similar).
10. **Opción de limpiar precio** desde la tarjeta en "Por comprar" — `clearPriceForItem`
    ya está implementada en `App.jsx`, solo falta el botón/gesto que la invoque.
11. **Restringir permisos del rol IAM**: `GitHubActionsOIDCRole` tiene `AdministratorAccess`.
    Crear policy específica con solo los permisos necesarios para `sam deploy`.
12. **Modo offline real**: consultar y modificar la lista sin conexión, sincronizar al volver.
13. **Autenticación y usuarios**: login, roles y registro de quién compró qué.
14. **Limpieza del dato corrupto**: "Papel higi??nico" en DynamoDB — borrar desde la app.

### Estado de funcionalidades que ya existen

- `quantity` y `category` implementados en backend, frontend y modelo de datos.
- Búsqueda y filtro por categoría en ambas vistas.
- Crear productos (cantidad fija en 1 al alta), editar con doble tap, eliminar deslizando
  derecha (modal de confirmación), ajustar cantidad con botones `-`/`+` inline.
- Agregar a lista de compras deslizando izquierda; marcar comprado deslizando derecha en
  "Por comprar"; deshacer con toast de 5 segundos.
- **Captura de precio por etiqueta**: press largo en "Por comprar" abre dialog de precio.
  Subtotal en tarjeta, estimado del carrito y pagado hasta ahora en el resumen.
  Precios persistidos en `sessionStorage` durante la sesión de compra.
- Hint de gestos de primera vez en lista maestra (localStorage, auto-dismiss 8s).
- Actualización optimista en `handleNeed`, `handleBought` y `handleQuantityChange`.
- Error Boundary: pantalla de error con botón "Reintentar" en vez de pantalla blanca.
- Frontend publicado en S3 + CloudFront, pipeline CI/CD con 3 ambientes (dev/staging/prod).

### Archivos frontend relevantes

| Archivo | Responsabilidad |
|---|---|
| `App.jsx` | Componente principal, estado global, gestos, lógica de negocio |
| `App.css` | Todos los estilos de la app |
| `api.js` | Funciones de llamada a la API (fetch wrapper) |
| `ConfirmDialog.jsx` | Modal de confirmación para eliminar |
| `PriceDialog.jsx` | Dialog para capturar precio de etiqueta (press largo) |
| `ErrorBoundary.jsx` | Clase React que captura errores y evita pantalla blanca |
| `main.jsx` | Entry point, monta App dentro de ErrorBoundary |

### Orden recomendado de implementación

1. **Botón/gesto para limpiar precio** desde la tarjeta (pequeño, `clearPriceForItem` ya existe).
2. **Historial de compras** — backend + frontend (~3-4 sesiones). Base para estadísticas.
3. **Notificaciones push** — notificar al familiar cuando alguien agrega a la lista.
4. **Estadísticas** sobre el historial (frontend puro).
5. **Autenticación** cuando el alcance familiar lo justifique.
6. **Restringir permisos IAM** y fortalecer offline como madurez técnica.

## 9. Guía de continuidad para otra AI

La siguiente instrucción puede copiarse junto con este repositorio para que otra AI continúe el
trabajo correctamente:

```text
Estoy trabajando en el proyecto demo-aws-pipeline.

Lee primero PROJECT_STATUS.md y markdown.md antes de proponer o modificar código. No reconstruyas
el proyecto desde cero. Identifica qué está terminado, qué está pendiente y cuál es el siguiente
cambio recomendado.

Arquitectura actual:
- AWS SAM
- Lambda Python 3.12
- API Gateway HTTP API
- DynamoDB
- React + Vite + PWA
- S3 + CloudFront
- GitHub Actions con ambientes dev, staging y prod

Reglas de trabajo:
- Trabaja un cambio pequeño a la vez.
- Explica primero la causa, el objetivo y los archivos que se modificarán.
- El usuario quiere aprender y escribir el código: entrega la ubicación exacta y el código
  necesario, pero no edites archivos directamente salvo que lo solicite de forma explícita.
- El usuario ejecuta git add, git commit y git push desde Git Bash.
- No hagas commit ni push.
- Después de cada cambio ejecuta una validación concreta.
- Para frontend usa `cd frontend; npm run build` y `npm run lint`.
- No modifiques backend, AWS o pipeline cuando el cambio sea solamente visual.
- Conserva la responsividad móvil y prueba nombres largos y gestos táctiles.
- Actualiza PROJECT_STATUS.md al completar una funcionalidad importante.
- No elimines cambios existentes sin entenderlos y documentarlos.

Estado funcional actual:
- Vistas "Por comprar" y "Lista maestra".
- Crear productos (siempre inician con cantidad 1).
- Editar productos con doble tap/clic sobre la tarjeta.
- Eliminar productos deslizando la tarjeta hacia la derecha (modal de confirmación).
- Agregar producto a la lista de compras deslizando la tarjeta hacia la izquierda.
- Marcar productos como comprados deslizando la tarjeta a la derecha en "Por comprar".
- Deshacer al marcar comprado: toast de 5 segundos con botón Deshacer.
- Ajustar cantidad con botones `-`/`+` inline en cada tarjeta de lista maestra.
- Captura de precio por etiqueta: press largo (~500ms) en "Por comprar" abre PriceDialog.
  Subtotal en tarjeta (precio × quantity), estimado del carrito y pagado hasta ahora en
  el resumen. Precios en sessionStorage, sobreviven recargas de la sesión.
- Hint de gestos de primera vez en lista maestra (localStorage, auto-dismiss 8s).
- Categorías, búsqueda y filtro en ambas vistas.
- Actualización optimista en handleNeed, handleBought y handleQuantityChange.
- Error Boundary: muestra pantalla de error útil en vez de pantalla blanca.
- Frontend publicado en S3 + CloudFront, pipeline CI/CD con 3 ambientes (dev/staging/prod).

Siguiente trabajo recomendado:
Agregar botón/gesto para limpiar el precio de un producto en "Por comprar".
`clearPriceForItem(id)` ya está implementada en App.jsx — solo falta el trigger en la UI.
Opción simple: un botón "✕" pequeño junto al price-tag que llame clearPriceForItem.

Antes de implementar cualquier cambio, entrega:
1. Diagnóstico breve del flujo actual.
2. Diseño de la solución.
3. Archivos y funciones que cambiarían.
4. Criterios de aceptación.
5. Una sola acción inicial para avanzar paso a paso.
```

### Criterios generales para futuras implementaciones

- La acción debe ser comprensible sin capacitación extensa.
- Los gestos nunca deben impedir el scroll vertical.
- Las acciones destructivas o irreversibles deben tener recuperación cuando sea posible.
- Cada cambio debe conservar una alternativa accesible que no dependa de gestos.
- Las pruebas deben cubrir celular pequeño, nombres largos, datos vacíos y errores de API.
- La documentación debe registrar causa, solución, archivos, validación y pendientes.

## 10. Preferencia de trabajo del usuario (IMPORTANTE para cualquier IA que continúe)

- El usuario **quiere escribir el código él mismo** para aprender el proceso.
- El asistente debe **dar el código exacto y la ubicación** (archivo, snippet, instrucciones
  paso a paso) en el chat, **sin editar los archivos directamente**, salvo que el usuario lo
  pida explícitamente para algo puntual.
- El usuario hace el `git add` / `commit` / `push` él mismo, y valida el pipeline y el
  resultado en el navegador/celular antes de continuar al siguiente paso.
- Ritmo de trabajo preferido: un cambio pequeño y verificable a la vez (código → probar local
  → push → validar pipeline → validar en producción → siguiente paso), no lotes grandes.

## 11. Datos de referencia rápida

- Cuenta AWS: `112036182812`, región `us-east-1`.
- Repo GitHub: `EnriqueLoGo/demo-aws-pipeline` (público).
- Rol OIDC: `arn:aws:iam::112036182812:role/GitHubActionsOIDCRole`.
- Stacks CloudFormation: `pantry-dev`, `pantry-staging`, `pantry-prod`.
- Outputs relevantes de cada stack: `ApiUrl`, `FrontendUrl`, `FrontendBucketName`,
  `FrontendDistributionId`, `TableName`, `FunctionName`.
- Node local: usar `cmd /c "npm ..."` o `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
  para evitar el bloqueo de ejecución de scripts de PowerShell con `npm.ps1`.
- Para desarrollo local del frontend: crear `frontend/.env.local` (no se sube a git) con
  `VITE_API_URL=<ApiUrl del ambiente dev>`.

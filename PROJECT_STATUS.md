# Pantry API + Lista de Mandado — Documento de continuidad del proyecto

> Este documento existe para que cualquier persona (o cualquier IA) pueda retomar el proyecto
> sin necesidad de reconstruir el contexto desde cero. Se actualiza conforme avanza el proyecto.
>
> Última actualización: 2026-09-14

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
   `DELETE /products/{id}` (eliminar), con su UI correspondiente (botones ✎ y 🗑️ en la lista
   maestra, edición en línea).
10. Modal de confirmación (`ConfirmDialog.jsx`) para reemplazar el `window.confirm()` nativo
    al eliminar productos — más amigable para la ama de casa/usuario final.
11. Ajuste responsive inicial: búsqueda, filtro y formulario de alta se adaptan a pantallas
  pequeñas ocupando el ancho disponible.
12. Ajuste responsive de "Por comprar": nombres largos se envuelven y el botón "Comprado"
  permanece en una columna independiente.
13. Ajuste responsive de "Lista maestra": las tarjetas conservan una altura compacta y las
  acciones permanecen alineadas junto al producto en pantallas pequeñas.
14. Interacción de compra por deslizamiento: deslizar hacia la derecha marca el producto como
  comprado y deja un control compacto alternativo.

## 8. Pendientes / backlog priorizado

Ideas propuestas y aún no iniciadas, ordenadas por impacto y riesgo:

1. ~~Confirmación visual (modal) al eliminar~~ ✅ **Hecho** (paso 9-10 arriba).
2. **Deshacer después de marcar comprado**: mostrar una acción temporal para revertir un
   deslizamiento accidental.
3. **Guía visual del gesto**: indicar de forma discreta, preferentemente solo la primera vez,
   que una tarjeta puede deslizarse hacia la derecha.
4. **Decidir el futuro del sonido**: corregirlo en dispositivos móviles o retirarlo si no aporta
   valor. El código actual existe, pero el sonido no se escuchó durante la prueba real.
5. **Indicador de quién agregó/compró qué** (multi-usuario: 4 socios + 2 asistentes, aunque
   este dato viene de otro proyecto del usuario — verificar si aplica aquí).
6. **Controles rápidos de cantidad**: usar botones `-` y `+` para facilitar la edición desde
   celular.
7. **Categorías predefinidas**: ofrecer categorías comunes y una opción para crear una nueva,
   sin perder la categoría personalizada actual.
8. **Historial de compras**: registrar producto, cantidad, fecha/hora y usuario que lo marcó
   como comprado; probablemente requiere una tabla o entidad adicional.
9. **Restringir permisos del rol IAM**: actualmente `GitHubActionsOIDCRole` tiene
   `AdministratorAccess` (amplio, usado para destrabar la demo rápido). Se debe crear una
   policy específica con solo los permisos que `sam deploy` realmente necesita
   (CloudFormation, Lambda, API Gateway, DynamoDB, S3, CloudFront, IAM PassRole limitado).
10. **Error Boundary** en React para evitar pantallas en blanco ante errores inesperados (ver 6.3).
11. **Modo offline real**: permitir consultar y modificar la lista sin conexión y sincronizar
    los cambios cuando vuelva la conectividad.
12. **Autenticación y permisos**: agregar usuarios, roles y control de acceso si la aplicación
    deja de ser exclusivamente familiar.
13. **Limpieza/migración de datos**: endpoint o proceso controlado para registros corruptos como
    el descrito en 6.4.

### Estado de funcionalidades que ya existen

- `quantity` y `category` ya están implementados en backend, frontend y modelo de datos.
- Búsqueda y filtro por categoría ya están implementados en ambas vistas.
- Crear, editar, eliminar, marcar como necesario y marcar como comprado ya están implementados.
- El gesto de deslizar hacia la derecha ya está implementado en "Por comprar".
- El sonido al agregar a "Por comprar" está implementado, pero no está validado como confiable
  en dispositivos móviles reales.
- La responsividad móvil ha sido ajustada y validada mediante build; cada modificación visual
  importante debe comprobarse también en un teléfono real.

### Orden recomendado de implementación

1. Implementar "Deshacer" después de marcar como comprado.
2. Probar el gesto en Android con nombres cortos, nombres largos y desplazamiento vertical.
3. Agregar una guía visual de uso del gesto, mostrada una sola vez o hasta que el usuario la
   descarte.
4. Resolver o retirar el sonido que actualmente no se escucha en el dispositivo móvil.
5. Mejorar cantidades y categorías para uso táctil.
6. Agregar historial de compras.
7. Agregar autenticación, usuarios y permisos solo cuando el alcance lo requiera.
8. Fortalecer offline, Error Boundary y permisos IAM como trabajo técnico de madurez.

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
- Crear, editar y eliminar productos.
- Categorías, cantidades, búsqueda y filtro.
- Pasar productos de la lista maestra a "Por comprar".
- Marcar productos como comprados mediante deslizar hacia la derecha.
- Control compacto alternativo para marcar comprado.
- Frontend publicado mediante S3 y CloudFront.
- El sonido al agregar a "Por comprar" está en el código, pero no se escuchó en el celular y
  debe considerarse pendiente de resolver o retirar.

Siguiente trabajo recomendado:
Implementar "Deshacer" después de marcar un producto como comprado. Debe proteger contra un
deslizamiento accidental, funcionar en móvil y no cambiar el contrato actual de la API sin una
razón clara.

Antes de implementar, entrega:
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
- Outputs relevantes de cada stack: `ApiUrl`, `FrontendUrl`, `FrontendBucketName`,
  `FrontendDistributionId`, `TableName`, `FunctionName`.
- Node local: usar `cmd /c "npm ..."` o `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
  para evitar el bloqueo de ejecución de scripts de PowerShell con `npm.ps1`.
- Para desarrollo local del frontend: crear `frontend/.env.local` (no se sube a git) con
  `VITE_API_URL=<ApiUrl del ambiente dev>`.

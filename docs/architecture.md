# Arquitectura — Brigada Emergencias

Documento de arquitectura del MVP. Complementa el alcance funcional definido en
`README.md` y no lo modifica.

## 1. Contexto

Brigada Emergencias es una PWA para una sola brigada (RN-01). El MVP permite:

- Que cada brigadista declare su disponibilidad.
- Que el coordinador cree, active y cierre convocatorias.
- Que los brigadistas respondan `VOY` o `NO_PUEDO`.
- Que el coordinador consulte el estado de la brigada y el historial.

La Etapa 0 deja el workspace preparado, sin módulos funcionales, sin
autenticación implementada, sin conexión a MongoDB y sin colecciones de negocio.

## 2. Stack y versiones

Las versiones están fijadas en `package.json` (sin rangos `^` ni `~`).

| Área               | Tecnología                                   | Versión                 |
| ------------------ | -------------------------------------------- | ----------------------- |
| Runtime            | Node.js LTS                                  | 24.19.0                 |
| Gestor de paquetes | npm                                          | 11.17.0                 |
| Framework          | Next.js (App Router, Turbopack)              | 16.4.3                  |
| UI                 | React / React DOM                            | 19.3.1                  |
| Lenguaje           | TypeScript                                   | 5.9.3                   |
| Estilos            | Tailwind CSS + `@tailwindcss/turbopack`      | 4.3.3                   |
| Autenticación      | Auth.js (`next-auth`)                        | 5.0.0-beta.32           |
| Base de datos      | MongoDB local (Docker) / Atlas en producción | Servidor 8.2.12         |
| Driver MongoDB     | `mongodb`                                    | 7.8.0                   |
| Contraseñas        | Argon2id (`@node-rs/argon2`)                 | 2.2.2                   |
| Pruebas unitarias  | Vitest + jsdom + Testing Library             | 5.0.5 / 30.1.3 / 16.3.3 |
| Calidad            | ESLint + Prettier                            | 9.39.5 / 3.9.10         |
| Migraciones        | Scripts Node versionados (previstos)         | Sin herramienta externa |

La justificación de cada decisión está en `docs/technical-decisions.md`.

## 3. Vista general

```text
Navegador / PWA instalada
        |
        | HTTPS
        v
Next.js 16 (App Router, React Server Components)
  - UI y navegación
  - Server Actions / Route Handlers (etapas futuras)
  - Auth.js: Credentials Provider + sesión JWT
  - Autorización por rol en el servidor
        |
        | Driver oficial de MongoDB (solo servidor; TLS en producción)
        v
MongoDB (Docker local en desarrollo / Atlas en producción)
  - replica set local rs0; replica set administrado en Atlas
  - users, brigadistas, availability_history
  - emergencies, emergency_responses, notifications, audit_logs
  - Validadores JSON Schema, índices y transacciones
        |
        v
Proveedor de push (a definir, probablemente FCM) en Etapa 5
```

Regla estructural: el cliente nunca es la autoridad. Los permisos se validan en
el servidor antes de cada operación. El navegador no se conecta directamente a
MongoDB y no recibe credenciales de base de datos. Ocultar un botón no es una
medida de seguridad.

## 4. Organización de carpetas

Estado actual:

```text
.
├── compose.yaml              MongoDB local con replica set para desarrollo
├── src/
│   ├── app/                  Rutas, layouts, metadata y manifest PWA
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── manifest.ts
│   │   └── page.tsx
│   ├── components/
│   │   └── ui/               Componentes visuales reutilizables
│   ├── features/             Módulos de negocio por dominio (vacío por ahora)
│   ├── lib/
│   │   └── env.ts            Lectura y validación de variables del servidor
│   └── types/                Tipos compartidos
├── tests/
│   ├── unit/                 Pruebas unitarias con Vitest
│   └── integration/          Pruebas con MongoDB de prueba (previstas)
├── docs/                     Documentación técnica
├── openspec/                 Especificaciones y cambios
└── public/                   Assets estáticos (iconos PWA)
```

Carpetas previstas para etapas funcionales (no crear hasta necesitarlas):

```text
src/app/(auth)/               Inicio de sesión y recuperación
src/app/(brigadista)/         Disponibilidad y bandeja de convocatorias
src/app/(coordinador)/        Dashboard y administración
src/proxy.ts                  Protección gruesa de rutas con Auth.js
src/features/availability/    Reglas y casos de uso de disponibilidad
src/features/emergencies/     Convocatorias y respuestas
src/features/notifications/   Intentos y resultados de notificación
src/features/users/           Perfiles, roles y brigadistas
src/lib/auth/                 Configuración de Auth.js, autorización y contraseñas
src/lib/mongodb/              Cliente singleton, colecciones y repositorios
db/migrations/                Scripts de colecciones, validadores e índices
```

## 5. Separación de responsabilidades

| Capa            | Responsabilidad                                             | Ubicación                         |
| --------------- | ----------------------------------------------------------- | --------------------------------- |
| Presentación    | Render, accesibilidad, estados visuales                     | `src/app`, `src/components`       |
| Dominio         | Reglas de negocio puras (RN-01 a RN-10), validaciones       | `src/features/*`                  |
| Acceso a datos  | Consultas y mutaciones con el driver oficial de MongoDB     | `src/lib/mongodb`, server actions |
| Infraestructura | Configuración de Auth.js, variables de entorno, utilidades  | `src/lib`                         |
| Base de datos   | Integridad, validadores, índices, historial y transacciones | Migraciones y MongoDB local/Atlas |

Principios:

- Las reglas de negocio críticas deben poder probarse sin navegador ni red.
- Las páginas y componentes no acceden directamente a MongoDB.
- Las consultas que dependen de permisos se ejecutan del lado servidor.
- No se agregan capas, ORM ni librerías de estado hasta que aporten valor real.

## 6. Integración con MongoDB

Estado en Etapa 0: variables validadas y MongoDB local disponible con Docker,
sin conexión desde la aplicación y sin colecciones de negocio.

- `compose.yaml` levanta MongoDB 8.2.12 en `127.0.0.1:27018` con el replica set
  `rs0`. El puerto se elige para evitar conflictos con otras instancias locales.
- El healthcheck inicia el replica set y `docker compose up --wait` espera a que
  exista un primary. Esto permite probar transacciones localmente.
- `src/lib/env.ts` valida `MONGODB_URI`, `MONGODB_DB` y `AUTH_SECRET`, y falla
  con un mensaje claro si faltan o son inválidas.
- `MONGODB_URI` y `AUTH_SECRET` son secretos de servidor. Nunca se prefijan con
  `NEXT_PUBLIC_` ni se envían al navegador.
- El futuro cliente de MongoDB se creará como singleton del servidor y se
  reutilizará entre recargas de desarrollo para evitar conexiones duplicadas.
- Se usará el driver oficial `mongodb`, sin ODM ni ORM. Los tipos de las
  colecciones se declaran en TypeScript.
- Las operaciones que afectan más de un documento usarán transacciones de
  MongoDB. El replica set local y Atlas las soportan.
- En producción se usará MongoDB Atlas con TLS, cifrado en reposo, respaldos y
  un usuario con el mínimo privilegio sobre una única base lógica.
- No se usará `@auth/mongodb-adapter`: Credentials con sesión JWT no lo requiere
  y su peer declara `mongodb ^6`, incompatible con el driver 7.

El modelo, índices y estrategia de migración están en
`docs/mongodb-data-model.md`.

## 7. Autenticación y autorización

Autenticación: Auth.js con Credentials Provider, identificador RUT y contraseña.
La sesión es JWT porque el proveedor Credentials no admite sesiones persistidas
por adaptador. El detalle está en `docs/authentication.md`.

Roles del MVP:

| Rol             | Alcance                                             |
| --------------- | --------------------------------------------------- |
| `ADMINISTRADOR` | Usuarios, roles y configuración general.            |
| `COORDINADOR`   | Brigadistas, convocatorias, respuestas y cierre.    |
| `BRIGADISTA`    | Disponibilidad propia y respuestas a convocatorias. |

Autorización en tres capas:

1. Interfaz: oculta acciones no permitidas, solo como ayuda de experiencia.
2. Servidor: valida sesión, usuario activo y rol antes de ejecutar server
   actions o route handlers.
3. Base de datos: validadores, índices únicos y transacciones refuerzan las
   invariantes de negocio.

El rol incluido en el JWT es una caché para navegación y render. Las operaciones
sensibles vuelven a consultar `users` para verificar `active` y rol vigentes, de
modo que una desactivación o cambio de rol no dependa de esperar el vencimiento
del token. El rol nunca se acepta desde el cuerpo de la petición ni desde el
cliente.

## 8. Estrategia de seguridad

- Denegar por defecto: toda ruta, server action o route handler protegido llama a
  un helper de autorización antes de acceder a datos.
- El navegador no tiene acceso directo a MongoDB ni recibe la cadena de conexión.
- El contenedor local escucha solo en `127.0.0.1:27018`; no se expone a la red
  local. No contiene datos reales.
- Los secretos viven solo en `.env.local` y en el entorno del servidor. No se
  versionan valores reales.
- Contraseñas con Argon2id; nunca en texto plano, nunca en logs, nunca en la
  sesión.
- Errores de login genéricos para no revelar si un RUT existe o está activo.
- Validación y limitación de intentos de login (rate limiting) antes de exponer
  el formulario en producción.
- Registro de auditoría para operaciones administrativas relevantes, sin datos
  sensibles.
- Pruebas explícitas de acceso permitido y denegado para cada rol y operación
  sensible.
- El usuario de MongoDB en Atlas no es administrador del clúster y solo puede
  leer/escribir la base de la aplicación.
- Datos personales limitados a los necesarios. El RUT se trata como dato
  personal: no se registra completo en logs ni se muestra sin necesidad.

## 9. PWA

Etapa 0 implementa:

- `src/app/manifest.ts` con nombre, colores, modo `standalone`, iconos PNG
  192/512, variantes maskable e icono para iOS.
- Metadata de aplicación y `themeColor`.
- Layout responsive con Tailwind CSS.

Pendiente de decisión en una etapa posterior:

- Service worker y estrategia offline (candidato: Serwist).
- Notificaciones push (FCM u otro proveedor), con registro de intentos,
  aceptación, entrega y respuesta cuando el proveedor lo permita.

La bandeja interna de convocatorias no dependerá del éxito del push.

## 10. Límites de la Etapa 0

- No hay módulos funcionales.
- No hay autenticación, formulario de login ni sesiones.
- No hay conexión desde la aplicación a MongoDB ni colecciones creadas.
- MongoDB local está disponible con Docker (`compose.yaml`) y replica set `rs0`.
- No hay migraciones aplicadas ni datos reales.
- No hay notificaciones ni service worker.
- No hay despliegue.

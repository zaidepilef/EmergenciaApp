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
autenticación implementada y sin tablas de negocio.

## 2. Stack y versiones

Las versiones están fijadas en `package.json` (sin rangos `^` ni `~`).

| Área               | Tecnología                                          | Versión                 |
| ------------------ | --------------------------------------------------- | ----------------------- |
| Runtime            | Node.js LTS                                         | 24.19.0                 |
| Gestor de paquetes | npm                                                 | 11.17.0                 |
| Framework          | Next.js (App Router, Turbopack)                     | 16.4.3                  |
| UI                 | React / React DOM                                   | 19.3.1                  |
| Lenguaje           | TypeScript                                          | 5.9.3                   |
| Estilos            | Tailwind CSS + `@tailwindcss/turbopack`             | 4.3.3                   |
| Backend / Auth     | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) | 2.118.0 / 0.12.7        |
| Base de datos      | PostgreSQL administrado por Supabase                | Provista por Supabase   |
| Pruebas unitarias  | Vitest + jsdom + Testing Library                    | 5.0.5 / 30.1.3 / 16.3.3 |
| Calidad            | ESLint + Prettier                                   | 9.39.5 / 3.9.10         |
| Migraciones        | Supabase CLI (devDependency)                        | 2.122.0                 |

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
  - Validación de permisos del lado servidor
        |
        | @supabase/ssr + JWT
        v
Supabase
  - Auth (sesiones y recuperación de contraseña)
  - PostgREST (API sobre PostgreSQL)
  - PostgreSQL + Row Level Security (RLS)
  - Storage / Realtime / Edge Functions solo si se justifican
        |
        v
Proveedor de push (a definir, probablemente FCM) en Etapa 5
```

Regla estructural: el cliente nunca es la autoridad. Los permisos se validan en
el servidor y se refuerzan con RLS en PostgreSQL. Ocultar un botón no es una
medida de seguridad.

## 4. Organización de carpetas

Estado actual:

```text
.
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
│   │   ├── env.ts            Lectura y validación de variables públicas
│   │   └── supabase/         Clientes de Supabase (browser / server)
│   └── types/                Tipos compartidos y tipos generados de la base
├── tests/
│   ├── unit/                 Pruebas unitarias con Vitest
│   └── integration/          Pruebas contra Supabase/PostgreSQL local
├── supabase/                 Configuración y migraciones (sin tablas aún)
├── docs/                     Documentación técnica
├── openspec/                 Especificaciones y cambios
└── public/                   Assets estáticos (iconos PWA)
```

Carpetas previstas para etapas funcionales (no crear hasta necesitarlas):

```text
src/app/(auth)/               Inicio de sesión y recuperación
src/app/(brigadista)/         Disponibilidad y bandeja de convocatorias
src/app/(coordinador)/        Dashboard y administración
src/features/availability/    Reglas y casos de uso de disponibilidad
src/features/emergencies/     Convocatorias y respuestas
src/features/notifications/   Intentos y resultados de notificación
src/features/users/           Perfiles, roles y brigadistas
```

## 5. Separación de responsabilidades

| Capa            | Responsabilidad                                       | Ubicación                              |
| --------------- | ----------------------------------------------------- | -------------------------------------- |
| Presentación    | Render, accesibilidad, estados visuales               | `src/app`, `src/components`            |
| Dominio         | Reglas de negocio puras (RN-01 a RN-10), validaciones | `src/features/*`                       |
| Acceso a datos  | Consultas y mutaciones a Supabase                     | `src/features/*/data` o server actions |
| Infraestructura | Clientes, configuración, utilidades                   | `src/lib`                              |
| Base de datos   | Integridad, restricciones, RLS, historial             | `supabase/migrations`                  |

Principios:

- Las reglas de negocio críticas deben poder probarse sin navegador ni red.
- Las páginas y componentes no acceden directamente a PostgreSQL.
- Las consultas que dependen de permisos se ejecutan del lado servidor cuando
  corresponda.
- No se agregan capas, ORM ni librerías de estado hasta que aporten valor real.

## 6. Integración con Supabase

Estado en Etapa 0: clientes preparados, sin conexión ni credenciales reales.

- `src/lib/env.ts` valida `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, y falla con un mensaje claro si faltan.
- `src/lib/supabase/browser.ts` expone un cliente de navegador con `anon key`.
- `src/lib/supabase/server.ts` crea un cliente por request con cookies usando
  `@supabase/ssr`.
- La `service_role key` nunca se usa en el cliente ni se prefija con
  `NEXT_PUBLIC_`. Solo podrá usarse en scripts de servidor autorizados.

Etapa 2 (autenticación) agregará:

- `proxy.ts` de Next.js 16 (reemplaza `middleware.ts`) para refrescar sesión.
- Gestión de sesión y redirecciones por rol.
- Generación de tipos de base de datos (`supabase gen types typescript`) una vez
  existan tablas aprobadas.

No se define ORM: el acceso será mediante el SDK de Supabase y SQL explícito en
migraciones.

## 7. Autenticación y autorización

Autenticación: Supabase Auth (email + contraseña, recuperación de contraseña y
cambio obligatorio de contraseña provisoria si se adopta ese mecanismo).

Roles del MVP:

| Rol             | Alcance                                             |
| --------------- | --------------------------------------------------- |
| `ADMINISTRADOR` | Usuarios, roles y configuración general.            |
| `COORDINADOR`   | Brigadistas, convocatorias, respuestas y cierre.    |
| `BRIGADISTA`    | Disponibilidad propia y respuestas a convocatorias. |

Autorización en tres capas:

1. Interfaz: oculta acciones no permitidas, solo como ayuda de experiencia.
2. Servidor: valida sesión y rol antes de ejecutar server actions o route
   handlers.
3. Base de datos: RLS obligatorio en tablas expuestas; restricciones e índices
   para invariantes de negocio.

El rol no se confía desde el cliente. Se obtiene del perfil asociado al usuario
autenticado en el servidor o dentro de políticas RLS.

## 8. Estrategia de seguridad RLS

Reglas de diseño:

- RLS habilitado en toda tabla expuesta a PostgREST.
- Política por defecto: denegar. Se habilita explícitamente por rol y operación.
- Un brigadista solo puede leer y actualizar su propia disponibilidad, y crear
  su propia respuesta a una convocatoria.
- Un coordinador puede leer la brigada y gestionar convocatorias y respuestas.
- Un administrador puede gestionar perfiles, roles y estado activo.
- Los usuarios desactivados no reciben nuevas convocatorias (RN-07). La
  condición debe aplicarse en la consulta y en la política, no solo en la UI.
- Las tablas de historial y notificaciones son de escritura controlada y
  lectura según rol; no se permite alterar registros históricos desde el cliente.
- Las políticas RLS se crean en la misma migración que la tabla.
- Cada política debe tener pruebas de acceso permitido y denegado por rol.

Invariantes que se reforzarán en la base de datos:

- Una sola convocatoria activa (RN-05), mediante índice único parcial o
  restricción equivalente, no solo validación de interfaz.
- Una sola respuesta por brigadista y convocatoria.
- Respuestas cerradas cuando la convocatoria se cierra, según la regla aprobada.
- Fechas en `timestamptz` y almacenamiento consistente en UTC.

El detalle operativo está en `docs/database-migrations.md`.

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
- No hay autenticación ni sesiones.
- No hay tablas de negocio ni migraciones aplicadas.
- No hay conexión a un proyecto Supabase real.
- No hay notificaciones ni service worker.
- No hay despliegue.

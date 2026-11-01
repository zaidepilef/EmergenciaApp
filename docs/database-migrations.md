# Estrategia de migraciones PostgreSQL

La base de datos se administra con Supabase (PostgreSQL) y se versiona mediante
migraciones SQL. La Etapa 0 no crea tablas de negocio: solo deja la estructura y
el flujo definidos.

## 1. Herramientas

- Supabase CLI 2.122.0, fijada como devDependency.
- Configuración local en `supabase/config.toml`.
- Migraciones en `supabase/migrations/`.
- Supabase local requiere Docker.

Comandos:

```bash
npm run db:start
npm run db:status
npm run db:migration:new -- <nombre_descriptivo>
npm run db:reset
npm run db:lint
```

## 2. Flujo de trabajo

1. Validar el modelo de datos y las reglas antes de escribir SQL.
2. Crear la migración con `db:migration:new`. El CLI genera el timestamp.
3. Escribir SQL explícito: tablas, claves, restricciones, índices, RLS y
   políticas.
4. Aplicar en local con `db:reset` (o `supabase migration up`).
5. Probar reglas e integridad con datos locales y pruebas de integración.
6. Versionar la migración junto con el cambio de código.
7. Repetir en un entorno limpio para verificar que la migración es reproducible.

Reglas:

- No editar migraciones ya aplicadas o compartidas; crear una nueva.
- No crear tablas directamente desde el dashboard para luego "copiar" SQL sin
  revisión.
- No usar `db push` contra un proyecto remoto sin autorización explícita.
- No incluir credenciales, datos personales reales ni secretos en migraciones o
  seeds.

## 3. Convenciones SQL

- Claves primarias `uuid` con `gen_random_uuid()`.
- Fechas y horas en `timestamptz`, almacenadas en UTC. La presentación usa la
  zona horaria configurada para la brigada (pendiente de definir).
- Columnas obligatorias con `not null` y valores por defecto explícitos.
- Claves foráneas con `on delete` definido según el caso; nunca por accidente.
- Restricciones `check` para estados y enums acotados.
- Índices para claves foráneas y consultas frecuentes (estado, convocatoria
  activa, respuestas por convocatoria).
- Nombres en `snake_case`; tablas en plural.
- Comentarios SQL (`comment on`) para reglas no evidentes.

## 4. Invariantes de negocio en la base

La base debe impedir estados inválidos aunque falle la interfaz:

- **RN-05 — una sola convocatoria activa:** índice único parcial sobre el estado
  activo, por ejemplo `unique (status) where status = 'activa'`, o una columna
  generada equivalente. Probar activaciones concurrentes.
- **Respuesta única:** restricción única `(emergency_id, brigadista_id)`.
- **Estados válidos:** `check` para disponibilidad (`DISPONIBLE`,
  `NO_DISPONIBLE`, `EN_SERVICIO`) y respuesta (`VOY`, `NO_PUEDO`).
- **Historial:** registros de disponibilidad y notificaciones sin actualización
  libre desde el cliente; idealmente append-only.
- **Usuarios desactivados:** la consulta de destinatarios excluye
  `activo = false` (RN-07).
- **Cierre de convocatoria:** definir en la misma migración si se bloquean
  nuevas respuestas y cómo se conservan las existentes.

No se duplican datos de autenticación que ya administra Supabase Auth. El perfil
referencia `auth.users` y guarda solo lo necesario.

## 5. RLS en migraciones

Cada tabla expuesta se crea con:

```sql
alter table public.<tabla> enable row level security;
```

Luego se agregan políticas explícitas por operación y rol. Sin política, el
acceso queda denegado. Toda política debe tener pruebas de acceso permitido y
denegado.

Buenas prácticas:

- Evitar políticas recursivas; usar funciones `stable` o `security definer` con
  `search_path` fijado cuando sea necesario.
- No confiar en un rol enviado por el cliente.
- Revisar que las operaciones de servidor con `service_role` sean acotadas y
  auditables.
- Probar RLS con tokens de cada rol, no solo con la clave anónima.

## 6. Seeds y datos de prueba

- `supabase/seed.sql` se usa solo para desarrollo y pruebas locales.
- Nunca incluir datos personales reales.
- Los seeds deben ser idempotentes o ejecutarse sobre una base recién recreada.
- No versionar claves ni contraseñas reales; usar valores ficticios.

## 7. Estado actual

- `supabase/config.toml` inicializado.
- Sin migraciones y sin tablas de negocio.
- El modelo de datos del README es una propuesta; debe validarse antes de crear
  la primera migración.

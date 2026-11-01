# Configuración del entorno local

Guía para preparar y ejecutar Brigada Emergencias en una máquina de desarrollo.

## 1. Requisitos

| Herramienta  | Versión validada | Notas                                                                 |
| ------------ | ---------------- | --------------------------------------------------------------------- |
| Node.js      | 24.19.0 (LTS)    | `package.json` exige `>=24.0.0`. Ver `.nvmrc`.                        |
| npm          | 11.17.0          | Fijado en `packageManager`.                                           |
| Git          | 2.53.0           | Control de versiones.                                                 |
| Docker       | 29.7.2           | Necesario para Supabase local en etapas posteriores.                  |
| Supabase CLI | 2.122.0          | Instalada como devDependency (`npm run db:*`).                        |
| OpenSpec CLI | 1.7.0            | Herramienta global para especificaciones; estructura ya inicializada. |

No se requiere una cuenta ni credenciales reales de Supabase para la Etapa 0.

## 2. Instalación

```bash
nvm use            # opcional, toma la versión de .nvmrc
npm ci             # instalación reproducible desde package-lock.json
cp .env.example .env.local
npm run dev
```

La aplicación queda en `http://localhost:3000`.

Si todavía no existe `package-lock.json`, ejecutar `npm install` una vez y
versionar el lockfile generado.

## 3. Variables de entorno

Archivo local: `.env.local` (ignorado por Git). Plantilla: `.env.example`.

| Variable                        | Ámbito             | Obligatoria | Descripción                                     |
| ------------------------------- | ------------------ | ----------- | ----------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Cliente y servidor | Sí          | URL del proyecto Supabase (local o remoto).     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente y servidor | Sí          | Clave anónima pública; RLS protege los datos.   |
| `NEXT_PUBLIC_APP_URL`           | Público            | No          | URL base de la aplicación.                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Solo servidor      | No          | Nunca debe llegar al cliente ni al repositorio. |

Reglas:

- No versionar `.env.local` ni archivos `.env*` con valores reales.
- No prefijar secretos con `NEXT_PUBLIC_`: ese prefijo los expone al navegador.
- La `service_role key` omite RLS. Usarla solo en scripts de servidor
  autorizados, nunca en componentes, server actions expuestas ni logs.
- Si faltan las variables públicas, `src/lib/env.ts` lanza un error explícito.

## 4. Comandos

| Comando                                | Propósito                                               |
| -------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                          | Servidor de desarrollo (Turbopack).                     |
| `npm run build`                        | Build de producción.                                    |
| `npm run start`                        | Servir el build de producción.                          |
| `npm run lint`                         | ESLint sobre todo el proyecto.                          |
| `npm run lint:fix`                     | ESLint con autocorrección.                              |
| `npm run typecheck`                    | Genera tipos de rutas y verifica TypeScript sin emitir. |
| `npm run check`                        | Ejecuta lint, typecheck y pruebas unitarias.            |
| `npm test`                             | Pruebas unitarias (Vitest, una sola ejecución).         |
| `npm run test:watch`                   | Vitest en modo watch.                                   |
| `npm run test:coverage`                | Cobertura con V8.                                       |
| `npm run format`                       | Prettier sobre el proyecto.                             |
| `npm run format:check`                 | Verifica formato sin escribir.                          |
| `npm run db:start`                     | Inicia Supabase local (Docker).                         |
| `npm run db:stop`                      | Detiene Supabase local.                                 |
| `npm run db:status`                    | Muestra URLs y claves locales.                          |
| `npm run db:reset`                     | Recrea la base local y aplica migraciones.              |
| `npm run db:migration:new -- <nombre>` | Crea una migración vacía.                               |
| `npm run db:lint`                      | Lint de la base local.                                  |

Validación recomendada antes de cada entrega:

```bash
npm run check && npm run build
```

## 5. Supabase local (etapas posteriores)

La Etapa 0 no crea tablas ni requiere Supabase en ejecución. Cuando comience la
Etapa 2:

```bash
npm run db:start
npm run db:status   # copiar API URL y anon key a .env.local
npm run db:reset    # aplicar migraciones locales
```

- Supabase local usa Docker y puertos propios (por defecto 54321 para la API).
- No usar credenciales de producción en desarrollo.
- No ejecutar `supabase db push` ni operaciones remotas sin autorización
  explícita.
- Las claves que imprime `db:status` son locales y descartables; aun así no se
  versionan archivos `.env*` con valores.

## 6. PWA en desarrollo

- El manifest está disponible en `/manifest.webmanifest`.
- El service worker y la estrategia offline todavía no están implementados.
- Para probar instalación o comportamiento PWA se recomienda un build de
  producción (`npm run build && npm run start`), no el servidor de desarrollo.

## 7. OpenSpec

La estructura ya está inicializada:

```text
openspec/
├── config.yaml
├── specs/          Especificaciones aprobadas (vacío por ahora)
└── changes/        Propuestas de cambio
    └── archive/    Cambios completados
```

Comandos útiles:

```bash
openspec list              # cambios activos
openspec list --specs      # especificaciones
openspec validate --all    # validar todo
openspec doctor            # estado del workspace
```

No se crean especificaciones de funcionalidades hasta que el alcance esté
aprobado. En OpenCode, el flujo comienza con `/opsx-propose "<idea>"`.

## 8. Problemas frecuentes

| Síntoma                                | Causa probable                            | Acción                                            |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `Faltan variables de entorno públicas` | No existe `.env.local` o está incompleto. | Copiar `.env.example` y completar.                |
| Error de versión de Node               | Node distinto de 24.x.                    | `nvm use` y reinstalar dependencias.              |
| `supabase: command not found`          | Se ejecutó fuera de los scripts npm.      | Usar `npm run db:*` o `npx supabase`.             |
| Docker no disponible                   | Servicio detenido o sin permisos.         | Iniciar Docker y verificar `docker ps`.           |
| Tailwind no aplica estilos             | Regla de Turbopack alterada.              | Revisar `next.config.ts` y `src/app/globals.css`. |
| Puerto 3000 ocupado                    | Otro proceso en uso.                      | `next dev -p 3001` o liberar el puerto.           |

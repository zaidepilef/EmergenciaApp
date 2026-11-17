# Configuración del entorno local

Guía para preparar y ejecutar Brigada Emergencias en una máquina de desarrollo.

## 1. Requisitos

| Herramienta    | Versión validada | Notas                                                                 |
| -------------- | ---------------- | --------------------------------------------------------------------- |
| Node.js        | 24.19.0 (LTS)    | `package.json` exige `>=24.0.0`. Ver `.nvmrc`.                        |
| npm            | 11.17.0          | Fijado en `packageManager`.                                           |
| Git            | 2.53.0           | Control de versiones.                                                 |
| Docker         | 29.7.2           | Requerido para MongoDB local de desarrollo.                           |
| Docker Compose | 5.3.1            | Levanta el contenedor de MongoDB y su replica set.                    |
| OpenSpec CLI   | 1.7.0            | Herramienta global para especificaciones; estructura ya inicializada. |

MongoDB Atlas se usará en producción. El desarrollo local prioriza el contenedor
de MongoDB definido en `compose.yaml`.

## 2. Instalación

```bash
nvm use            # opcional, toma la versión de .nvmrc
npm ci             # instalación reproducible desde package-lock.json
cp .env.example .env.local
npm run db:up      # MongoDB local en Docker con replica set rs0
npm run dev
```

La aplicación queda en `http://localhost:3000`. MongoDB local queda disponible en
`127.0.0.1:27018`; la aplicación todavía no se conecta ni crea colecciones en la
Etapa 0.

Si todavía no existe `package-lock.json`, ejecutar `npm install` una vez y
versionar el lockfile generado.

## 3. Variables de entorno

Archivo local: `.env.local` (ignorado por Git). Plantilla: `.env.example`.

| Variable      | Ámbito        | Obligatoria | Descripción                                                   |
| ------------- | ------------- | ----------- | ------------------------------------------------------------- |
| `MONGODB_URI` | Solo servidor | Sí          | MongoDB local por defecto; en producción, cadena de Atlas.    |
| `MONGODB_DB`  | Solo servidor | No          | Nombre de la base lógica; por defecto `brigada_emergencias`.  |
| `AUTH_SECRET` | Solo servidor | Sí          | Secreto de Auth.js, mínimo 32 caracteres.                     |
| `AUTH_URL`    | Servidor      | No          | URL base usada por Auth.js; en local `http://localhost:3000`. |

Reglas:

- No versionar `.env.local` ni archivos `.env*` con valores reales.
- No prefijar secretos con `NEXT_PUBLIC_`: ese prefijo los expone al navegador.
- `MONGODB_URI` y `AUTH_SECRET` nunca se importan en componentes de cliente.
- No usar credenciales de producción en desarrollo.
- Si faltan variables obligatorias o son inválidas, `src/lib/env.ts` lanza un
  error explícito al leerlas.
- Generar un secreto local con `openssl rand -base64 32` o `npx auth secret`.
  No reutilizar el secreto de producción.

## 4. Comandos

| Comando                 | Propósito                                               |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Servidor de desarrollo (Turbopack).                     |
| `npm run build`         | Build de producción.                                    |
| `npm run start`         | Servir el build de producción.                          |
| `npm run lint`          | ESLint sobre todo el proyecto.                          |
| `npm run lint:fix`      | ESLint con autocorrección.                              |
| `npm run typecheck`     | Genera tipos de rutas y verifica TypeScript sin emitir. |
| `npm run check`         | Ejecuta lint, typecheck y pruebas unitarias.            |
| `npm test`              | Pruebas unitarias (Vitest, una sola ejecución).         |
| `npm run test:watch`    | Vitest en modo watch.                                   |
| `npm run test:coverage` | Cobertura con V8.                                       |
| `npm run db:up`         | Levanta MongoDB local y espera el replica set.          |
| `npm run db:down`       | Detiene el contenedor sin borrar datos.                 |
| `npm run db:status`     | Muestra el estado del contenedor.                       |
| `npm run db:logs`       | Sigue los logs de MongoDB.                              |
| `npm run db:shell`      | Abre `mongosh` en la base local.                        |
| `npm run db:reset`      | Borra el volumen local y recrea MongoDB (destructivo).  |
| `npm run format`        | Prettier sobre el proyecto.                             |
| `npm run format:check`  | Verifica formato sin escribir.                          |

Validación recomendada antes de cada entrega:

```bash
npm run check && npm run build
```

## 5. MongoDB local con Docker

`compose.yaml` levanta MongoDB 8.2.12 en `127.0.0.1:27018` con el replica set
`rs0`. El puerto 27018 evita conflictos con otras instancias que puedan usar el 27017. El puerto solo se publica en `127.0.0.1`, así que no queda expuesto a la red
local.

```bash
npm run db:up       # docker compose up -d --wait mongo
npm run db:status
npm run db:shell    # mongosh sobre brigada_emergencias
```

Detalles:

- El healthcheck inicia `rs0` y `--wait` espera a que exista un primary. Las
  transacciones requieren replica set.
- Los datos persisten en el volumen `brigada-emergencias_mongo_data`.
- `npm run db:down` detiene el contenedor y conserva los datos.
- `npm run db:reset` elimina el volumen y vuelve a crear la base. Es destructivo:
  usarlo solo en desarrollo.
- La URI local por defecto está en `.env.example`:
  `mongodb://127.0.0.1:27018/?replicaSet=rs0`.
- MongoDB local no tiene autenticación porque el puerto solo se publica en
  loopback del host. No exponerlo a la red ni cargar datos personales reales.
- Si el puerto 27018 está ocupado, cambiar el puerto en `compose.yaml` y en
  `MONGODB_URI`.
- Todavía no se crean colecciones ni se conecta la aplicación.

### 5.1 MongoDB Atlas para producción

Cuando se prepare el despliegue:

1. Crear un cluster y una base lógica exclusiva para la aplicación.
2. Crear un usuario de base de datos con permisos solo sobre esa base. No usar un
   usuario administrador del clúster.
3. Restringir el acceso de red a las IP necesarias.
4. Copiar la cadena `mongodb+srv://...` a `MONGODB_URI` en el entorno de
   producción.
5. Aplicar las migraciones de colecciones, validadores e índices antes de cargar
   datos.

Reglas:

- Mantener bases separadas para desarrollo, pruebas y producción.
- No ejecutar migraciones ni scripts contra producción sin autorización.
- No cargar datos personales reales en desarrollo.
- No usar una única base compartida entre personas sin coordinar migraciones.

## 6. Auth.js (etapa posterior)

La Etapa 0 no implementa login. Cuando se implemente:

- `AUTH_SECRET` debe ser distinto por entorno.
- Credentials Provider usará RUT y contraseña; la sesión será JWT.
- La cookie de sesión será `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- La protección gruesa de rutas podrá vivir en `src/proxy.ts` (convención de Next
  16). La autorización fina se repetirá en cada server action o route handler.
- El diseño completo está en `docs/authentication.md`.

## 7. PWA en desarrollo

- El manifest está disponible en `/manifest.webmanifest`.
- El service worker y la estrategia offline todavía no están implementados.
- Para probar instalación o comportamiento PWA se recomienda un build de
  producción (`npm run build && npm run start`), no el servidor de desarrollo.

## 8. OpenSpec

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

## 9. Problemas frecuentes

| Síntoma                                    | Causa probable                            | Acción                                            |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------------------- |
| `Faltan variables de entorno del servidor` | No existe `.env.local` o está incompleto. | Copiar `.env.example` y completar.                |
| `MONGODB_URI debe comenzar...`             | Cadena mal formada o con espacios.        | Revisar la URI local o la de Atlas.               |
| `AUTH_SECRET debe tener...`                | Secreto corto o vacío.                    | Generar uno nuevo de al menos 32 caracteres.      |
| Error de versión de Node                   | Node distinto de 24.x.                    | `nvm use` y reinstalar dependencias.              |
| Docker no disponible                       | Servicio detenido o sin permisos.         | Iniciar Docker y verificar `docker ps`.           |
| Contenedor MongoDB unhealthy               | `rs0` no inició o el puerto está ocupado. | Revisar `npm run db:logs` y `npm run db:reset`.   |
| Puerto 27018 ocupado                       | Otra instancia de MongoDB en uso.         | Cambiar puerto en `compose.yaml` y `MONGODB_URI`. |
| Error de conexión a Atlas                  | IP no permitida, credenciales o DNS SRV.  | Revisar acceso de red, usuario y cadena de Atlas. |
| Tailwind no aplica estilos                 | Regla de Turbopack alterada.              | Revisar `next.config.ts` y `src/app/globals.css`. |
| Puerto 3000 ocupado                        | Otro proceso en uso.                      | `next dev -p 3001` o liberar el puerto.           |

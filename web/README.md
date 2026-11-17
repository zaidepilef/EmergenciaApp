# Web — dashboard del coordinador

> **Estado (2026-11-16):** demo conectada a la API real. Next.js 16 (App Router)
> + Tailwind 4. Falta lo que pide la arquitectura definitiva (ver abajo).

## Qué hace

- **Login con RUT** (`clientType: WEB`, sesión de 12 h). Solo entran cuentas con
  `COORD` o `ADMIN`.
- **Convocatoria activa**: conteo `VOY` / `NO_PUEDO` / sin respuesta, tabla de
  convocados con filtros, llegada del aviso (separada de la respuesta), lista
  "Llamar primero" y avisos enviados. Se actualiza cada 10 s.
- **Crear y activar** una convocatoria (convoca a todos los brigadistas activos).
  El `id` lo genera el navegador (UUID v7), así un reintento no la duplica.
- **Cerrar** la convocatoria, con confirmación en la misma página y mensaje opcional.
- **Brigadistas**: lista con su disponibilidad declarada (con antigüedad y marca
  de desactualizada a las 4 h), filtros por disponibilidad, historial de cambios
  de cada uno y la preparación del teléfono. Todo es informativo: no filtra a
  quién se convoca.
- **Sin convocatoria activa**: conteo por disponibilidad (disponible, no
  disponible, en servicio, desactualizada y sin declarar).

## Arquitectura (BFF)

El navegador nunca ve los tokens. Next.js los guarda en cookies `httpOnly`
(`SameSite=Lax`, `Secure` en producción) y llama a la API desde el servidor.

| Ruta | Qué hace |
| --- | --- |
| `/login` (Server Action) | `POST /v1/auth/login` y guarda las cookies |
| `GET /bff/state` | Un sondeo con `me`, resumen activo, convocados, avisos y brigadistas |
| `POST /bff/emergencies` | Crea el borrador y lo activa |
| `POST /bff/emergencies/{id}/close` | Cierra |
| `GET /bff/brigadistas/{id}/availability` | Historial de disponibilidad (50 cambios) |
| Cerrar sesión (Server Action) | `POST /v1/auth/logout` y borra las cookies |

Si el token de acceso venció, el BFF renueva una vez con el refresh token y
reintenta. Las mutaciones exigen que `Origin` coincida con `Host`.

Código: `src/lib/api.ts` (cliente de la API y cookies), `src/app/bff/` (rutas),
`src/app/Dashboard.tsx` (panel).

## Correr

Requiere la API en `http://127.0.0.1:3000` (ver [`../backend/README.md`](../backend/README.md)).

```bash
npm ci
cp .env.example .env.local
npm run dev        # http://localhost:3001
```

Usuario de prueba: RUT `16.200.587-1`, contraseña `Brigada2026!`
(administrador y coordinador). Para volver a los datos iniciales:
`cd ../backend && npm run db:seed`.

## Pendiente

- Tipos generados desde OpenAPI (`openapi-typescript`); hoy `src/lib/types.ts` es
  un subconjunto escrito a mano.
- Pruebas Vitest + Testing Library + Playwright.
- Validación de RUT en el formulario con `packages/shared/`.
- Uso de `ETag` / `304` en el sondeo, paginación de brigadistas, avisos de
  actualización, revisiones pendientes y administración de usuarios.
- Revisión de diseño por ui-ux-designer.

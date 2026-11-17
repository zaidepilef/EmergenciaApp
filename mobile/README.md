# mobile/ — demo conectada a la API local

> **Estado: DEMO.** No es la app del MVP. Inicia sesión con RUT contra
> `backend/`, descarga la convocatoria activa y envía VOY / NO PUEDO por
> `/v1/sync/push`, también sin conexión. La arquitectura móvil (SQLite, push,
> sincronización completa) la define mobile-architect.

Stack: Expo SDK 58 + React Native (decisión del proyecto, ver `AGENTS.md`).

## Levantar la demo

1. Base y API (en `backend/`): `npm run db:up`, `npm run db:seed`, `npm run dev`.
2. App (aquí): `npm install` la primera vez y `npx expo start`.
3. Teléfono Android en la **misma Wi-Fi** que el PC: abre **Expo Go** y escanea
   el QR. La app usa la IP del PC y el puerto 3000 (o `EXPO_PUBLIC_API_URL`).
   El Firewall de Windows debe permitir Node.js en redes privadas (puertos
   8081 y 3000).
4. Usuario de prueba: RUT `16.200.587-1`, contraseña `Brigada2026!`.

## Qué hace

- Login con RUT (registra el dispositivo con un `device.id` UUID v7) y renovación del token.
- Convocatoria activa desde el servidor, revisada cada 10 s y al reconectar.
- VOY / NO PUEDO: la respuesta se guarda primero en el teléfono como operación
  con `operationId` y `deviceSeq`, y después se envía. Sin red (real o con el
  interruptor "Sin conexión") queda pendiente y se envía sola al volver.
- Acuse `OPENED` de cada aviso mostrado.
- **Mi disponibilidad**: Disponible, No disponible o En servicio, con o sin
  conexión (operación `DECLARE_AVAILABILITY` en la misma cola). Muestra hace cuánto
  se declaró y, pasadas 4 h, pregunta "¿Sigue vigente?". Es informativa: no
  responde la convocatoria.
- **Primer ingreso con contraseña provisoria** (cuenta creada en el panel): pide
  crear una contraseña propia antes de mostrar convocatorias (`/v1/auth/password`).

## Limitaciones de la demo

- Persistencia en SecureStore (no SQLite); sin `/v1/sync/pull`.
- Sin notificaciones push; el cambio de contraseña voluntario (con sesión completa) no tiene pantalla.
- El reloj monotónico es `performance.now()` del proceso de la app.

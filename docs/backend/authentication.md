# Autenticación y sesiones

> **PROPUESTA PARA APROBACIÓN.** Implementa las garantías de
> [`docs/database/security.md`](../database/security.md) (database-architect) y
> reutiliza las reglas de [`docs/archive/pwa-mongodb/authentication.md`](../archive/pwa-mongodb/authentication.md)
> (arquitectura anterior), cambiando Auth.js por tokens propios de la API.

## 1. Credenciales

- **RUT:** se acepta con o sin puntos y guion; se normaliza a la forma canónica
  `12345678-5` (K mayúscula) y se valida el dígito verificador (módulo 11) con
  `packages/shared/rut`. La base solo verifica el formato (`app_user_rut_format_chk`).
- **Contraseñas:** Argon2id con `@node-rs/argon2` 2.2 (memoria 19 MiB,
  2 iteraciones, paralelismo 1, los mínimos de OWASP; a medir en el VPS). Largo
  mínimo 10, máximo 128; se rechazan las que contienen el RUT.
- **Usuario inexistente:** se verifica igual contra un hash ficticio, para que el
  tiempo de respuesta no revele qué RUT existen. Mensaje siempre genérico:
  "RUT o contraseña incorrectos".

## 2. Tokens

| Token | Forma | Vida | Dónde vive |
|---|---|---|---|
| Acceso | JWT firmado (`jose` 6.2, EdDSA Ed25519). Claims: `sub` (user id), `sid` (sesión), `cv` (`credential_version`), `scope`, `exp`. **Sin rol** | 10 min | Móvil: memoria y SecureStore. Web: cookie `httpOnly` del BFF |
| Renovación | 32 bytes aleatorios en base64url, opaco | 30 días móvil · 12 h web (a confirmar, D-B2) | Igual que el de acceso. En la base solo `sha256(token)` en `auth_session.refresh_token_hash` |

El token de renovación es aleatorio de alta entropía: basta SHA-256 para
guardarlo (no necesita Argon2) y permite buscarlo por índice único.

Cada petición autenticada:

1. Verifica firma y vencimiento del JWT.
2. Lee en **una consulta** `app_user` (activo, `credential_version`), sus roles,
   su perfil de brigadista y `auth_session` (no revocada).
3. Rechaza con `401` si el usuario está inactivo, la sesión revocada o `cv` no
   coincide. Así desactivar o restablecer surte efecto en la siguiente petición,
   no al vencer el token. Con el volumen del MVP (una brigada) es una búsqueda
   por clave primaria; no hace falta caché.

## 3. Flujos

**Login** (`POST /v1/auth/login`): rate limit → buscar por RUT → Argon2 →
si `must_change_password` y venció → rechazo genérico → en una transacción:
upsert de `device` (móvil), `auth_session` nueva con `family_id` nuevo,
`scope = FULL` o `PASSWORD_CHANGE_ONLY`, `last_login_at`, `audit_log`.

**Renovación** (`POST /v1/auth/refresh`), en una transacción:

1. Buscar la sesión por `sha256(token)`.
2. `SELECT … FROM app_user WHERE id = … FOR UPDATE` (serializa con
   restablecimientos, `security.md` §3).
3. Si la sesión ya fue reemplazada (`replaced_by_id` no nulo) → **reutilización**:
   revocar toda la familia con `REUSE_DETECTED` y responder `401`.
4. Si está revocada, vencida, el usuario inactivo o `credential_version` cambió
   → `401`.
5. Crear la sesión sucesora (misma familia), marcar la anterior `ROTATED` con
   `replaced_by_id`.

Tolerancia de reintento: si la app perdió la respuesta de una renovación y
reintenta con el token anterior en los **10 segundos** siguientes, ¿es
reutilización? Revocar la familia dejaría al brigadista fuera en plena
emergencia por un corte de red. Propuesta: dentro de esa ventana se devuelve
`409 REFRESH_RACE` sin revocar, y la app reintenta con el token más nuevo que
tenga; si no lo tiene, vuelve al login. A validar con mobile-architect.

**Contraseña provisoria** (alta y restablecimiento, Q6): exactamente el flujo
de `security.md` §2. Con `scope = PASSWORD_CHANGE_ONLY` solo responden
`/v1/auth/password`, `/v1/auth/logout` y `/v1/me`; el resto da
`403 PASSWORD_CHANGE_REQUIRED`. El cambio revoca la sesión restringida y emite
una `FULL` en la misma transacción.

**Cierre de sesión:** revoca la sesión actual (`LOGOUT`). El móvil además
borra su base local y sus tokens (mobile-architect).

**Desactivación, dispositivo revocado, cambio de rol:** según la tabla de
`security.md` §3.

## 4. Cliente web (BFF)

- El navegador nunca ve los tokens: el servidor Next.js llama a
  `/v1/auth/login` y guarda acceso y renovación en cookies `httpOnly`,
  `Secure`, `SameSite=Lax`, ruta `/` (diseño de web-architect).
- Las sesiones web se crean con `client_type = WEB` y sin `device_id`.
- La API recibe del BFF `Authorization: Bearer …`. El BFF llama a la API por la
  red interna; CORS no aplica a esa llamada y la API no necesita permitir el
  origen del navegador (`CORS_ORIGINS` vacío en el MVP).
- Protección CSRF del lado del BFF (cookies `SameSite` + verificación de
  origen); es alcance de web-architect.

## 5. Rate limiting

| Ruta | Límite propuesto | Clave |
|---|---|---|
| `POST /v1/auth/login` | 10 / 15 min | IP |
| `POST /v1/auth/login` | 5 / 15 min | RUT normalizado |
| `POST /v1/auth/refresh` | 30 / min | IP |
| `POST /v1/auth/password` | 5 / 15 min | usuario |
| Resto | 300 / min | usuario o IP |

Almacén en memoria (`@fastify/rate-limit`): válido mientras haya **una**
instancia de la API, que es el plan del MVP. Si se escala a varias, pasar a un
almacén compartido. Detrás del proxy TLS, la IP real se toma de
`X-Forwarded-For` solo si viene del proxy de confianza (`trustProxy` acotado,
coordinado con devops-architect).

El límite por RUT puede usarse para bloquear a un brigadista ajeno a propósito.
Mitigación: el bloqueo es temporal (15 min) y el administrador puede
restablecer; se registra en `audit_log` sin el RUT completo.

## 6. Pruebas obligatorias

Las 7 de `security.md` §4, más: tiempo de respuesta similar para RUT
inexistente; ventana `REFRESH_RACE`; claims del JWT sin rol; la API rechaza un
JWT firmado con otra clave o con `alg: none`.

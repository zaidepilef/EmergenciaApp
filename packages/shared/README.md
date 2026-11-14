# @emergencia/shared

Código común a backend, web y mobile. Dueño: backend-architect.

> **Estado (2026-11-13):** implementado y probado el módulo de RUT. Cómo lo
> consume cada proyecto (workspaces de npm, ruta local o publicación interna) se
> decide al crear `web/` y `mobile/`; el backend lo consume desde la etapa 2.

## RUT (`@emergencia/shared/rut`)

| Función | Uso |
|---|---|
| `parseRut(input)` | `{ ok: true, rut, body, verifier }` o `{ ok: false, error }` con `RUT_EMPTY`, `RUT_INVALID_FORMAT` o `RUT_INVALID_VERIFIER` |
| `normalizeRut(input)` | Forma canónica `12345678-5` o `null` |
| `isValidRut(input)` | `true` si el formato y el dígito verificador son válidos |
| `isCanonicalRut(value)` | `true` si ya está exactamente en forma canónica |
| `computeRutVerifier(body)` | Dígito verificador (módulo 11) |
| `formatRut(input)` | Para mostrar: `12.345.678-5` |
| `maskRut(input)` | Para logs y auditoría: `12.***.***-5` |

Entradas aceptadas: con puntos bien agrupados, sin puntos, con o sin guion,
`k` minúscula, espacios al borde y ceros a la izquierda. La forma canónica
coincide con la restricción `app_user_rut_format_chk` de PostgreSQL.

Los clientes validan para dar un mensaje temprano; **la decisión es siempre
del servidor**.

## Comandos

```sh
npm install
npm test          # Vitest
npm run typecheck
npm run build     # dist/ (JS + tipos)
```

Las pruebas usan RUT sintéticos. Nunca usar RUT reales.

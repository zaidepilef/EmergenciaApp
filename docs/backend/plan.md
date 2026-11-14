# Riesgos, plan por etapas y decisiones pendientes

> **Decisiones D-B1 a D-B6 APROBADAS por el usuario (2026-11-13)**, con las
> recomendaciones de la tabla. Etapa 1 cerrada: contrato v1 aprobado el 2026-11-14
> ([`openapi-v1.md`](openapi-v1.md)); la implementación (etapa 2) espera
> autorización.

## 1. Decisiones que se piden al usuario

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| D-B1 | Framework HTTP | **Fastify 5** (`architecture.md` §2) | Express 5 |
| D-B2 | Vida del token de renovación | 30 días móvil (un brigadista no debe tener que volver a escribir su contraseña en plena emergencia); 12 h web | Más corto en móvil, con más riesgo de quedar fuera durante una emergencia |
| D-B3 | Proveedor push | **Expo Push** detrás de una interfaz intercambiable (`push-delivery.md` §2), decidido con mobile-architect | FCM + APNs directo |
| D-B4 | "Configuración general" del administrador | Fuera del MVP hasta que tenga requisitos; los parámetros (4 h de desactualización, tiempos de re-aviso, vigencia de la provisoria) quedan como variables de entorno | Tabla de configuración editable desde el dashboard |
| D-B5 | Contrato primero | **Sí**: YAML aprobado antes de implementar (`architecture.md` §3) | Generar el YAML desde el código |
| D-B6 | Recuperación de contraseña | Solo restablecimiento por administrador (Q6). Correo fuera del MVP: exige un proveedor de correo (servicio externo y costo) | Correo con enlace de un solo uso |

## 2. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El contrato de sync cambia después de publicar la app | Teléfonos instalados dejan de sincronizar | Acordarlo antes de implementar; prefijo `/v1`; el servidor acepta campos desconocidos en `payload` y no los usa |
| Interbloqueos por el candado de versión | Operaciones que fallan bajo carga | Orden fijo (`sync-contract.md` §4.1), transacciones cortas, reintento de `40P01`, prueba de concurrencia |
| La transacción de activación crece con la brigada | Activación lenta, escrituras en serie | Inserciones masivas (`INSERT … SELECT`), push fuera de la transacción; medir con 200 brigadistas sintéticos |
| Expo Push no disponible | Avisos que no suenan | Bandeja interna + sync al abrir; re-aviso; el panel muestra "sin acuse"; plan manual (E11) |
| Rate limit en memoria | Se pierde al reiniciar; no sirve con varias instancias | Aceptado para una instancia; revisar si se escala |
| Bloqueo deliberado por RUT | Un brigadista no puede entrar | Bloqueo temporal, restablecimiento por administrador, auditoría |
| Reloj del teléfono | Orden incorrecto de respuestas | Ya resuelto en el modelo (`estimated_at`, ventana de 60 s, revisión) |
| Node 24 no instalado en el equipo de desarrollo | Diferencias locales | `.nvmrc`; CI con Node 24 (devops-architect) |

## 3. Plan por etapas

Cada etapa termina con pruebas en verde y un informe; la siguiente empieza con
aprobación.

| Etapa | Entrega | Depende de |
|---|---|---|
| 0 | **Esta propuesta** aprobada; decisiones D-B1…D-B6 | Usuario |
| 1 | `openapi.yaml` v1 completo (sin implementación) + `packages/shared/rut` con pruebas unitarias | Etapa 0; revisión de mobile-architect y web-architect |
| 2 | Esqueleto: Fastify, configuración, errores, logs, salud, carga del contrato, prueba de contrato; autenticación completa (login, renovación, logout, cambio de contraseña, `/v1/me`) con las pruebas de `authentication.md` §6 | Etapa 1 aprobada |
| 3 | Administración (usuarios, roles, perfil de brigadista, restablecimiento, auditoría) y convocatorias (borrador, activar, avisos, cerrar, reabrir, convocados tarde, respuestas en nombre, contacto manual, panel y polling) | Etapa 2 |
| 4 | Sync push y pull con todas las reglas de conflicto; revisiones (`sync-reviews`) | Etapa 3; contrato de sync acordado (§4 de `sync-contract.md`) |
| 5 | Worker de push con proveedor falso y luego Expo; `Dockerfile` y servicio local en `compose.yaml` | Etapa 3; D-B3 |
| 6 | Endurecimiento: `npm audit`, revisión de logs, prueba de carga de la activación, documentación final | Etapas 2–5 |

Web-architect puede empezar al cerrar la etapa 1 (contrato) y conectarse de
verdad al cerrar la 2 y la 3. Mobile-architect, igual con la 2 y la 4.

## 4. Estrategia de pruebas

| Tipo | Herramienta | Contra |
|---|---|---|
| Unitarias | Vitest | RUT, cálculo de `estimated_at`, reglas de conflicto, estado derivado del convocado, autorización |
| Integración | Vitest + `app.inject()` | PostgreSQL local de Docker (`emergencia_test`) **como rol de la aplicación** |
| Contrato | Vitest + Ajv | Cada respuesta contra `openapi.yaml`; rutas ↔ operaciones |
| Concurrencia | Vitest, varias conexiones | Activación vs. sync, renovación vs. restablecimiento, dos workers |

Nunca contra producción ni con datos reales; los RUT de prueba son sintéticos.

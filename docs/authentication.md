# Diseño de autenticación

Diseño conceptual para la Etapa 2. La Etapa 0 no implementa login, formulario,
sesiones ni conexión a MongoDB. Este documento define el comportamiento esperado
antes de escribir código.

## 1. Alcance

- Inicio de sesión con RUT chileno y contraseña.
- Contraseñas almacenadas con Argon2id.
- Usuarios activos e inactivos.
- Roles `ADMINISTRADOR`, `COORDINADOR` y `BRIGADISTA`.
- Sesión de servidor mediante Auth.js y cookies `HttpOnly`.
- Autorización por rol en el servidor.
- Recuperación y cambio obligatorio de contraseña quedan para una definición
  posterior, antes de habilitar el login en producción.

Fuera de alcance por ahora:

- Formulario o pantalla de login.
- Registro público de usuarios.
- Login con proveedores externos.
- Tokens en `localStorage` o `sessionStorage`.
- Implementación de recuperación de contraseña.

## 2. Flujo de inicio de sesión

1. El usuario envía RUT y contraseña a través de Auth.js Credentials Provider.
2. El servidor normaliza el RUT y valida su dígito verificador.
3. Si el formato es inválido, responde con un error genérico.
4. Busca el usuario por `rut` canónico en la colección `users`.
5. Verifica la contraseña con Argon2id. Si el usuario no existe, verifica contra
   un hash ficticio precalculado para reducir diferencias de tiempo.
6. Comprueba `active === true`. Un usuario inactivo no puede iniciar sesión.
7. Si algo falla, responde con el mismo mensaje genérico, sin distinguir entre
   RUT inexistente, contraseña incorrecta o usuario inactivo.
8. Si es correcto, Auth.js crea una sesión JWT y la cookie de sesión.
9. El token guarda solo `id`, `name` y `role`. Nunca incluye `passwordHash`, RUT
   completo ni datos sensibles adicionales.
10. Las operaciones sensibles vuelven a consultar `users` para verificar `active`
    y rol vigentes.

Los intentos fallidos y exitosos se auditan sin registrar contraseñas ni el RUT
completo.

## 3. Normalización y validación de RUT

Formatos de entrada aceptados:

- `12.345.678-5`
- `12345678-5`
- `123456785`
- Variantes con espacios y `k` minúscula.

Normalización:

1. Quitar puntos, espacios y guiones.
2. Convertir el dígito verificador a mayúscula.
3. Separar el último carácter como dígito verificador.
4. Quitar ceros a la izquierda del cuerpo.
5. Exigir cuerpo numérico de 1 a 8 dígitos y dígito verificador `0`-`9` o `K`.
6. Calcular el dígito verificador con módulo 11 y compararlo.
7. Guardar la forma canónica `12345678-5`, sin puntos y con `K` mayúscula.

Algoritmo módulo 11:

1. Recorrer el cuerpo de derecha a izquierda.
2. Multiplicar cada dígito por la secuencia 2, 3, 4, 5, 6, 7, repitiéndola.
3. Sumar los productos.
4. Calcular `11 - (suma % 11)`.
5. Si el resultado es 11, el dígito es `0`; si es 10, es `K`; en otro caso, es el
   número obtenido.

Ejemplo: `12.345.678-5` es válido; la suma ponderada es 138, el resto es 6 y el
dígito esperado es 5.

Reglas:

- La validación definitiva ocurre en el servidor. La validación en el cliente es
  solo ayuda de experiencia.
- El índice único de `users.rut` usa siempre la forma canónica para evitar
  duplicados por formatos distintos.
- El RUT no es un secreto, pero es dato personal: no se registra completo en logs
  y se enmascara en pantallas cuando no es necesario mostrarlo.
- No se agrega una librería externa para módulo 11; se implementa con pruebas
  unitarias siguiendo TDD.

## 4. Contraseñas

- Algoritmo: Argon2id mediante `@node-rs/argon2`.
- Parámetros iniciales recomendados: `memoryCost` 19 MiB (19456 KiB),
  `timeCost` 2, `parallelism` 1. Se ajustarán según el rendimiento del entorno de
  despliegue.
- El hash se calcula solo en el servidor. Nunca se guarda ni se registra la
  contraseña en texto plano.
- La verificación se hace con la función nativa del paquete, sin comparaciones
  manuales.
- Si los parámetros cambian, el hash se regenera en el próximo login exitoso.
- Política inicial sugerida: mínimo 12 caracteres, máximo 128, sin exigir
  composición artificial. La política definitiva queda pendiente.
- La contraseña provisoria y el cambio obligatorio se definirán antes de habilitar
  el alta de usuarios en producción.

## 5. Usuarios activos y cambio de rol

- `active` es la fuente de verdad para permitir el acceso.
- Un usuario desactivado no puede iniciar sesión.
- Si un usuario es desactivado con una sesión abierta, las operaciones sensibles
  fallan al volver a consultar `users`, aunque el JWT siga vigente.
- Un cambio de rol se aplica en la siguiente verificación del servidor. No se
  confía en el rol del token para mutaciones sensibles.
- El token es una caché de navegación, no una autorización definitiva.
- Si se necesita revocación inmediata de todas las sesiones, se evaluará un campo
  `tokenVersion` que invalide tokens emitidos antes de un cambio. No se implementa
  en la primera versión para evitar complejidad innecesaria.

## 6. Sesiones

- Estrategia de Auth.js: `jwt`, obligatoria para Credentials Provider.
- Cookie gestionada por Auth.js: `HttpOnly`, `SameSite=Lax`, `Secure` en
  producción.
- Duración recomendada: 8 horas, con renovación como máximo cada hora. La duración
  definitiva queda pendiente.
- `AUTH_SECRET` firma y cifra el token. Debe tener al menos 32 caracteres y
  rotarse solo con un plan que invalide sesiones.
- No se guardan tokens en almacenamiento accesible por JavaScript.
- El cierre de sesión elimina la cookie.
- `src/proxy.ts` (convención de Next 16) podrá hacer protección gruesa de rutas.
  La autorización fina siempre se repite en server actions y route handlers.

## 7. Autorización

| Operación                          | ADMINISTRADOR | COORDINADOR | BRIGADISTA |
| ---------------------------------- | ------------- | ----------- | ---------- |
| Gestionar usuarios y roles         | Sí            | No          | No         |
| Activar/desactivar brigadistas     | Sí            | Sí          | No         |
| Crear/activar/cerrar convocatorias | No            | Sí          | No         |
| Consultar respuestas de la brigada | No            | Sí          | No         |
| Actualizar disponibilidad propia   | No            | No          | Sí         |
| Responder convocatoria             | No            | No          | Sí         |
| Consultar historial propio         | No            | No          | Sí         |
| Consultar historial de la brigada  | Sí            | Sí          | No         |

Reglas:

- Toda operación protegida empieza por un helper del servidor que obtiene la
  sesión, carga el usuario y verifica `active` y rol.
- El rol enviado por el cliente se ignora.
- La interfaz puede ocultar acciones, pero el servidor siempre decide.
- Las pruebas deben cubrir, por rol, al menos un caso permitido y uno denegado.

## 8. Errores, auditoría y abuso

- Mensaje de login genérico: credenciales inválidas.
- Mismo camino y mensaje para usuario inexistente, inactivo o contraseña
  incorrecta.
- Verificación con hash ficticio cuando el usuario no existe para reducir
  diferencias de tiempo.
- Rate limiting por IP y por RUT antes de exponer el login en producción. El
  mecanismo y los umbrales quedan pendientes.
- Registro de auditoría de logins exitosos, fallidos y cambios de estado, sin
  contraseñas ni RUT completo.
- Bloqueo temporal o backoff ante intentos repetidos; se definirá junto con el
  rate limiting.
- No se devuelven detalles internos ni trazas al cliente.

## 9. Pruebas previstas

Unitarias:

- Normalización de RUT con puntos, espacios, guion y `k` minúscula.
- RUT válido, dígito verificador incorrecto, cuerpo vacío, cuerpo no numérico y
  longitud inválida.
- Verificación de contraseña correcta e incorrecta con Argon2id.
- `authorize`: usuario activo, inactivo, inexistente y contraseña incorrecta.
- El token y la sesión no contienen `passwordHash` ni RUT completo.
- Helpers de autorización: rol permitido, rol denegado y usuario inactivo.

Integración:

- Índice único de RUT canónico.
- Login contra una base de prueba con usuarios ficticios.
- Desactivación y cambio de rol reflejados en operaciones sensibles.
- Cookies de sesión con flags esperados.
- Matriz de permisos por rol.

## 10. Decisiones pendientes

- Duración definitiva de sesión y renovación.
- Parámetros finales de Argon2id.
- Política de contraseñas y cambio obligatorio.
- Flujo de recuperación de contraseña.
- Mecanismo y umbrales de rate limiting.
- Alta inicial de usuarios y entrega de contraseñas provisorias.
- Uso de `tokenVersion` para revocación inmediata.
- Enmascaramiento de RUT en cada pantalla.

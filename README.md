# Brigada Emergencias

Plataforma multiplataforma para gestionar la disponibilidad de
brigadistas y coordinar convocatorias ante emergencias.

El proyecto comienza con una **PWA adaptable a celulares y
computadores**. La arquitectura debe permitir una futura distribución
como aplicación Android y iOS mediante Capacitor.

> **Alcance del MVP:** una sola brigada, disponibilidad autogestionada,
> convocatorias de emergencia, respuestas de asistencia, notificaciones
> y panel de coordinación. No incluye GPS ni geolocalización.

## 1. Objetivo

Entregar a los brigadistas una forma sencilla de informar si pueden
acudir a una emergencia y permitir al coordinador conocer las respuestas
de la brigada cuando se active una convocatoria.

La disponibilidad declarada por un brigadista es informativa: no
reemplaza la confirmación de asistencia a una emergencia concreta.

## 2. Usuarios y roles

  -----------------------------------------------------------------------
  Rol                                 Responsabilidades
  ----------------------------------- -----------------------------------
  Administrador                       Gestionar usuarios, roles y
                                      configuración general.

  Coordinador                         Administrar brigadistas, crear y
                                      activar convocatorias, consultar
                                      respuestas y cerrar emergencias.

  Brigadista                          Actualizar su disponibilidad,
                                      recibir convocatorias y responder
                                      si puede asistir.
  -----------------------------------------------------------------------

Los permisos deben validarse en el backend y reforzarse mediante
políticas de seguridad de Supabase (RLS). Ocultar botones en la interfaz
no constituye una medida de seguridad.

## 3. Funcionalidades del MVP

### 3.1 Autenticación y usuarios

-   Inicio y cierre de sesión.
-   Recuperación de contraseña.
-   Administración de brigadistas.
-   Alta, activación y desactivación de integrantes.
-   Asignación de roles.
-   Primer acceso con cambio obligatorio de contraseña provisoria, si se
    utiliza ese mecanismo de alta.

### 3.2 Disponibilidad

Cada brigadista activo puede actualizar su estado en cualquier momento.

Estados funcionales:

-   **DISPONIBLE:** declara que puede ser convocado.
-   **NO_DISPONIBLE:** declara que no puede acudir en ese momento.
-   **EN_SERVICIO:** indica que participa efectivamente en una
    emergencia.

Reglas:

1.  Registrar fecha y hora de cada actualización.
2.  Mostrar cuándo se actualizó por última vez.
3.  Si transcurren más de cuatro horas sin actualización, mostrar una
    advertencia de información desactualizada.
4.  La antigüedad de la información no debe cambiar automáticamente el
    estado.
5.  Confirmar que se puede asistir a una convocatoria no cambia
    automáticamente el estado a `EN_SERVICIO`.
6.  La disponibilidad general y la respuesta a una convocatoria son
    datos distintos.

### 3.3 Convocatorias de emergencia

El coordinador puede crear y activar una convocatoria con:

-   Motivo o tipo de emergencia.
-   Lugar o punto de encuentro, escrito como texto.
-   Fecha y hora.
-   Instrucciones adicionales.

Reglas:

1.  Solo puede existir una convocatoria activa a la vez.
2.  Al activar una convocatoria, se debe notificar a **todos los
    brigadistas activos**, sin filtrar por disponibilidad.
3.  Reciben la notificación los brigadistas `DISPONIBLE`,
    `NO_DISPONIBLE`, `EN_SERVICIO` y aquellos cuya disponibilidad esté
    desactualizada.
4.  Los usuarios desactivados no reciben nuevas convocatorias.
5.  Cada brigadista puede responder `VOY` o `NO_PUEDO`.
6.  Registrar la respuesta y su fecha y hora.
7.  La confirmación `VOY` no equivale a registrar el inicio efectivo del
    servicio.
8.  El coordinador puede consultar las respuestas y cerrar la
    convocatoria.

**Importante:** una notificación enviada no garantiza que haya sido
recibida, visualizada o leída. La plataforma debe distinguir, cuando el
proveedor lo permita, entre intento de envío, aceptación por el
proveedor, entrega y respuesta del usuario. La bandeja interna de
convocatorias debe seguir disponible aunque una notificación push falle.

### 3.4 Panel del coordinador

-   Resumen del total de brigadistas activos.
-   Conteo por estado de disponibilidad.
-   Identificación de información desactualizada.
-   Detalle de la convocatoria activa.
-   Conteo de respuestas `VOY` y `NO_PUEDO`, además de pendientes.
-   Listado de brigadistas y administración de su estado activo.
-   Acceso al historial de disponibilidad y convocatorias.

### 3.5 Historial

Conservar, al menos:

-   Cambios de disponibilidad.
-   Fecha y hora de cada cambio.
-   Convocatorias creadas, activadas y cerradas.
-   Respuestas de los brigadistas.
-   Registro de los intentos y resultados de notificación disponibles.

## 4. Reglas de negocio prioritarias

  -----------------------------------------------------------------------
  Código                              Regla
  ----------------------------------- -----------------------------------
  RN-01                               El MVP opera con una sola brigada.

  RN-02                               El brigadista actualiza su
                                      disponibilidad cuando lo necesite.

  RN-03                               Después de cuatro horas se advierte
                                      que el dato está desactualizado; no
                                      se cambia el estado.

  RN-04                               La disponibilidad no sustituye la
                                      respuesta a una convocatoria.

  RN-05                               Solo puede existir una convocatoria
                                      activa.

  RN-06                               La activación notifica a todos los
                                      brigadistas activos, sin importar
                                      su disponibilidad.

  RN-07                               Los brigadistas desactivados no
                                      reciben nuevas convocatorias.

  RN-08                               Las respuestas posibles son `VOY` y
                                      `NO_PUEDO`.

  RN-09                               Responder `VOY` no cambia
                                      automáticamente el estado a
                                      `EN_SERVICIO`.

  RN-10                               El sistema mantiene historial y
                                      trazabilidad de las operaciones
                                      relevantes.
  -----------------------------------------------------------------------

## 5. Arquitectura y tecnologías propuestas

  -----------------------------------------------------------------------
  Área                                Tecnología
  ----------------------------------- -----------------------------------
  Frontend                            Next.js + TypeScript

  Estilos                             Tailwind CSS

  Backend y autenticación             Supabase

  Persistencia                        PostgreSQL administrado por
                                      Supabase

  Seguridad de datos                  Row Level Security (RLS)

  Aplicación inicial                  PWA

  Distribución móvil futura           Capacitor para Android e iOS

  Despliegue web propuesto            Vercel

  Notificaciones push                 Evaluar Firebase Cloud Messaging y
                                      compatibilidad por plataforma
  -----------------------------------------------------------------------

Las versiones concretas de Node.js, Next.js, Supabase y dependencias
deben verificarse al crear el workspace y quedar fijadas en los archivos
de configuración. No asumir versiones sin comprobar compatibilidad.

## 6. Modelo de datos inicial propuesto

El diseño detallado debe validarse antes de crear migraciones. Como
punto de partida:

  -----------------------------------------------------------------------
  Entidad                             Propósito
  ----------------------------------- -----------------------------------
  `profiles`                          Perfil asociado al usuario
                                      autenticado y su rol.

  `brigadistas`                       Datos operativos del integrante y
                                      estado activo/inactivo.

  `availability_history`              Historial de cambios de
                                      disponibilidad.

  `emergencies`                       Convocatorias, datos de emergencia
                                      y estado.

  `emergency_responses`               Respuesta de cada brigadista a una
                                      convocatoria.

  `notifications`                     Destinatarios, intentos y
                                      resultados de notificación.
  -----------------------------------------------------------------------

Consideraciones:

-   Definir claves, restricciones, índices y relaciones antes de
    implementar.
-   Impedir dos convocatorias activas mediante una garantía
    transaccional en la base de datos, no solo mediante validación de
    interfaz.
-   Evitar duplicar información de autenticación que ya administra
    Supabase Auth.
-   Definir reglas para impedir respuestas duplicadas y establecer qué
    ocurre si una convocatoria se cierra.
-   Guardar fechas en un estándar consistente (preferentemente UTC) y
    presentarlas en la zona horaria configurada para la brigada.

## 7. Seguridad y privacidad

-   Aplicar mínimo privilegio por rol.
-   Habilitar RLS en las tablas expuestas al cliente.
-   Validar permisos también en operaciones del servidor.
-   No incluir claves `service_role`, secretos ni credenciales en el
    frontend o repositorio.
-   Usar variables de entorno y mantener un archivo `.env.example` sin
    secretos reales.
-   Limitar los datos personales a los necesarios para operar la
    brigada.
-   Registrar operaciones administrativas relevantes.
-   Probar expresamente accesos permitidos y denegados para cada rol.

## 8. Alcance excluido del MVP

Se dejan para etapas posteriores:

-   GPS y seguimiento de ubicación.
-   Mapas y seguimiento de vehículos.
-   Chat interno.
-   Integraciones con organismos externos.
-   Administración de múltiples brigadas.
-   Estadísticas avanzadas.
-   Automatizaciones operativas no definidas en este documento.

## 9. Diseño de experiencia de usuario

La interfaz debe ser responsive, clara y accesible.

Pantallas iniciales:

1.  Inicio de sesión.
2.  Inicio del brigadista y disponibilidad actual.
3.  Bandeja de convocatorias.
4.  Detalle de convocatoria y respuesta.
5.  Perfil del brigadista.
6.  Dashboard del coordinador.
7.  Administración de brigadistas.
8.  Creación y gestión de convocatorias.
9.  Historial.

Usar estados visuales consistentes, botones de acción grandes y mensajes
claros. No depender exclusivamente del color para comunicar estados.

## 10. Plan de implementación

### Etapa 0 --- Preparación del workspace

-   Inspeccionar el entorno y las herramientas instaladas.
-   Crear la estructura inicial.
-   Verificar y fijar versiones compatibles.
-   Documentar arquitectura, decisiones y configuración local.
-   Preparar `.env.example`.
-   Definir estrategia de pruebas y migraciones.

### Etapa 1 --- Diseño y navegación

-   Implementar sistema visual.
-   Crear pantallas responsive con datos ficticios.
-   Validar navegación y experiencia de usuario.

### Etapa 2 --- Autenticación y administración

-   Integrar Supabase Auth.
-   Implementar perfiles y roles.
-   Administrar brigadistas activos e inactivos.
-   Aplicar y probar RLS.

### Etapa 3 --- Disponibilidad

-   Implementar estados y actualizaciones.
-   Registrar historial.
-   Mostrar advertencia después de cuatro horas.

### Etapa 4 --- Convocatorias y respuestas

-   Crear, activar y cerrar convocatorias.
-   Garantizar una sola convocatoria activa.
-   Registrar respuestas y mostrar el resumen al coordinador.

### Etapa 5 --- Notificaciones

-   Implementar notificaciones push.
-   Enviar a todos los brigadistas activos, sin filtrar por
    disponibilidad.
-   Registrar resultados y contemplar fallos.
-   Mantener una bandeja interna de convocatorias.

### Etapa 6 --- Validación y publicación

-   Ejecutar pruebas funcionales, de seguridad y de permisos.
-   Validar PWA en dispositivos reales.
-   Preparar la evolución a Capacitor para Android e iOS.

## 11. Forma de trabajo

-   Utilizar OpenSpec para especificar cambios antes de implementarlos.
-   Aplicar TDD en reglas de negocio y funcionalidades críticas.
-   Implementar por etapas pequeñas y verificables.
-   Mantener componentes y módulos cohesionados.
-   Evitar abstracciones y capas que no aporten valor real.
-   Documentar decisiones técnicas relevantes.
-   No conectar servicios reales ni desplegar a producción sin
    autorización.

## 12. Criterios iniciales de aceptación del MVP

El MVP se considerará funcionalmente validado cuando:

-   Un brigadista pueda iniciar sesión y actualizar su disponibilidad.
-   El sistema registre la fecha y hora de actualización.
-   La advertencia de cuatro horas funcione sin alterar el estado.
-   El coordinador pueda administrar integrantes.
-   El sistema impida activar una segunda convocatoria mientras exista
    otra activa.
-   La activación notifique a todos los brigadistas activos, incluso a
    los no disponibles o desactualizados.
-   Los brigadistas puedan responder `VOY` o `NO_PUEDO`.
-   El coordinador pueda consultar las respuestas y cerrar la
    convocatoria.
-   Las reglas de acceso estén probadas para los tres roles.
-   Exista una bandeja interna para consultar convocatorias aunque falle
    el push.

------------------------------------------------------------------------

**Estado del documento:** definición inicial del producto y alcance del
MVP.\
**Siguiente paso:** validar el modelo de datos y convertir los requisitos
en especificaciones OpenSpec antes de desarrollar las funcionalidades.

------------------------------------------------------------------------

## 13. Workspace (Etapa 0)

Estado: **preparado y validado**. No hay módulos funcionales, autenticación,
tablas de negocio ni credenciales reales.

- Stack: Next.js 16.4.3, React 19.3.1, TypeScript 5.9.3, Tailwind CSS 4.3.3,
  Supabase JS/SSR y PWA inicial mediante manifest.
- Node.js 24.19.0 LTS y npm 11.17.0, con versiones exactas en `package.json`.
- Pruebas unitarias con Vitest 5, jsdom y Testing Library.
- OpenSpec inicializado en `openspec/` para especificar cambios antes de
  implementarlos.

Puesta en marcha:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Validación:

```bash
npm run check && npm run build
```

Documentación:

- `docs/architecture.md`: arquitectura, carpetas, auth y estrategia RLS.
- `docs/development-setup.md`: entorno local y comandos.
- `docs/testing-strategy.md`: TDD, niveles y organización de pruebas.
- `docs/database-migrations.md`: migraciones y convenciones PostgreSQL.
- `docs/technical-decisions.md`: decisiones, descartes y pendientes.

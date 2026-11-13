# Versionado global: garantía de orden y descargas consistentes

> **PROPUESTA PARA AUDITORÍA.** Responde al punto 1 de la revisión: demostrar que
> `row_version` garantiza orden de confirmación y descargas consistentes.

## 1. Qué hay que garantizar

Un teléfono descarga "las filas con `row_version` mayor que mi cursor" y luego
avanza el cursor. Esto solo es correcto si se cumple:

> **Propiedad P.** Si una descarga vio una fila con versión `v`, ninguna fila
> con versión `u < v` puede **aparecer después** (confirmarse más tarde).

Con una secuencia común esto **no** se cumple: la transacción A toma la versión
10, la B toma la 11, B confirma primero; un teléfono descarga 11 y avanza el
cursor a 11; luego A confirma la 10, que ese teléfono nunca descargará.

## 2. Mecanismo

1. Secuencia `sync_row_version_seq` con `CACHE 1` (sin cachés por sesión, los
   números salen en orden global).
2. Antes de pedir un número, la transacción toma
   `pg_advisory_xact_lock(7352001)`. Ese candado **solo se libera al terminar la
   transacción** (commit o rollback).
3. El trigger `set_row_version` hace ambas cosas en cada `INSERT` o `UPDATE` de
   una tabla replicada; el backend además toma el candado al inicio de esas
   transacciones (§5).

## 3. Demostración

**Hecho de PostgreSQL usado.** Al confirmar, PostgreSQL primero hace visible la
transacción (`ProcArrayEndTransaction`) y **después** libera sus candados
(`ResourceOwnerRelease`). Es la misma garantía por la que quien esperaba un
candado ve los datos ya confirmados de quien lo soltó.

**Lema 1 (exclusión).** Mientras una transacción T tiene versiones asignadas y no
ha terminado, ninguna otra transacción puede obtener una versión.
_Porque_ obtener una versión exige el candado, y T lo retiene hasta terminar.

**Lema 2 (orden).** Si T1 obtuvo una versión `u` y T2 una versión `v` con
`u < v`, entonces T1 terminó antes de que T2 obtuviera cualquier versión.
_Porque_ por el Lema 1 sus intervalos "primera versión → fin" no se solapan, y
con `CACHE 1` la secuencia entrega números crecientes en el orden en que se
piden. Si T1 confirmó, su commit fue **visible** antes de que T2 obtuviera el
candado (hecho de PostgreSQL), y por lo tanto antes del commit de T2.

**Teorema (Propiedad P).** Sea S la instantánea (snapshot) de una descarga que
ve una fila con versión `v`, escrita por T2. Sea `u < v` una versión escrita por
T1.

- Si T1 abortó, la fila `u` nunca existirá: no hay nada que perder.
- Si T1 confirmó, por el Lema 2 su commit fue visible antes que el de T2. S ve
  a T2, así que S se tomó después de que T2 fuera visible y, por lo tanto,
  también ve a T1. La fila `u` ya estaba en S (o fue reemplazada por una versión
  mayor de la misma fila, ver §4).

Ninguna fila con versión menor que la máxima vista puede aparecer después. ∎

**Corolario.** Los huecos en la numeración (transacciones abortadas,
`nextval` sin uso) son inofensivos: un número que falta nunca llegará.

## 4. Protocolo de descarga

1. Una descarga es **una** transacción `REPEATABLE READ READ ONLY`: todas las
   consultas de todos los ámbitos usan la misma instantánea, así que el teléfono
   recibe un estado coherente entre tablas (por ejemplo, convocado y su
   convocatoria).
2. Por cada ámbito: `WHERE row_version > :cursor ORDER BY row_version LIMIT :n`.
   El nuevo cursor es el `row_version` de la **última fila devuelta** (nunca
   `last_value` de la secuencia, que no respeta la instantánea).
3. Paginación: entre páginas puede haber escrituras nuevas. Una fila actualizada
   recibe una versión **mayor**, así que reaparece en una página posterior; nada
   queda atrás. La entrega es "al menos una vez".
4. El teléfono aplica cada fila con **upsert por `id`** y solo si
   `row_version` entrante > `row_version` local. Así una página antigua nunca
   pisa un dato más nuevo.
5. El cursor local se guarda en la misma transacción SQLite que las filas.

### Casos borde

| Caso                                                                                                           | Tratamiento                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fila que sale del ámbito del teléfono (por ejemplo, convocatoria cerrada hace más de 30 días)                  | El teléfono la limpia según `offline-storage.md`; no necesita lápida                                                                                                   |
| **Convocado agregado tarde** (E5): la convocatoria y sus avisos tienen versiones viejas, menores que el cursor | La descarga del ámbito `recipients` incluye, para cada convocado **nuevo** en el teléfono, el paquete completo de su convocatoria y avisos, sin importar sus versiones |
| Rol revocado (borrado físico en `user_role`)                                                                   | La misma transacción actualiza `app_user` (nueva versión) y el teléfono recibe la lista completa de roles                                                              |
| Restauración de backup                                                                                         | La secuencia también vuelve atrás: el cambio de `sync_epoch` obliga a descargar todo (`offline-storage.md` §6)                                                         |
| Réplicas de lectura de PostgreSQL                                                                              | **No** se usan para descargas: el razonamiento asume el primario                                                                                                       |

## 5. Riesgos y mitigaciones

| Riesgo                                                                                                   | Mitigación                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interbloqueo**: T1 tiene una fila bloqueada y espera el candado; T2 tiene el candado y espera esa fila | Orden fijo: toda transacción que escriba en tablas replicadas toma el candado **primero**, antes de bloquear filas. Si aun así ocurre, PostgreSQL aborta una y el backend reintenta |
| **Contención**: las escrituras replicadas quedan en serie                                                | Volumen bajo (una brigada; decenas de escrituras por minuto en el peor caso). La transacción de activación debe ser corta: el envío push ocurre **después** del commit              |
| Alguien cambia la secuencia a `CACHE > 1`                                                                | Prueba de integración que verifica `CACHE 1` y la propiedad P                                                                                                                       |
| Una tabla replicada nueva sin trigger                                                                    | Prueba que recorre las tablas replicadas y exige `row_version NOT NULL` + trigger                                                                                                   |

## 6. Cómo se verificará (al implementar)

Prueba de integración contra PostgreSQL en Docker:

1. N transacciones concurrentes escriben en tablas replicadas con pausas
   aleatorias antes del commit; algunas abortan.
2. Un lector descarga en bucle con el protocolo de §4 y registra cada cursor.
3. Al final, se verifica que **toda** fila confirmada fue vista por el lector
   y que ninguna apareció con versión menor que un cursor ya alcanzado.
4. Variante negativa: sin el candado, la prueba debe fallar (demuestra que la
   prueba detecta el problema).

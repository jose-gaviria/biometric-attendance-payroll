# Auditoría de nómina — Colombia, septiembre de 2026

Fecha de contraste normativo: **2026-09-12**. Alcance: trabajadores particulares
adultos, de tiempo completo, con salario mínimo, bajo el Código Sustantivo del
Trabajo. Medellín no cambia estas tarifas nacionales.

## Parámetros vigentes

| Parámetro | Valor aplicado |
|---|---:|
| SMLMV 2026 | $1.750.905 |
| Auxilio de transporte 2026 | $249.095 |
| Jornada máxima desde 2026-07-15 | 42 h/semana |
| Hora ordinaria | SMLMV / 210 = $8.337,64 |
| Jornada diurna | 06:00–19:00 |
| Jornada nocturna | 19:00–06:00 |
| Máximo flexible ordinario diario | 9 h |
| Jornada ordinaria acordada en esta instalación | 7 h/día, 6 días/semana |
| Máximo de extras | 2 h/día y 12 h/semana |
| Recargo por descanso obligatorio o festivo | 90% desde 2026-07-01 |

El salario de 2026 está fijado transitoriamente por el Decreto 0159 de 2026
mientras se decide el proceso judicial indicado en ese decreto. Debe volver a
verificarse si el Consejo de Estado dicta sentencia.

## Tarifas por hora con el mínimo de 2026

Los importes son los que muestra el sistema redondeados al peso. Internamente se
calculan por segundo y en centavos. El salario base ya paga la hora ordinaria;
por eso las filas de recargo ordinario muestran solo el adicional.

| Categoría | Fórmula | Valor por hora |
|---|---:|---:|
| Recargo nocturno ordinario | hora × 35% | $2.918 adicionales |
| Extra diurna | hora × 125% | $10.422 |
| Extra nocturna | hora × 175% | $14.591 |
| Descanso/festivo diurno ordinario | hora × 90% | $7.504 adicionales |
| Descanso/festivo nocturno ordinario | hora × (90% + 35%) | $10.422 adicionales |
| Extra diurna en descanso/festivo | hora × (100% + 90% + 25%) | $17.926 |
| Extra nocturna en descanso/festivo | hora × (100% + 90% + 75%) | $22.095 |

La pantalla **Reglas legales** muestra este listado directamente desde la
vigencia aplicable al día de consulta. Presenta tanto el valor total de la hora
como el adicional sobre la hora base, para no confundir un recargo ordinario
—cuyo valor base ya está dentro del salario— con una hora extra completa.

El recargo de descanso sube como mínimo al 100% el 2027-07-01. La aplicación
impide que una configuración rebaje los pisos legales de jornada, nocturnidad y
descanso. No precarga el salario de 2027 porque todavía no existe: bloquea una
liquidación de ese año hasta que se carguen el SMLMV y el auxilio oficiales.

## Reglas operativas implementadas

- El salario base de todos los trabajadores es el SMLMV vigente de la fecha
  liquidada. El servidor ya no acepta un salario individual diferente.
- Cada trabajador tiene un único día de descanso recurrente, elegido en su
  ficha. Un festivo conserva su recargo aunque el descanso semanal sea otro día.
- No se planean franjas cada semana. En cada fecha, las primeras 7 horas
  efectivamente marcadas son ordinarias y el tiempo posterior es extra. El
  máximo semanal de 42 horas sigue aplicando: si se alcanza antes, desde ese
  instante el resto también es extra.
- En el descanso o en un festivo, las primeras 7 horas reciben el recargo de
  descanso y el excedente recibe el recargo combinado de extra en descanso.
- El motor separa exactamente las 19:00 y las 06:00, incluso si la marcación
  contiene segundos, y une intervalos solapados para no pagar dos veces.
- Todo el tiempo extra se paga aunque exceda el límite. La liquidación, el CSV y
  el comprobante muestran alertas si supera 2 horas diarias o 12 semanales.
- El auxilio se excluye cuando el ingreso salarial real del mes supera dos
  salarios mínimos. El cálculo considera horas extra, recargos y bonificaciones
  salariales del mes completo.

## Deducciones del trabajador

Salud y pensión se descuentan al 4% cada una sobre el IBC. El auxilio de
transporte queda fuera. Bonificaciones salariales y pagos de recargos entran al
IBC; el exceso de pagos no salariales sobre 40% de la remuneración también entra.
El Fondo de Solidaridad Pensional empieza en 1% desde cuatro SMLMV y progresa
hasta un total de 2% desde veinte SMLMV. La tasa se decide con el IBC real del mes
completo, no duplicando una quincena.

Con solo el mínimo, por mes: salud $70.036,20 y pensión $70.036,20 antes del
redondeo de presentación. No se descuenta ARL, caja de compensación ni aportes
patronales al trabajador.

La liquidación permite registrar, por trabajador, fecha y concepto, descuentos
manuales como adelantos o deudas. Se restan del neto después de calcular el IBC,
por lo que no reducen salud, pensión ni el total devengado. Cada liquidación
guardada conserva la copia de esos descuentos aunque después se borre el registro
operativo. El sistema no presume que una deuda sea descontable: el responsable
de nómina debe verificar autorización, soporte y límites de los artículos 149 a
151 del Código Sustantivo del Trabajo antes de aplicarla.

## Frontera contable

La aplicación calcula una preliquidación para empleados activos durante toda la
quincena. Novedades como ingreso o retiro a mitad de periodo, licencia no
remunerada, incapacidad, vacaciones, embargo, libranza, retención en la fuente,
salario en especie o compensatorio requieren registrarse y validarse fuera de
este módulo. Las pausas no remuneradas deben marcarse con salida y nueva entrada;
si la persona permanece marcada, ese tiempo cuenta como trabajado.

Antes de pagar, el responsable de nómina debe revisar las alertas y el comprobante.
Esta revisión es necesaria porque la ley permite acuerdos y novedades que no se
deducen solo de una cámara y dos marcas de tiempo.

## Fuentes oficiales

- [Decreto 0159 de 2026 — SMLMV $1.750.905](https://dapre.presidencia.gov.co/normativa/normativa/DECRETO%20No.%200159%20DEL%2019%20DE%20FEBRERO%20DE%202026.pdf)
- [Decreto 1470 de 2025 — auxilio $249.095](https://www.suin-juriscol.gov.co/viewDocument.asp?id=30055941)
- [Ley 2466 de 2025 — noche, jornada flexible, extras y descanso](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676)
- [Ley 2101 de 2021 — reducción a 42 horas sin bajar salario](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506)
- [Código Sustantivo del Trabajo — recargos del 35%, 25% y 75%](https://www.suin-juriscol.gov.co/viewdocument.asp?ruta=codigo%2F30019323)
- [Ley 51 de 1983 — festivos y traslado al lunes](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4954)
- [UGPP — aportes del trabajador de 4% a salud y 4% a pensión](https://www.ugpp.gov.co/abc_empleados_domesticos/)
- [Ley 1393 de 2010, art. 30 — límite no salarial de 40%](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=39995)

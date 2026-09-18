// Comprobantes de nómina en PDF con la tipografía y los colores de la marca.
// Se dibujan con pdfkit para no depender de un navegador dentro del contenedor.
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { TIME_ZONE } from './payroll.js';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NORMAL = resolve(raiz, 'assets/nunito-400.ttf');
const FUERTE = resolve(raiz, 'assets/nunito-800.ttf');
const LOGO = [
  resolve(raiz, 'dist/logo.png'),
  resolve(raiz, 'public/logo.png'),
].find((ruta) => existsSync(ruta));

// Los mismos valores que usa la aplicación en pantalla.
const VINO = '#761f28';
const VINO_OSCURO = '#50151b';
const ORO = '#d59a27';
const TINTA = '#251b19';
const APAGADO = '#776c68';
const PAPEL = '#fffdf9';
const LINEA = '#e7ded3';

const EMPRESA = 'Biometric Attendance & Payroll';
const MARGEN = 44;
const ANCHO = 595.28; // A4 en puntos
const UTIL = ANCHO - MARGEN * 2;
const LIMITE_CONTENIDO = 738;
const ALTO_ENCABEZADO_TABLA = 18;
const ALTO_FILA_TABLA = 19;
const ALTO_TOTAL_TABLA = 22;
const ESPACIO_TRAS_TABLA = 10;

const dinero = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const pesos = (centavos: number) => dinero.format((centavos ?? 0) / 100);

type Snapshot = {
  employee_name: string;
  employee_code: string;
  worked_hours: number;
  worked_days: number;
  calculated_days?: number;
  base_salary_cents: number;
  transport_cents: number;
  extras_cents: number;
  ibc_cents?: number;
  gross_total_cents?: number;
  total_cents: number;
  net_total_cents?: number;
  total_deductions_cents?: number;
  non_salary_excess_cents?: number;
  bonuses?: {
    concept: string;
    amount_cents: number;
    constitutes_salary: boolean;
  }[];
  breakdown: { label: string; hours: number; amount_cents: number }[];
  deductions?: {
    category: string;
    label: string;
    rate: number;
    amount_cents: number;
  }[];
};
type Run = { id: number; start_date: string; end_date: string };

const bruto = (e: Snapshot) =>
  e.gross_total_cents ??
  e.base_salary_cents + e.transport_cents + e.extras_cents;
const neto = (e: Snapshot) => e.net_total_cents ?? e.total_cents;

function periodo(run: Run) {
  const largo = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const desde = new Date(`${run.start_date}T12:00:00`);
  const hasta = new Date(`${run.end_date}T12:00:00`);
  return `${largo.format(desde)} al ${largo.format(hasta)}`;
}

function documento() {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEN,
    bufferPages: true,
    info: { Author: EMPRESA, Creator: EMPRESA },
  });
  doc.registerFont('cuerpo', NORMAL);
  doc.registerFont('titulo', FUERTE);
  return doc;
}

function cabecera(doc: PDFKit.PDFDocument, titulo: string, subtitulo: string) {
  const alto = 108;
  doc.rect(0, 0, ANCHO, alto).fill(VINO);
  doc.rect(0, alto, ANCHO, 4).fill(ORO);
  if (LOGO) doc.image(LOGO, MARGEN, 26, { fit: [104, 62] });
  const x = MARGEN + (LOGO ? 120 : 0);
  doc
    .fillColor('#f6e6d8')
    .font('cuerpo')
    .fontSize(9)
    .text(EMPRESA.toUpperCase(), x, 30, { characterSpacing: 1.6 });
  doc.fillColor('#ffffff').font('titulo').fontSize(21).text(titulo, x, 45);
  doc.fillColor('#e8cfc9').font('cuerpo').fontSize(10).text(subtitulo, x, 74);
  doc.y = alto + 30;
}

function pie(doc: PDFKit.PDFDocument, nota: string) {
  const rango = doc.bufferedPageRange();
  const generado = DateTime.now()
    .setZone(TIME_ZONE)
    .toFormat("d 'de' LLLL 'de' yyyy, HH:mm");
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    // pdfkit añade una página en cuanto un texto pasa del margen inferior, y el
    // pie se dibuja justo ahí: eso generaba hojas vacías al final. Se anula el
    // margen mientras se pinta el pie y se restaura después.
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = 748;
    doc.rect(MARGEN, y, UTIL, 0.8).fill(LINEA);
    doc
      .fillColor(APAGADO)
      .font('cuerpo')
      .fontSize(7.5)
      .text(nota, MARGEN, y + 9, { width: UTIL, height: 42 });
    doc.text(
      `${EMPRESA} · Generado el ${generado} · Página ${i - rango.start + 1} de ${rango.count}`,
      MARGEN,
      800,
      { width: UTIL, lineBreak: false },
    );
    doc.page.margins.bottom = margenInferior;
  }
}

/** Tres cifras grandes: devengado, deducciones y neto. */
function resumen(
  doc: PDFKit.PDFDocument,
  cifras: { titulo: string; valor: string; destacado?: boolean }[],
) {
  const y = doc.y;
  const alto = 54;
  const ancho = UTIL / cifras.length;
  cifras.forEach((cifra, indice) => {
    const x = MARGEN + ancho * indice;
    doc
      .roundedRect(x + (indice ? 5 : 0), y, ancho - 5, alto, 9)
      .fill(cifra.destacado ? VINO : PAPEL);
    if (!cifra.destacado)
      doc
        .roundedRect(x + (indice ? 5 : 0), y, ancho - 5, alto, 9)
        .lineWidth(0.8)
        .stroke(LINEA);
    doc
      .fillColor(cifra.destacado ? '#e8cfc9' : APAGADO)
      .font('cuerpo')
      .fontSize(8)
      .text(cifra.titulo.toUpperCase(), x + 14, y + 11, {
        width: ancho - 28,
        characterSpacing: 0.8,
      });
    doc
      .fillColor(cifra.destacado ? '#ffffff' : TINTA)
      .font('titulo')
      .fontSize(15)
      .text(cifra.valor, x + 14, y + 26, { width: ancho - 28 });
  });
  doc.y = y + alto + 16;
}

function titulo(doc: PDFKit.PDFDocument, texto: string) {
  doc
    .fillColor(VINO)
    .font('titulo')
    .fontSize(11)
    .text(texto.toUpperCase(), MARGEN, doc.y, { characterSpacing: 1 });
  doc.y += 4;
}

type Columna = { titulo: string; ancho: number; derecha?: boolean };
type OpcionesTabla = {
  reservaPosterior?: number;
  minimoFilasFinales?: number;
  alContinuar?: () => void;
};

function tabla(
  doc: PDFKit.PDFDocument,
  columnas: Columna[],
  filas: string[][],
  total?: string[],
  opciones: OpcionesTabla = {},
) {
  const dibujarEncabezado = () => {
    const y = doc.y;
    doc.rect(MARGEN, y, UTIL, ALTO_ENCABEZADO_TABLA).fill('#faf6f0');
    let x = MARGEN;
    for (const columna of columnas) {
      doc
        .fillColor(APAGADO)
        .font('titulo')
        .fontSize(7.5)
        .text(columna.titulo.toUpperCase(), x + 9, y + 6, {
          width: columna.ancho - 18,
          align: columna.derecha ? 'right' : 'left',
          characterSpacing: 0.6,
        });
      x += columna.ancho;
    }
    doc.y = y + ALTO_ENCABEZADO_TABLA;
  };
  const continuarEnPaginaNueva = () => {
    doc.addPage();
    if (opciones.alContinuar) opciones.alContinuar();
    else doc.y = MARGEN;
    dibujarEncabezado();
  };
  dibujarEncabezado();
  for (const [indiceFila, fila] of filas.entries()) {
    const filasRestantes = filas.length - indiceFila;
    const altoCola =
      filasRestantes * ALTO_FILA_TABLA +
      (total ? ALTO_TOTAL_TABLA : 0) +
      ESPACIO_TRAS_TABLA +
      (opciones.reservaPosterior ?? 0);
    const debeConservarCola =
      (opciones.minimoFilasFinales ?? 0) > 0 &&
      filasRestantes <= (opciones.minimoFilasFinales ?? 0) &&
      doc.y + altoCola > LIMITE_CONTENIDO;
    if (debeConservarCola || doc.y + ALTO_FILA_TABLA > LIMITE_CONTENIDO) {
      continuarEnPaginaNueva();
    }
    const y = doc.y;
    let x = MARGEN;
    fila.forEach((celda, indice) => {
      const columna = columnas[indice];
      doc
        .fillColor(indice === 0 ? TINTA : APAGADO)
        .font('cuerpo')
        .fontSize(9)
        .text(celda, x + 9, y + 5, {
          width: columna.ancho - 18,
          align: columna.derecha ? 'right' : 'left',
          lineBreak: false,
        });
      x += columna.ancho;
    });
    doc.rect(MARGEN, y + ALTO_FILA_TABLA - 1, UTIL, 0.6).fill(LINEA);
    doc.y = y + ALTO_FILA_TABLA;
  }
  if (total) {
    if (
      doc.y +
        ALTO_TOTAL_TABLA +
        ESPACIO_TRAS_TABLA +
        (opciones.reservaPosterior ?? 0) >
      LIMITE_CONTENIDO
    ) {
      continuarEnPaginaNueva();
    }
    const y = doc.y;
    doc.rect(MARGEN, y, UTIL, ALTO_TOTAL_TABLA).fill('#f7efe4');
    let x = MARGEN;
    total.forEach((celda, indice) => {
      const columna = columnas[indice];
      doc
        .fillColor(indice === total.length - 1 ? VINO : TINTA)
        .font('titulo')
        .fontSize(9.5)
        .text(celda, x + 9, y + 6, {
          width: columna.ancho - 18,
          align: columna.derecha ? 'right' : 'left',
          lineBreak: false,
      });
      x += columna.ancho;
    });
    doc.y = y + ALTO_TOTAL_TABLA;
  }
  doc.y += ESPACIO_TRAS_TABLA;
}

function datos(doc: PDFKit.PDFDocument, pares: [string, string][]) {
  const y = doc.y;
  const ancho = UTIL / pares.length;
  pares.forEach(([etiqueta, valor], indice) => {
    const x = MARGEN + ancho * indice;
    doc
      .fillColor(APAGADO)
      .font('cuerpo')
      .fontSize(7.5)
      .text(etiqueta.toUpperCase(), x, y, {
        width: ancho - 10,
        characterSpacing: 0.6,
      });
    doc
      .fillColor(TINTA)
      .font('titulo')
      .fontSize(10.5)
      .text(valor, x, y + 12, { width: ancho - 10 });
  });
  doc.y = y + 30;
}

function contextoContinuacion(
  doc: PDFKit.PDFDocument,
  run: Run,
  entrada: Snapshot,
) {
  cabecera(doc, 'Comprobante de nómina', `${periodo(run)} - Continuación`);
  datos(doc, [
    ['Trabajador', entrada.employee_name],
    ['Código', entrada.employee_code],
    ['IBC', pesos(entrada.ibc_cents ?? 0)],
  ]);
  resumen(doc, [
    { titulo: 'Total devengado', valor: pesos(bruto(entrada)) },
    {
      titulo: 'Deducciones',
      valor: pesos(entrada.total_deductions_cents ?? 0),
    },
    { titulo: 'Neto a pagar', valor: pesos(neto(entrada)), destacado: true },
  ]);
}

/** Comprobante de un solo trabajador. */
export function employeePayrollPdf(run: Run, entrada: Snapshot) {
  const doc = documento();
  cabecera(doc, 'Comprobante de nómina', periodo(run));
  doc
    .fillColor(TINTA)
    .font('titulo')
    .fontSize(17)
    .text(entrada.employee_name, MARGEN, doc.y);
  doc.y += 2;
  datos(doc, [
    ['Código', entrada.employee_code],
    ['Días calculados', String(entrada.calculated_days ?? '—')],
    ['Días con marcación', String(entrada.worked_days)],
    ['Horas registradas', `${entrada.worked_hours} h`],
  ]);
  resumen(doc, [
    { titulo: 'Total devengado', valor: pesos(bruto(entrada)) },
    {
      titulo: 'Deducciones',
      valor: pesos(entrada.total_deductions_cents ?? 0),
    },
    { titulo: 'Neto a pagar', valor: pesos(neto(entrada)), destacado: true },
  ]);

  titulo(doc, 'Ingresos');
  const filas: string[][] = [
    ['Salario base quincenal', '—', pesos(entrada.base_salary_cents)],
    ['Auxilio de transporte', '—', pesos(entrada.transport_cents)],
  ];
  for (const linea of entrada.breakdown)
    if (linea.amount_cents > 0 || linea.hours > 0)
      filas.push([
        linea.label,
        `${linea.hours.toFixed(2)} h`,
        pesos(linea.amount_cents),
      ]);
  for (const bono of entrada.bonuses ?? [])
    filas.push([
      bono.concept,
      bono.constitutes_salary ? 'Bonificación salarial' : 'Bonificación',
      pesos(bono.amount_cents),
    ]);
  tabla(
    doc,
    [
      { titulo: 'Concepto', ancho: UTIL * 0.5 },
      { titulo: 'Cantidad', ancho: UTIL * 0.25 },
      { titulo: 'Valor', ancho: UTIL * 0.25, derecha: true },
    ],
    filas,
    ['Total devengado', '', pesos(bruto(entrada))],
    {
      minimoFilasFinales: 4,
      alContinuar: () => contextoContinuacion(doc, run, entrada),
    },
  );

  const filasDeducciones = (entrada.deductions ?? []).map((linea) => [
    linea.label,
    linea.category === 'manual'
      ? 'Valor fijo'
      : `${(linea.rate * 100).toFixed(2)}%`,
    pesos(linea.amount_cents),
  ]);
  const altoBloqueDeducciones =
    18 +
    ALTO_ENCABEZADO_TABLA +
    filasDeducciones.length * ALTO_FILA_TABLA +
    ALTO_TOTAL_TABLA +
    ESPACIO_TRAS_TABLA +
    42;
  if (
    doc.y + altoBloqueDeducciones > LIMITE_CONTENIDO &&
    altoBloqueDeducciones <= 480
  ) {
    doc.addPage();
    contextoContinuacion(doc, run, entrada);
  }
  titulo(doc, 'Deducciones');
  tabla(
    doc,
    [
      { titulo: 'Concepto', ancho: UTIL * 0.5 },
      { titulo: 'Porcentaje', ancho: UTIL * 0.25 },
      { titulo: 'Valor', ancho: UTIL * 0.25, derecha: true },
    ],
    filasDeducciones,
    ['Total deducciones', '', pesos(entrada.total_deductions_cents ?? 0)],
    {
      reservaPosterior: 42,
      minimoFilasFinales: 2,
      alContinuar: () => contextoContinuacion(doc, run, entrada),
    },
  );

  if (doc.y + 42 > LIMITE_CONTENIDO) {
    doc.addPage();
    contextoContinuacion(doc, run, entrada);
  }
  const y = doc.y;
  doc.roundedRect(MARGEN, y, UTIL, 42, 9).fill(VINO_OSCURO);
  doc
    .fillColor('#e8cfc9')
    .font('cuerpo')
    .fontSize(8.5)
    .text('NETO A PAGAR', MARGEN + 18, y + 12, { characterSpacing: 1 });
  doc
    .fillColor('#ffffff')
    .font('titulo')
    .fontSize(19)
    .text(pesos(neto(entrada)), MARGEN, y + 10, {
      width: UTIL - 18,
      align: 'right',
    });

  const excedente = entrada.non_salary_excess_cents ?? 0;
  pie(
    doc,
    `IBC de seguridad social: ${pesos(entrada.ibc_cents ?? 0)}. Salud y pensión se calculan sobre el salario más recargos y horas extra, sin incluir el auxilio de transporte. ` +
      (excedente > 0
        ? `Las bonificaciones no salariales superaron el 40% del total, así que ${pesos(excedente)} entró al IBC. `
        : '') +
      'ARL y demás aportes exclusivos del empleador no se descuentan al trabajador.',
  );
  doc.end();
  return doc;
}

/** Resumen de toda la quincena. */
export function runPayrollPdf(run: Run, entradas: Snapshot[]) {
  const doc = documento();
  cabecera(doc, 'Liquidación de quincena', periodo(run));
  const totales = entradas.reduce(
    (suma, entrada) => ({
      bruto: suma.bruto + bruto(entrada),
      deducciones: suma.deducciones + (entrada.total_deductions_cents ?? 0),
      neto: suma.neto + neto(entrada),
    }),
    { bruto: 0, deducciones: 0, neto: 0 },
  );
  datos(doc, [
    ['Trabajadores', String(entradas.length)],
    ['Liquidación', `N.º ${run.id}`],
    [
      'Horas registradas',
      `${entradas.reduce((suma, entrada) => suma + entrada.worked_hours, 0).toFixed(2)} h`,
    ],
  ]);
  resumen(doc, [
    { titulo: 'Total devengado', valor: pesos(totales.bruto) },
    { titulo: 'Deducciones', valor: pesos(totales.deducciones) },
    { titulo: 'Neto total', valor: pesos(totales.neto), destacado: true },
  ]);
  const contextoContinuacionLiquidacion = () => {
    cabecera(doc, 'Liquidación de quincena', `${periodo(run)} - Continuación`);
    datos(doc, [
      ['Trabajadores', String(entradas.length)],
      ['Liquidación', `N.º ${run.id}`],
      [
        'Horas registradas',
        `${entradas.reduce((suma, entrada) => suma + entrada.worked_hours, 0).toFixed(2)} h`,
      ],
    ]);
    resumen(doc, [
      { titulo: 'Total devengado', valor: pesos(totales.bruto) },
      { titulo: 'Deducciones', valor: pesos(totales.deducciones) },
      { titulo: 'Neto total', valor: pesos(totales.neto), destacado: true },
    ]);
    titulo(doc, 'Detalle por trabajador - continuación');
  };

  titulo(doc, 'Detalle por trabajador');
  tabla(
    doc,
    [
      { titulo: 'Trabajador', ancho: UTIL * 0.34 },
      { titulo: 'Horas', ancho: UTIL * 0.12, derecha: true },
      { titulo: 'Devengado', ancho: UTIL * 0.18, derecha: true },
      { titulo: 'Deducciones', ancho: UTIL * 0.18, derecha: true },
      { titulo: 'Neto', ancho: UTIL * 0.18, derecha: true },
    ],
    entradas.map((entrada) => [
      entrada.employee_name,
      entrada.worked_hours.toFixed(2),
      pesos(bruto(entrada)),
      pesos(entrada.total_deductions_cents ?? 0),
      pesos(neto(entrada)),
    ]),
    [
      'Total',
      '',
      pesos(totales.bruto),
      pesos(totales.deducciones),
      pesos(totales.neto),
    ],
    {
      minimoFilasFinales: 4,
      alContinuar: contextoContinuacionLiquidacion,
    },
  );

  pie(
    doc,
    'Documento de uso interno. Cada trabajador tiene además su comprobante individual con el desglose de recargos, extras, bonificaciones y deducciones.',
  );
  doc.end();
  return doc;
}

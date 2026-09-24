'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHistorico, mergeTxnArrays, computePL, pd, dk } = require('../logica.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failed++;
    console.error(`FALLO ${label}: ${error.message}`);
  }
}
function equalNumber(label, actual, expected) {
  assert.equal(actual, expected,
    `${label}: esperado ${expected}, obtenido ${actual}, diferencia ${actual - expected}`);
}

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'historico.json'), 'utf8'));
  const rate = () => 950;
  const normalized = normalizeHistorico(raw, rate);
  const txns = mergeTxnArrays([], normalized);
  const ahora = new Date('2026-09-01T12:00:00');
  const references = {
    '2026-01': [-14527017, -14076488, -454507],
    '2026-02': [-49632, 384278, -437961],
    '2026-03': [8085383, 8549963, -464944],
    '2026-04': [-5148198, -4680352, -467846],
    '2026-05': [-3978368, -6624780, 2644876],
    '2026-06': [-673130, -1218763, 544865],
    '2026-07': [2561876, -5484435, 5460071],
    '2026-08': [5676332, 250145, 5426187],
  };
  for (const [mes, expected] of Object.entries(references)) {
    const pl = computePL({ txns, cobros: [], ventas: [], cuotas: [], rate, mes, ahora });
    ['res', 'resAcel', 'resExp'].forEach((field, i) => {
      check(`${mes} ${field}`, () => {
        equalNumber(`${mes} ${field}`, Math.round(pl[field]), expected[i]);
      });
    });
  }

  check('total normalizado', () => equalNumber('movimientos normalizados', normalized.length, 1571));
  check('total combinado', () => equalNumber('movimientos combinados', txns.length, 1571));

  // Identidades de los dos pendientes actuales: detecta también sustituciones
  // que mantengan el conteo en dos y lista fecha, glosa y monto de cada nuevo.
  const knownUnclassified = [
    ['2026-07-09', 'Envío a cuenta bancaria Acelerador inmobiliario llc', -48, 'g66'],
    ['2026-08-30', 'MP: reserva pendiente de liberación', -9993, 'mp'],
  ];
  check('sin clasificar', () => {
    const pending = normalized.filter(t => t.cat === 'other' && t.sub === 'sin_clasificar');
    const added = pending.filter(t => !knownUnclassified.some(([date, desc, amount, src]) =>
      dk(t.date) === date && t.desc === desc && t.montoOrig === amount && t.src === src));
    const details = added.map(t => `${dk(t.date)} | ${t.desc} | monto ${t.monto} CLP`).join('\n');
    assert.ok(pending.length === 2 && added.length === 0,
      `sin clasificar: esperado 2, obtenido ${pending.length}, diferencia ${pending.length - 2}` +
      `\nNuevos:\n${details || '(ninguno)'}`);
  });

  // Cada caso real coincide con reglas de destinos distintos. La primera manda:
  // WHOP* precede BLUEHACK (advisory) y WHOP (ingreso/whop).
  // HIGHLEVEL AGENCY precede HIGHLEVEL (costo_servicio/ghl).
  // TELEFONICA DEL SUR precede TELEFONICA (overhead/oficina).
  const orderedCases = [
    ['2026-01-02', 'Compra WHOP*BLUEHACKERS', -2308750, 'santander', 'overhead', 'herramienta'],
    ['2026-01-05', 'Compra HIGHLEVEL AGENCY', -275571, 'santander', 'overhead', 'herramienta'],
    ['2026-07-24', 'MP: Telefonica Del Sur', -21879, 'mp', 'overhead', 'telecom'],
  ];
  for (const [date, desc, amount, src, cat, sub] of orderedCases) {
    check(`orden KW_MAP: ${date} ${desc}`, () => {
      const matches = normalized.filter(t => dk(t.date) === date && t.desc === desc &&
        t.montoOrig === amount && t.src === src);
      assert.equal(matches.length, 1, 'el movimiento de referencia debe existir exactamente una vez');
      assert.equal(`${matches[0].cat}/${matches[0].sub}`, `${cat}/${sub}`);
    });
  }

  check('fecha ISO local', () => {
    const date = pd('2026-01-01');
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()], [2026, 0, 1, 0]);
  });
  check('reimportar el histórico no duplica movimientos', () => {
    assert.deepEqual(mergeTxnArrays(txns, normalized), txns);
  });
  check('deduplicación conserva multiplicidad y no muta las entradas', () => {
    const t = normalized[0];
    const existing = Object.freeze([t]);
    const incoming = Object.freeze([t, t]);
    const combined = mergeTxnArrays(existing, incoming);
    assert.deepEqual(combined, [t, t]);
    assert.deepEqual(mergeTxnArrays(combined, incoming), combined);
  });
} catch (error) {
  failed++;
  console.error(`FALLO al preparar o calcular la regresión: ${error.stack || error.message}`);
}

console.log(`Regresión: ${passed} verificaciones pasaron; ${failed} fallaron.`);
process.exitCode = failed ? 1 : 0;

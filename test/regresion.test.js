'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHistorico, mergeTxnArrays, computePL, pd, dk, esMovimientoBancario } = require('../logica.js');

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
    // Agosto: prepago menos consumo de países es un pasivo, no resultado.
    // Se retiran $1.742.131 de res y resExp; Acelerador no cambia.
    // T6: finiquito final de Ignacio aumenta de $480.000 a $2.598.340:
    // res y resAcel bajan $2.118.340; resExp conserva el ajuste T3.
    '2026-08': [1815861, -1868195, 3684056],
  };
  for (const [mes, expected] of Object.entries(references)) {
    const pl = computePL({ txns, cobros: [], ventas: [], cuotas: [], rate, mes, ahora });
    ['res', 'resAcel', 'resExp'].forEach((field, i) => {
      check(`${mes} ${field}`, () => {
        equalNumber(`${mes} ${field}`, Math.round(pl[field]), expected[i]);
      });
    });
  }

  const plMes = (mes, movimientos = txns) => computePL({
    txns: movimientos, cobros: [], ventas: [], cuotas: [], rate, mes, ahora,
  });
  check('saldo prepago eXp agosto', () => {
    const pl = plMes('2026-08');
    equalNumber('saldoPrepagoExpUSD', pl.saldoPrepagoExpUSD, 1898.45);
    // $1.742.132: convertir y redondear el saldo una sola vez agrega $1 frente
    // a los $1.742.131 obtenidos al sumar cada movimiento convertido y redondeado.
    equalNumber('saldoPrepagoExp', pl.saldoPrepagoExp, Math.round(1898.45 * 917.66));
  });
  check('prepago USD consumido con otro TC no deja saldo', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-08-31',desc:'InmoCRM eXp — ACH',monto:100,src:'relay',usd:true},
      {date:'2026-09-30',desc:'HighLevel — InmoCRM eXp',monto:-100,src:'relay',usd:true},
    ], rate);
    assert.notEqual(movimientos[0].monto, -movimientos[1].monto);
    equalNumber('agosto USD', plMes('2026-08', movimientos).saldoPrepagoExpUSD, 100);
    equalNumber('agosto CLP', plMes('2026-08', movimientos).saldoPrepagoExp, 91766);
    for (const mes of ['2026-09', null]) {
      const pl = plMes(mes, movimientos);
      equalNumber(`${mes} USD`, pl.saldoPrepagoExpUSD, 0);
      equalNumber(`${mes} CLP`, pl.saldoPrepagoExp, 0);
    }
  });
  check('saldo mixto usa TC de cierre y último mes bancario sin mes consultado', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-07-31',desc:'InmoCRM eXp — ACH',monto:100,src:'relay',usd:true},
      {date:'2026-07-31',desc:'InmoCRM eXp — ACH',monto:25,src:'relay',usd:false},
      {date:'2026-08-31',desc:'Compra oficina',monto:-10,src:'santander'},
    ], rate);
    for (const mes of ['2026-08', null]) {
      const pl = plMes(mes, movimientos);
      equalNumber(`${mes} USD`, pl.saldoPrepagoExpUSD, 100);
      equalNumber(`${mes} CLP`, pl.saldoPrepagoExp, 91766 + 25);
    }
    // Septiembre no tiene TC del SII: se usa el callback (950).
    equalNumber('respaldo TC', plMes('2026-09', movimientos).saldoPrepagoExp, 95000 + 25);
    movimientos.push(...normalizeHistorico([
      {date:'2026-09-30',desc:'Compra oficina',monto:-10,src:'santander'},
    ], rate));
    equalNumber('último mes sin TC SII', plMes(null, movimientos).saldoPrepagoExp, 95000 + 25);
  });
  check('saldo acumulado incluye meses anteriores y excluye posteriores', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-08-31',desc:'InmoCRM eXp — ACH',monto:100,src:'relay'},
      {date:'2026-09-30',desc:'HighLevel — InmoCRM eXp',monto:-30,src:'relay'},
      {date:'2026-10-01',desc:'InmoCRM eXp — ACH',monto:20,src:'relay'},
      {date:'2026-09-01',desc:'Relay: traspaso interno (To InmoCRM eXp)',monto:-50,src:'relay'},
      {date:'2026-09-01',desc:'InmoCRM eXp — ACH',monto:200,src:'santander'},
    ], rate);
    equalNumber('julio', plMes('2026-07', movimientos).saldoPrepagoExp, 0);
    equalNumber('septiembre', plMes('2026-09', movimientos).saldoPrepagoExp, 70);
    equalNumber('todo', plMes(null, movimientos).saldoPrepagoExp, 90);
    assert.equal(movimientos[0].cat, 'prepago_exp');
    assert.equal(movimientos[1].cat, 'prepago_exp');
    assert.equal(movimientos[3].cat, 'other');
    assert.equal(movimientos[4].cat, 'ingreso');
    const soloPrepago = plMes(null, movimientos.slice(0, 4));
    for (const field of ['ingExp', 'expGHL', 'expDaniel', 'ingOpUSD', 'res']) {
      equalNumber(field, soloPrepago[field], 0);
    }
  });

  // El ledger mantiene 1571 entradas; los dos asientos generados no son histórico.
  check('total histórico', () => equalNumber('entradas originales', raw.length, 1571));
  check('total normalizado', () => {
    equalNumber('históricos normalizados', normalized.filter(t=>t.historico).length, 1571);
    equalNumber('incluidos reversos', normalized.length, 1573);
  });
  check('total combinado', () => equalNumber('incluidos reversos', txns.length, 1573));

  check('dos reversos reales en septiembre, con CLP y clasificación originales', () => {
    const reversos = normalized.filter(t=>t.reverso);
    assert.equal(reversos.length, 2);
    assert.deepEqual(reversos.map(t=>[dk(t.date), t.cat, t.sub, t.monto]).sort(), [
      ['2026-09-01', 'team', 'finiquito', 2598340],
      ['2026-09-01', 'team', 'nomina', 1040626],
    ]);
    for (const provision of normalized.filter(t=>t.provision)) {
      const reverso = reversos.find(t=>t.desc.includes(provision.desc));
      assert.ok(reverso, 'cada provisión debe generar su reverso');
      assert.equal(reverso.monto, -provision.monto);
      assert.equal(reverso.montoOrig, reverso.monto);
      assert.equal(reverso.usd, false);
      assert.equal(reverso.provision, false);
      assert.equal(reverso.historico, false);
    }
    equalNumber('conversión exacta Guillermo', -Math.round(-1134 * 917.66), 1040626);
    equalNumber('resultado septiembre sin cartolas', plMes('2026-09').res, 3638966);
  });
  check('una provisión sola genera reverso, incluso al cambiar de año', () => {
    const rawCaso = [{date:'2026-12-31',desc:'Provisión sueldo prueba',monto:-12345,src:'mp',provision:true}];
    const copia = JSON.stringify(rawCaso);
    const movimientos = normalizeHistorico(rawCaso, rate);
    assert.equal(movimientos.length, 2);
    assert.equal(movimientos[1].reverso, true);
    assert.equal(dk(movimientos[1].date), '2027-01-01');
    assert.equal(movimientos[1].monto, 12345);
    assert.equal(movimientos[1].cat, movimientos[0].cat);
    assert.equal(movimientos[1].sub, movimientos[0].sub);
    assert.equal(JSON.stringify(rawCaso), copia, 'no muta el histórico');
    assert.equal(normalizeHistorico([{...rawCaso[0],provision:false}], rate).length, 1);
  });
  check('provisión y pago real: costo cero al pagar y X entre ambos meses', () => {
    const X = 123456;
    const movimientos = normalizeHistorico([
      {date:'2026-07-31',desc:'Provisión finiquito prueba',monto:-X,src:'mp',provision:true},
      {date:'2026-08-10',desc:'Pago finiquito prueba',monto:-X,src:'mp'},
    ], rate);
    equalNumber('costo julio', plMes('2026-07', movimientos).finiquito, X);
    equalNumber('costo agosto neto', plMes('2026-08', movimientos).finiquito, 0);
    equalNumber('costo conjunto', plMes(null, movimientos).finiquito, X);
    equalNumber('resultado conjunto', plMes(null, movimientos).res, -X);
    assert.equal(movimientos.filter(esMovimientoBancario).length, 1);
  });
  check('pago USD conserva diferencia de cambio tras el reverso', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-08-31',desc:'Provisión sueldo prueba',monto:-1134,src:'relay',usd:true,provision:true},
      {date:'2026-09-03',desc:'Sueldo Guillermo',monto:-1134,src:'relay',usd:true},
    ], rate);
    equalNumber('diferencia de cambio', plMes('2026-09', movimientos).nomina,
      -Math.round(-1134 * rate()) - 1040626);
  });
  check('reverso eXp reduce costo sin convertirse en ingreso', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-08-31',desc:'Provisión Daniel Álvarez',monto:-100,src:'g66',provision:true},
      {date:'2026-09-03',desc:'Pago Daniel Álvarez',monto:-100,src:'g66'},
    ], rate);
    const septiembre = plMes('2026-09', movimientos);
    for (const campo of ['expDaniel', 'gastoExp', 'resExp', 'ingExp', 'ingOpUSD']) {
      equalNumber(campo, septiembre[campo], 0);
    }
    equalNumber('costo total eXp', plMes(null, movimientos).expDaniel, 100);
  });
  check('asientos excluidos de cuentas y del último cierre bancario T3', () => {
    equalNumber('movimientos bancarios', normalized.filter(esMovimientoBancario).length, 1569);
    const sinAsientos = normalized.filter(esMovimientoBancario);
    equalNumber('saldo agregado T3', plMes(null).saldoPrepagoExp, plMes(null, sinAsientos).saldoPrepagoExp);
    equalNumber('saldo USD agregado T3', plMes(null).saldoPrepagoExpUSD, plMes(null, sinAsientos).saldoPrepagoExpUSD);
  });

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

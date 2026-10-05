'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHistorico, mergeTxnArrays, computePL, pd, dk, esMovimientoBancario, lineaDe, esPrepagoExp } = require('../logica.js');

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
    '2026-01': [-14558937, -14108408, -454507],
    '2026-02': [-90780, 343130, -437961],
    '2026-03': [8053463, 8518043, -464944],
    '2026-04': [-5180118, -4712272, -467846],
    '2026-05': [-4166756, -6813168, 2644876],
    '2026-06': [-835768, -1381401, 544865],
    '2026-07': [2529956, -5516355, 5460071],
    // Agosto: prepago menos consumo de países es un pasivo, no resultado.
    // Se retiran $1.742.131 de res y resExp; Acelerador no cambia.
    // T6: finiquito final de Ignacio aumenta de $480.000 a $2.598.340:
    // res y resAcel bajan $2.118.340; resExp conserva el ajuste T3.
    // T7: devolución sueldo +$275.298; suscripción $453.055 pasa a eXp.
    '2026-08': [2091159, -1139842, 3231001],
    // Septiembre: caja con devoluciones, Household, reversos de provisiones
    // de finiquito y sueldo de agosto; suscripción eXp propia y países fuera
    // del resultado. Incluye $120.549 de ingresos no operacionales en res.
    '2026-09': [2165857, -1609980, 3655288],
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
  for (const mes of Object.keys(references)) {
    check(`${mes} costo del servicio neto no negativo`, () => {
      assert.ok(plMes(mes).costoServ >= 0, `${mes}: ${plMes(mes).costoServ}`);
    });
  }
  for (const [fecha, src, monto] of [
    ['2026-06-25', 'santander', -472225],
    ['2026-07-14', 'mp', -464420],
    ['2026-07-29', 'mp', -468080],
  ]) {
    check(`${fecha} recarga GHL es consumo`, () => {
      const matches = txns.filter(t=>dk(t.date)===fecha && t.src===src && t.montoOrig===monto);
      assert.equal(matches.length, 1);
      assert.equal(`${matches[0].cat}/${matches[0].sub}`, 'costo_servicio/ghl');
    });
  }
  check('plan MP de US$298 sigue como herramienta', () => {
    const t = txns.find(t=>dk(t.date)==='2026-07-08' && t.src==='mp' && t.montoOrig===-277875);
    assert.ok(t);
    assert.equal(`${t.cat}/${t.sub}`, 'overhead/herramienta');
  });
  check('excepción MP exige fecha, fuente y monto exactos', () => {
    const caso = {date:'2026-08-07',src:'mp',desc:'MP: Highlevel Inc.',monto:-453055};
    // Esta fecha no coincide con la excepción de agosto.
    const [otro] = normalizeHistorico([{...caso,date:'2026-09-07'}], () => 1000);
    assert.equal(otro.cat, 'costo_servicio');
    for (const cambio of [{date:'2026-08-08'}, {src:'santander'}, {monto:-453056}]) {
      const [t] = normalizeHistorico([{...caso,...cambio}], rate);
      assert.equal(`${t.cat}/${t.sub}`, 'costo_servicio/ghl');
    }
  });
  check('libro parcial: suscripción MP no se refactura como consumo a eXp', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-07-08',desc:'MP: Highlevel Inc.',monto:-277875,src:'mp'},
    ], rate);
    const pl = plMes('2026-07', movimientos);
    equalNumber('ghlRef', pl.ghlRef, 0);
    equalNumber('costoServ', pl.costoServ, 0);
    equalNumber('resExp', pl.resExp, 0);
    equalNumber('resAcel', pl.resAcel, -277875);
  });
  check('suscripción Relay AC de US$297 usa monto original', () => {
    const t = txns.find(t=>dk(t.date)==='2026-08-05' && t.src==='relay' && t.montoOrig===-297);
    assert.ok(t);
    assert.equal(t.monto, -272545);
    assert.equal(`${t.cat}/${t.sub}`, 'overhead/herramienta');
  });
  check('excepción MP agosto y cargos similares de julio', () => {
    const t = txns.find(t=>dk(t.date)==='2026-08-07' && t.src==='mp' && t.montoOrig===-453055);
    assert.ok(t);
    assert.equal(`${t.cat}/${t.sub}`, 'overhead/herramienta');
    assert.equal(lineaDe(t, rate), 'exp');
    for (const monto of [-464420, -468080]) {
      const julio = txns.find(t=>dk(t.date).startsWith('2026-07') && t.src==='mp' && t.montoOrig===monto);
      assert.ok(julio);
      assert.equal(lineaDe(julio, rate), 'acelerador');
    }
    for (const cambio of [{date:pd('2026-08-08')}, {src:'santander'}, {montoOrig:-453056}]) {
      assert.equal(lineaDe({...t,...cambio}, rate), 'acelerador');
    }
  });
  check('From Sueldo Guillermo reduce nómina por $275.298', () => {
    const retornos = txns.filter(t=>t.historico && dk(t.date).startsWith('2026-08') && t.cat==='team' && t.monto>0);
    assert.equal(retornos.length, 1);
    const t = retornos[0];
    assert.equal(dk(t.date), '2026-08-04');
    assert.equal(t.desc, 'From Sueldo Guillermo — Transfer');
    equalNumber('retorno CLP', t.monto, Math.round(300 * 917.66));
    equalNumber('reducción nómina', plMes('2026-08').nomina,
      plMes('2026-08', txns.filter(x=>x!==t)).nomina - 275298);
    const otros = normalizeHistorico([
      {date:'2026-08-04',desc:'From Sueldo Karim',monto:100,src:'relay',usd:true},
      {date:'2026-08-04',desc:'Sueldo Guillermo',monto:200,src:'relay',usd:true},
      {date:'2026-08-04',desc:'Josna',monto:300,src:'relay',usd:true},
    ], rate);
    equalNumber('solo From Sueldo resta', plMes('2026-08', otros).nomina, -91766);
    equalNumber('otros positivos team excluidos', plMes('2026-08', otros).colabUSD, 0);
  });
  check('suscripción eXp septiembre es gasto propio y no prepago', () => {
    const movimientos = normalizeHistorico([
      {date:'2026-09-01',desc:'InmoCRM eXp — ACH',monto:1000,src:'relay',usd:true},
      {date:'2026-09-05',desc:'HighLevel — InmoCRM eXp',monto:-497,src:'relay',usd:true},
      {date:'2026-09-14',desc:'HighLevel — InmoCRM eXp',monto:-300,src:'relay',usd:true},
    ], rate);
    const t = movimientos[1];
    assert.equal(`${t.cat}/${t.sub}`, 'overhead/herramienta');
    assert.equal(esPrepagoExp(t, rate), false);
    assert.equal(lineaDe(t, rate), 'exp');
    const pl = plMes('2026-09', movimientos);
    equalNumber('gasto suscripción', pl.expGHL, Math.round(497 * 947.27));
    equalNumber('resultado eXp', pl.resExp, -Math.round(497 * 947.27));
    equalNumber('saldo países', pl.saldoPrepagoExpUSD, 700);
    const consumo = txns.find(t=>dk(t.date)==='2026-08-14' && t.src==='relay' && t.montoOrig===-300);
    assert.ok(consumo);
    assert.equal(`${consumo.cat}/${consumo.sub}`, 'prepago_exp/consumo');
  });
  check('rangos inclusivos en USD y CLP, HighLevel y AppLevel', () => {
    for (const usd of [true, false]) for (const marca of ['HighLevel', 'AppLevel'])
      for (const src of ['mp', 'santander', 'relay']) for (const subcuenta of [false, true]) {
      for (const importe of [289.99, 290, 315, 315.01, 489.99, 490, 525, 525.01]) {
        const suscripcion = (importe>=290 && importe<=315) || (importe>=490 && importe<=525 && src==='relay' && subcuenta);
        const [t] = normalizeHistorico([{date:'2026-08-05',desc:marca+(subcuenta?' — InmoCRM AC':''),
          monto:usd?-importe:-importe*917.66,usd,src}], rate);
        assert.equal(t.cat, suscripcion?'overhead':'costo_servicio', `${marca} ${importe} usd=${usd} src=${src} subcuenta=${subcuenta}`);
      }
    }
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
    // Septiembre usa su TC SII; octubre todavía usa el callback (950).
    equalNumber('TC septiembre', plMes('2026-09', movimientos).saldoPrepagoExp, 94727 + 25);
    equalNumber('respaldo TC', plMes('2026-10', movimientos).saldoPrepagoExp, 95000 + 25);
    movimientos.push(...normalizeHistorico([
      {date:'2026-09-30',desc:'Compra oficina',monto:-10,src:'santander'},
    ], rate));
    equalNumber('último mes con TC SII', plMes(null, movimientos).saldoPrepagoExp, 94727 + 25);
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

  // El ledger mantiene 1838 entradas; los dos asientos generados no son histórico.
  check('total histórico', () => equalNumber('entradas originales', raw.length, 1838));
  check('total normalizado', () => {
    equalNumber('históricos normalizados', normalized.filter(t=>t.historico).length, 1838);
    equalNumber('incluidos reversos', normalized.length, 1840);
  });
  check('total combinado', () => equalNumber('incluidos reversos', txns.length, 1840));

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
    equalNumber('resultado septiembre sin cartolas', plMes('2026-09', normalized.filter(t=>t.reverso)).res, 3638966);
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
      -Math.round(-1134 * 947.27) - 1040626);
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
    equalNumber('movimientos bancarios', normalized.filter(esMovimientoBancario).length, 1836);
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

  check('histórico anterior a septiembre intacto y libro ordenado', () => {
    const crypto = require('node:crypto');
    const anteriores = raw.filter(t=>t.date<'2026-09');
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(anteriores)).digest('hex'),
      'b0511985caf2061d6d8d23e80ba4090a9d744c667079464079fcc4746456653e');
    assert.ok(raw.every((t,i)=>!i || t.date>=raw[i-1].date));
  });
  const sepRaw = raw.filter(t=>t.date.startsWith('2026-09'));
  const sep = normalized.filter(t=>t.historico && dk(t.date).startsWith('2026-09'));
  const sumaOriginal = ts => ts.reduce((s,t)=>s+Math.round(t.montoOrig*100),0)/100;
  check('septiembre: 267 movimientos y cero sin clasificar', () => {
    assert.equal(sepRaw.length,267);
    assert.equal(sep.filter(t=>t.sub==='sin_clasificar').length,0);
  });
  for (const [src,usd,cuenta,n,neto] of [
    ['mp',false,null,42,-886213], ['santander',false,null,20,-46],
    ['scotiabank',false,null,10,300000], ['g66',true,null,16,-4.77],
    ['g66',false,null,3,-3114], ['relay',true,'Business Checking',118,672.70],
    ['relay',true,'InmoCRM AC',42,-10], ['relay',true,'InmoCRM eXp',10,-870],
    ['relay',true,'Overhead HH',6,21.74],
  ]) check(`septiembre conciliación ${src} ${cuenta||''} ${usd?'USD':'CLP'}`, () => {
    const ts=sep.filter(t=>t.src===src && t.usd===usd && (!cuenta||t.cuenta===cuenta));
    assert.equal(ts.length,n);
    equalNumber('neto moneda original',sumaOriginal(ts),neto);
  });
  // Cada caso exige cantidad y monto además de categoría: no pasa con una
  // selección vacía ni si desaparece una de las patas o pagos repetidos.
  function casoSep(label, filtro, n, monto, cat, sub, linea='acelerador') {
    check(`septiembre ${label}`, () => {
      const ts=sep.filter(filtro);
      assert.equal(ts.length,n);
      equalNumber('monto original',sumaOriginal(ts),monto);
      for (const t of ts) {
        assert.equal(t.cat,cat,t.desc);
        if(sub) assert.equal(t.sub,sub,t.desc);
        assert.equal(lineaDe(t,rate),linea,t.desc);
      }
    });
  }
  casoSep('Lisdey cuota 2',t=>/LISDEY/i.test(t.desc),1,-300,'ingreso','devolucion');
  casoSep('Daniel Relay',t=>t.src==='relay'&&/DANIEL/i.test(t.desc),1,-243,'team','socio_exp','exp');
  casoSep('Josna Mahalo',t=>/MAHALO/i.test(t.desc),1,-500,'team','colab_usd');
  casoSep('Household',t=>t.cuenta==='Overhead HH'&&t.monto<0,4,-128.26,'overhead','household');
  casoSep('Railway Tavern',t=>/TAVERN/i.test(t.desc),1,-5,'overhead','bienestar');
  casoSep('Grok y Cursor',t=>/GROK|CURSOR/i.test(t.desc),2,-50,'overhead','herramienta');
  casoSep('Relay Banking Fees',t=>/BANKING FEES/i.test(t.desc),1,-8,'overhead','bancario');
  casoSep('países G66 incluido EXPWORLD Ecuador',t=>t.src==='g66'&&/RECEPCIÓN/i.test(t.desc),5,3464.65,'ingreso','transferencia','exp');
  casoSep('Daniel G66',t=>t.src==='g66'&&/DANIEL/i.test(t.desc),3,-2582,'team','socio_exp','exp');
  casoSep('cinco comisiones recepción G66',t=>t.src==='g66'&&t.desc==='Cargo por servicio',5,-50,'overhead','bancario');
  casoSep('costo cambio',t=>/COSTO DE TIPO/i.test(t.desc),1,-14.24,'overhead','bancario');
  casoSep('intereses G66',t=>/INTERESES GANADOS/i.test(t.desc),1,0.58,'ingreso','no_operacional');
  casoSep('conversión USD',t=>t.src==='g66'&&/CONVERSIÓN/i.test(t.desc)&&t.usd,1,-823.76,'other','transferencia_interna');
  casoSep('conversión CLP',t=>t.src==='g66'&&/CONVERSIÓN/i.test(t.desc)&&!t.usd,1,791740,'other','transferencia_interna');
  casoSep('finiquito Ignacio',t=>/RIVERA ZAMORA/i.test(t.desc),2,-2598340,'team','finiquito');
  casoSep('sueldos MP socios',t=>t.src==='mp'&&t.monto<0&&/KARIM|GUILLERMO/i.test(t.desc),8,-3600000,'team','nomina');
  casoSep('sueldos Relay netos',t=>t.src==='relay'&&/SUELDO/i.test(t.desc),20,-2600,'team','nomina');
  casoSep('Nury y Alexandra',t=>t.src==='mp'&&/NURY|ALEXANDRA/i.test(t.desc),2,-1628651,'team','nomina');
  casoSep('Claudia',t=>/CLAUDIA/i.test(t.desc),1,-190108,'team','comision');
  casoSep('siete ingresos MP internos',t=>t.src==='mp'&&/INGRESO DE DINERO/i.test(t.desc),7,4205870,'other','transferencia_interna');
  casoSep('cuota cliente MP 30 septiembre',t=>t.src==='mp'&&dk(t.date)==='2026-09-30'&&t.montoOrig===450000,1,450000,'ingreso','mercadopago');
  casoSep('Paris y reembolso personal',t=>/REEMBOLSO PAGO PERSONAL/i.test(t.desc),2,6,'other','anulado');
  casoSep('venta muebles Álvaro',t=>/SOTO ZUNIGA/i.test(t.desc),1,120000,'ingreso','no_operacional');
  casoSep('cowork Wedo',t=>/WEDO/i.test(t.desc),1,-218942,'overhead','arriendo');
  casoSep('devolución Urban Green',t=>/URBAN GREEN/i.test(t.desc),1,-150000,'ingreso','devolucion');
  casoSep('reserva Urban Green cobrada',t=>t.src==='scotiabank'&&t.montoOrig===150000,1,150000,'ingreso','transferencia');
  casoSep('eXp Chile',t=>t.src==='santander'&&/EXP CHILE/i.test(t.desc),8,2818234,'ingreso','transferencia','exp');
  casoSep('prepago recibido países',t=>t.src==='relay'&&t.cat==='prepago_exp'&&t.monto>0,15,2085.46,'prepago_exp','prepago','exp');
  casoSep('ACH Pull países',t=>/ACH PULL/i.test(t.desc),1,-24.93,'prepago_exp','consumo','exp');
  casoSep('consumo países',t=>t.cuenta==='InmoCRM eXp'&&/HIGHLEVEL/i.test(t.desc)&&t.montoOrig!==-497,6,-1330,'prepago_exp','consumo','exp');
  casoSep('suscripción eXp',t=>t.cuenta==='InmoCRM eXp'&&t.montoOrig===-497,1,-497,'overhead','herramienta','exp');
  casoSep('suscripción AC',t=>t.cuenta==='InmoCRM AC'&&t.montoOrig===-497,1,-497,'overhead','herramienta');
  casoSep('consumo AC',t=>t.cuenta==='InmoCRM AC'&&/HIGHLEVEL/i.test(t.desc)&&t.montoOrig!==-497,27,-519.54,'costo_servicio','ghl');
  check('septiembre traspasos Relay: ambas patas excluidas', () => {
    const ts=sep.filter(t=>t.src==='relay'&&/TRASPASO INTERNO/i.test(t.desc));
    assert.equal(ts.length,38);
    equalNumber('neto traspasos',sumaOriginal(ts),0);
    for(const t of ts) assert.equal(`${t.cat}/${t.sub}`,'other/transferencia_interna');
  });
  check('ZapSign fecha de compra septiembre', () => {
    const ts=sep.filter(t=>/ZAPSIGN/i.test(t.desc));
    assert.equal(ts.length,1);
    assert.equal(dk(ts[0].date),'2026-09-30');
    equalNumber('cargo USD',ts[0].montoOrig,-12.12);
  });
  check('septiembre finiquito neto y saldo países', () => {
    const pl=plMes('2026-09');
    equalNumber('finiquito neteado',pl.finiquito,0);
    equalNumber('saldo países USD',pl.saldoPrepagoExpUSD,2628.98);
    equalNumber('nómina neta de retornos y reverso',pl.nomina,6650926);
  });
  check('todo costo Acelerador entra a gastoAcel', () => {
    const costos=txns.filter(t=>lineaDe(t,rate)==='acelerador' &&
      ['team','overhead','pauta','impuestos','costo_servicio'].includes(t.cat) &&
      (t.monto<0 || t.reverso || (t.monto>0&&t.cat==='team'&&/FROM SUELDO/i.test(t.desc))));
    assert.ok(costos.length>0);
    for(const t of costos) {
      const pl=plMes(null,[t]);
      // El consumo refacturado sí entró al costo, luego pasó a eXp.
      equalNumber(`${dk(t.date)} ${t.desc}`,pl.gastoAcel+pl.ghlRef,-t.monto);
    }
  });
  check('overhead nuevo aparece en total y Otros sin enumerar subcategoría', () => {
    const [t]=normalizeHistorico([{date:'2026-09-30',desc:'prueba',monto:-123,src:'mp'}],rate);
    const pl=plMes('2026-09',[{...t,cat:'overhead',sub:'rubro_futuro'}]);
    equalNumber('total overhead',pl.totalOH,123);
    equalNumber('Otros',pl.otrosOH,123);
    equalNumber('gasto Acelerador',pl.gastoAcel,123);
    for(const mes of Object.keys(references)) {
      const p=plMes(mes);
      equalNumber(`${mes} filas overhead`,p.herr+p.arr+p.adv+p.banc+p.tel+p.otrosOH,p.totalOH);
    }
  });

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

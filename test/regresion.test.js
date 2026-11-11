'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHistorico, mergeTxnArrays, computePL, pd, dk, esMovimientoBancario, lineaDe, esPrepagoExp, clasificarPrepagoExp, TC_MENSUAL, PREVIRED_DEVENGO_DESDE, PREVIRED_MENSUAL, esPagoDeudaPrevired, txnMk } = require('../logica.js');

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
  // T9: desde mayo PREVIRED usa el costo mensual devengado; los pagos
  // desde junio reducen deuda. Cambian res y resAcel, nunca resExp.
  const references = {
    '2026-01': [-14558937, -14108408, -454507],
    '2026-02': [-90780, 343130, -437961],
    '2026-03': [8053463, 8518043, -464944],
    '2026-04': [-5180118, -4712272, -467846],
    '2026-05': [-3312356, -5958768, 2644876],
    '2026-06': [-3095569, -3641202, 544865],
    // T12: Stripe directo (productos/SaaS/fees), payouts como traspasos y
    // pagos variables HighLevel como costo. Impacto revisado antes de actualizar.
    // Corrección T12: consumo wallet reconocido como ingreso eXp: +$1.484.902,
    // +$760.241 y +$1.985.895 en ago/sep/oct. Acelerador no cambia.
    // Enero–julio conservan las referencias de T12 inicial.
    '2026-07': [3739944, -4306367, 5460071],
    '2026-08': [463821, -2779416, 3243237],
    // Sep −1.364 y oct +24.125: el importador ahora carga los pagos reembolsados
    // (cobro, comisión que Stripe no devuelve y reembolso en su propia fecha).
    '2026-09': [900578, -2343961, 3123990],
    '2026-10': [8474294, -3688698, 12162894],
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
    equalNumber('resAcel', pl.resAcel, -277875-PREVIRED_MENSUAL['2026-07']);
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
    equalNumber('gasto suscripción', pl.expGHL, Math.round(497 * 947.27)+Math.round(300 * 947.27));
    equalNumber('resultado eXp', pl.resExp, plMes('2026-09',[]).resExp-Math.round(497 * 947.27)-Math.round(300 * 947.27));
    assert.equal(movimientos[0].sub, 'transferencia_interna');
    const consumo = txns.find(t=>dk(t.date)==='2026-08-14' && t.src==='relay' && t.montoOrig===-300);
    assert.ok(consumo);
    assert.equal(`${consumo.cat}/${consumo.sub}`, 'costo_servicio/ghl');
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

  // T12 reemplaza los tests del antiguo pasivo ACH menos pagos por el
  // ledger Stripe y el rebilling GHL, con cortes y monedas independientes.
  check('importador Stripe: neto, status, corte UTC e idempotencia',()=>{
    require('node:child_process').execFileSync('python3',['-B','-c',`
import csv, importlib.util, json, pathlib, subprocess, sys, tempfile
spec=importlib.util.spec_from_file_location('stripe', 'scripts/importar_stripe.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
row={'id':'ch_test','Created date (UTC)':'2026-10-31 23:59:59','Amount':'100.00',
     'Amount Refunded':'25.15','Fee':'3.20','Status':'Paid','Currency':'usd',
     'Description':'Workshop, con comas\\nsegunda línea','Statement Descriptor':'ACELERADOR INMOB',
     'walletId (metadata)':'','entityId (metadata)':'','saasPlanId (metadata)':''}
assert [t['monto'] for t in mod.movimientos(row,'2026-10-31')]==[100.0,-3.2,-25.15]
assert mod.movimientos(dict(row,Status='Failed'),'2026-10-31')==[]
assert [t['monto'] for t in mod.movimientos(dict(row,Status='Refunded',**{'Refunded date (UTC)':'2026-10-31 23:59:59'}),'2026-10-31')]==[100.0,-3.2,-25.15]
assert mod.movimientos(dict(row,**{'Created date (UTC)':'2026-11-01 00:00:00'}),'2026-10-31')==[]
with tempfile.TemporaryDirectory() as tmp:
    csvfile=pathlib.Path(tmp)/'stripe.csv'; ledger=pathlib.Path(tmp)/'historico.json'
    ledger.write_text('[]')
    with csvfile.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=row); w.writeheader(); w.writerow(row)
    cmd=[sys.executable,'-B','scripts/importar_stripe.py',str(csvfile),'--hasta','2026-10-31','--historico',str(ledger)]
    subprocess.check_call(cmd,stdout=subprocess.DEVNULL)
    original=ledger.read_bytes()
    subprocess.check_call(cmd,stdout=subprocess.DEVNULL)
    assert ledger.read_bytes()==original
    assert json.loads(original)[0]['desc']==row['Description']
`],{cwd:path.join(__dirname,'..')});
  });
  check('Stripe: 150 cobros (Paid y Refunded) hasta octubre con su fee, sin noviembre', () => {
    const stripe=raw.filter(t=>t.src==='stripe');
    assert.equal(stripe.length,301);   // 150 cobros + 150 fees + 1 reembolso hasta el corte (sin verificaciones de tarjeta)
    assert.equal(new Set(stripe.map(t=>t.stripeId)).size,150);
    assert.ok(stripe.every(t=>t.usd && t.date<='2026-10-31'));
    for(const t of stripe.filter(t=>t.stripeTipo==='cobro'))
      assert.equal(stripe.filter(f=>f.stripeId===t.stripeId&&f.stripeTipo==='fee').length,1);
  });
  for(const [label,filtro,cat,sub,linea,pais] of [
    ['CL real',t=>/Sub-Account - CL/.test(t.desc),'prepago_exp','prepago','exp','CL'],
    ['MX descripción manda sobre entityId de Karim',t=>/Sub-Account - MX/.test(t.desc),'prepago_exp','prepago','exp','MX'],
    ['BR descripción manda sobre entityId sin país',t=>/Sub-Account - BR/.test(t.desc),'prepago_exp','prepago','exp','BR'],
    ['CL manual',t=>/Manual Recharge/.test(t.desc)&&t.entityId==='XMQPGYDIk8qnssDMW1oX','prepago_exp','prepago','exp','CL'],
    ['sin país',t=>/Manual Recharge/.test(t.desc)&&t.entityId==='1hLHWISsV3Zo9qE608zq','prepago_exp','prepago','exp','eXp sin país (Daniel, Qualitá)'],
    ['aporte Karim',t=>/Manual Recharge/.test(t.desc)&&t.entityId==='Zr7BpeEMLEcTzko2DdeI','other','aporte_socio','exp',undefined],
    ['SaaS metadata',t=>!!t.saasPlanId,'ingreso','saas','exp',undefined],
    ['SaaS creación sin metadata',t=>t.desc==='Subscription creation'&&!t.saasPlanId,'ingreso','saas','exp',undefined],
    ['campaña',t=>t.desc==='Campaña de Captación en 90 min ($17)','ingreso','stripe_producto','acelerador',undefined],
    ['plantillas',t=>/Plantillas/.test(t.desc),'ingreso','stripe_producto','acelerador',undefined],
    ['workshop',t=>/Workshop/.test(t.desc),'ingreso','stripe_producto','acelerador',undefined],
    ['descriptor Acelerador',t=>t.desc==='ACELERADOR INMOB','ingreso','stripe_producto','acelerador',undefined],
  ]) check('Stripe clasificación '+label,()=>{
    const t=txns.find(t=>t.src==='stripe'&&t.stripeTipo==='cobro'&&filtro(t));
    assert.ok(t,label);
    assert.equal(t.cat,cat);assert.equal(t.sub,sub);assert.equal(lineaDe(t,rate),linea);assert.equal(t.pais,pais);
    const fee=txns.find(f=>f.stripeId===t.stripeId&&f.stripeTipo==='fee');
    assert.equal(fee.cat,'overhead');assert.equal(fee.sub,'bancario');assert.equal(lineaDe(fee,rate),linea);
  });
  check('aporte Karim principal no afecta resultados ni deuda países',()=>{
    const aporte=txns.find(t=>t.sub==='aporte_socio');
    assert.equal(aporte.montoOrig,500);
    const sin=plMes('2026-10',txns.filter(t=>t!==aporte)), con=plMes('2026-10');
    for(const k of ['res','resAcel','resExp','deudaPaisesUSD','porCobrarPaisesUSD']) equalNumber(k,con[k],sin[k]);
    equalNumber('saldo Stripe incluye aporte',Math.round((con.saldoStripeUSD-sin.saldoStripeUSD)*100),50000);
    // La comisión bancaria de US$14,80 sí es costo, como los demás fees.
  });
  check('deuda por país al 31-oct y control septiembre',()=>{
    const p=plMes('2026-10');
    for(const [pais,saldo] of Object.entries({CL:8.08,EC:469.53,COL:426.19,PR:434.40,BR:-254.58,MX:34.75,RD:-114.56,PE:-76.12,'eXp sin país (Daniel, Qualitá)':799}))
      equalNumber(pais,p.detallePaises[pais].saldoUSD,saldo);
    equalNumber('pasivos sin compensar',p.deudaPaisesUSD,2171.95);
    equalNumber('activos sin compensar',p.porCobrarPaisesUSD,445.26);
    const sep=plMes('2026-09');
    for(const [pais,saldo] of Object.entries({EC:330.64,COL:467.42,PR:493.86}))
      equalNumber(pais,sep.detallePaises[pais].saldoUSD,saldo);
    // MX: recarga de agosto pasa a saldo inicial en octubre, sin duplicarla.
    equalNumber('MX saldo inicial',p.detallePaises.MX.saldoInicialUSD,10);
    equalNumber('MX aún sin wallet septiembre',sep.detallePaises.MX.saldoInicialUSD,0);
    equalNumber('MX recargas desde octubre',p.detallePaises.MX.recargasUSD,250);
    equalNumber('BR antes de wallet',sep.detallePaises.BR.consumoUSD,0);
  });
  // Efecto de cargar los pagos reembolsados (ver referencias de sep y oct).
  const AJUSTE_REEMBOLSOS={'2026-09':-1364,'2026-10':24125};
  check('consumo wallet es ingreso eXp del mes, separado de fees y caja',()=>{
    const controles=[
      ['2026-08',1618.14,1484902,1758335,-1021081,-2779416],
      ['2026-09',802.56,760241,2363749,141701,-2342597],
      ['2026-10',2021.72,1985895,10176999,6464274,-3712823],
    ];
    for(const [mes,usd,clp,expAntes,resAntes,acelAntes] of controles){
      const p=plMes(mes), soloReporte=plMes(mes,[]);
      equalNumber(mes+' USD',p.ingExpConsumoRevendidoUSD,usd);
      equalNumber(mes+' CLP',p.ingExpConsumoRevendido,clp);
      equalNumber(mes+' TC',clp,Math.round(usd*TC_MENSUAL[mes]));
      equalNumber(mes+' incremento eXp',p.resExp-expAntes,clp);
      equalNumber(mes+' incremento total',p.res-resAntes,clp+(AJUSTE_REEMBOLSOS[mes]||0));
      equalNumber(mes+' Acelerador intacto',p.resAcel,acelAntes+(AJUSTE_REEMBOLSOS[mes]||0));
      equalNumber(mes+' ingreso sin cartola ficticia',soloReporte.ingExp,clp);
      equalNumber(mes+' caja sin movimiento',soloReporte.ingOpUSD,0);
      equalNumber(mes+' desglose ingreso',p.ingExp,p.ingExpFee+p.ingExpRefacturacion+clp);
    }
    for(const mes of ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'])
      equalNumber(mes+' sin ingreso wallet',plMes(mes).ingExpConsumoRevendido,0);
    equalNumber('agregado CLP por TC mensual',plMes(null).ingExpConsumoRevendido,4231038);
  });
  check('wallet: deuda neta + ingreso reconocido = recargas + saldo inicial',()=>{
    let reconocido=0;
    for(const mes of ['2026-08','2026-09','2026-10']){
      const p=plMes(mes);
      reconocido+=Math.round(p.ingExpConsumoRevendidoUSD*100);
      let consumo=0, fondos=0;
      for(const [pais,d] of Object.entries(p.detallePaises)){
        // Cuando el saldo es negativo, deuda neta = deuda menos por cobrar.
        equalNumber(mes+' '+pais,
          Math.round(d.deudaUSD*100)-Math.round(d.porCobrarUSD*100)+Math.round(d.consumoUSD*100),
          Math.round(d.recargasUSD*100)+Math.round(d.saldoInicialUSD*100));
        consumo+=Math.round(d.consumoUSD*100);
        fondos+=Math.round(d.recargasUSD*100)+Math.round(d.saldoInicialUSD*100);
      }
      equalNumber(mes+' consumo acumulado reconocido',consumo,reconocido);
      equalNumber(mes+' identidad consolidada',
        Math.round(p.deudaPaisesUSD*100)-Math.round(p.porCobrarPaisesUSD*100)+reconocido,fondos);
    }
  });
  check('memo acumulado, TC de cierre y meses futuros excluidos',()=>{
    const p=plMes('2026-10');
    equalNumber('Stripe',p.saldoStripeUSD,843.31);
    equalNumber('HighLevel',p.porPagarHighLevelUSD,1378.90);
    for(const campo of ['deudaPaises','porCobrarPaises','porPagarHighLevel','saldoStripe']){
      equalNumber(campo,p[campo],Math.round(p[campo+'USD']*982.28));
      equalNumber('total último cierre '+campo,plMes(null)[campo],p[campo]);
    }
    const futuro=normalizeHistorico([{...raw.find(t=>t.src==='stripe'&&t.walletId),date:'2026-11-01',monto:999}],rate);
    assert.deepEqual(plMes('2026-10',[...txns,...futuro]),p);
    for(const campo of ['deudaPaisesUSD','porCobrarPaisesUSD','porPagarHighLevelUSD','saldoStripeUSD'])
      equalNumber('junio '+campo,plMes('2026-06')[campo],0);
  });
  check('payouts ACH son traspasos; STRIPE — ACH de otra cuenta sigue ingreso',()=>{
    for(const desc of ['InmoCRM eXp — ACH','ACELERADOR INMOB — ACH','InmoCRM eXp — ACH Pull']){
      const [t]=normalizeHistorico([{date:'2026-09-01',desc,monto:100,usd:true,src:'relay',cat:'prepago_exp'}],rate);
      assert.equal(t.cat,'other');assert.equal(t.sub,'transferencia_interna');
      assert.equal(clasificarPrepagoExp(t,rate).cat,'other');
    }
    const ts=txns.filter(t=>t.src==='relay'&&t.desc==='STRIPE — ACH');
    assert.ok(ts.length);assert.ok(ts.every(t=>t.cat==='ingreso'));
  });

  // El ledger mantiene 2435 entradas; los dos asientos generados no son histórico.
  check('total histórico', () => equalNumber('entradas originales', raw.length, 2440));
  check('total normalizado', () => {
    equalNumber('históricos normalizados', normalized.filter(t=>t.historico).length, 2440);
    equalNumber('incluidos reversos', normalized.length, 2442);
  });
  check('total combinado', () => equalNumber('incluidos reversos', txns.length, 2442));

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
    equalNumber('resultado septiembre sin cartolas', plMes('2026-09', normalized.filter(t=>t.reverso)).res, 3638966+plMes('2026-09',[]).res);
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
    equalNumber('resultado conjunto', plMes(null, movimientos).res, -X-Object.values(PREVIRED_MENSUAL).reduce((s,v)=>s+v,0)+1484902);
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
      equalNumber(campo, septiembre[campo], plMes('2026-09',[])[campo]);
    }
    equalNumber('costo total eXp', plMes(null, movimientos).expDaniel, 100);
  });
  check('asientos excluidos de cuentas y del último cierre bancario T3', () => {
    equalNumber('movimientos bancarios', normalized.filter(esMovimientoBancario).length, 2438);
    const sinAsientos = normalized.filter(esMovimientoBancario);
    equalNumber('saldo agregado T3', plMes(null).deudaPaises, plMes(null, sinAsientos).deudaPaises);
    equalNumber('saldo USD agregado T3', plMes(null).deudaPaisesUSD, plMes(null, sinAsientos).deudaPaisesUSD);
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
    const anteriores = raw.filter(t=>t.src!=='stripe'&&t.date<'2026-09');
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(anteriores)).digest('hex'),
      'b0511985caf2061d6d8d23e80ba4090a9d744c667079464079fcc4746456653e');
    assert.ok(raw.every((t,i)=>!i || t.date>=raw[i-1].date));
  });
  const sepRaw = raw.filter(t=>t.src!=='stripe'&&t.date.startsWith('2026-09'));
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
  casoSep('payout Stripe recibido',t=>t.src==='relay'&&t.desc==='InmoCRM eXp — ACH'&&t.monto>0,15,2085.46,'other','transferencia_interna','exp');
  casoSep('ACH Pull países',t=>/ACH PULL/i.test(t.desc),1,-24.93,'other','transferencia_interna','exp');
  casoSep('consumo países',t=>t.cuenta==='InmoCRM eXp'&&/HIGHLEVEL/i.test(t.desc)&&t.montoOrig!==-497,6,-1330,'costo_servicio','ghl','exp');
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
    equalNumber('deuda países USD',pl.deudaPaisesUSD,1860.67);
    equalNumber('nómina neta de retornos y reverso',pl.nomina,6650926);
  });
  check('todo costo Acelerador entra a gastoAcel', () => {
    const costos=txns.filter(t=>lineaDe(t,rate)==='acelerador' &&
      ['team','overhead','pauta','impuestos','costo_servicio'].includes(t.cat) &&
      (t.monto<0 || t.reverso || (t.monto>0&&t.cat==='team'&&/FROM SUELDO/i.test(t.desc))));
    assert.ok(costos.length>0);
    for(const t of costos) {
      // Un anticipo solo cuenta en su propio mes (el agregado cierra en el último mes bancario).
      if(t.anticipo){ assert.equal(Math.round(plMes(txnMk(t),[t]).nomina), Math.round(-t.monto), t.desc); continue; }
      const pl=plMes(null,[t]);
      // El consumo refacturado sí entró al costo, luego pasó a eXp.
      assert.ok(Math.abs(pl.gastoAcel+pl.ghlRef-Object.values(PREVIRED_MENSUAL).reduce((s,v)=>s+v,0)-(esPagoDeudaPrevired(t)?0:-t.monto))<1e-6,t.desc);
    }
  });
  check('overhead nuevo aparece en total y Otros sin enumerar subcategoría', () => {
    const [t]=normalizeHistorico([{date:'2026-09-30',desc:'prueba',monto:-123,src:'mp'}],rate);
    const pl=plMes('2026-09',[{...t,cat:'overhead',sub:'rubro_futuro'}]);
    equalNumber('total overhead',pl.totalOH,123);
    equalNumber('Otros',pl.otrosOH,123);
    equalNumber('gasto Acelerador',pl.gastoAcel,123+PREVIRED_MENSUAL['2026-09']);
    for(const mes of Object.keys(references)) {
      const p=plMes(mes);
      equalNumber(`${mes} filas overhead`,p.herr+p.arr+p.adv+p.banc+p.tel+p.otrosOH,p.totalOH);
    }
  });

  check('PREVIRED mensual exacto incluso sin pagos', () => {
    for(const [mes,importe] of Object.entries(PREVIRED_MENSUAL)) {
      equalNumber(mes,plMes(mes,[]).previred,importe);
      equalNumber(mes,plMes(mes).previred,importe);
    }
  });
  check('PREVIRED informado para todos los meses cerrados con TC', () => {
    for(const [mes,tc] of Object.entries(TC_MENSUAL)) {
      if(mes>=PREVIRED_DEVENGO_DESDE&&tc!=null)
        assert.ok(Number.isFinite(PREVIRED_MENSUAL[mes]),`Falta PREVIRED_MENSUAL para mes cerrado ${mes}`);
    }
  });
  check('noviembre sin liquidación no lanza y señala PREVIRED pendiente', () => {
    let p;
    assert.doesNotThrow(()=>{p=plMes('2026-11');});
    assert.equal(p.previred,0);
    assert.equal(p.previredFaltante,true);
    assert.deepEqual(p.mesesPreviredFaltantes,['2026-11']);
    equalNumber('deuda sin liquidación noviembre',p.deudaPrevired,plMes('2026-10').deudaPrevired);
    assert.equal(p.nomina,2982280);
    assert.equal(plMes('2026-10').previredFaltante,false);
    assert.deepEqual(plMes('2026-10').mesesPreviredFaltantes,[]);
    assert.equal(plMes(null).previredFaltante,true);
    assert.deepEqual(plMes(null).mesesPreviredFaltantes,['2026-11']);
    assert.deepEqual(plMes('2026-12').mesesPreviredFaltantes,['2026-11','2026-12']);
  });
  check('pago octubre solo reduce deuda, nunca resultados', () => {
    for(const desc of ['PREVIRED','Isapre Consalud','AFP Habitat','FONASA']) {
      const pagos=normalizeHistorico([{date:'2026-10-08',desc,monto:-100000,src:'mp'}],rate);
      for(const mes of [...new Set([...Object.keys(references),'2026-10',null])]) {
        // Un movimiento neutro fija el mismo cierre bancario para el memo USD.
        const base=[...txns,...normalizeHistorico([{date:'2026-10-01',desc:'Relay: traspaso interno',monto:0,src:'relay'}],rate)];
        const antes=plMes(mes,base), despues=plMes(mes,[...base,...pagos]);
        for(const k of Object.keys(antes)) {
          if(typeof antes[k]==='number')
            equalNumber(`${mes} ${k}`,despues[k],antes[k]-(k==='deudaPrevired'&&(!mes||mes>='2026-10')?100000:0));
          else assert.deepEqual(despues[k],antes[k],`${mes} ${k}`);
        }
      }
    }
  });
  check('deuda PREVIRED cierres y límite bancario', () => {
    const deudas=[3003189,1993290,3399692,2914855,4417273];
    deudas.forEach((v,i)=>equalNumber('deuda',plMes(`2026-0${i+5}`).deudaPrevired,v));
    equalNumber('total último mes tabla',plMes(null).deudaPrevired,plMes('2026-10').deudaPrevired);
  });

  const octRaw=raw.filter(t=>t.src!=='stripe'&&t.date.startsWith('2026-10'));
  const oct=normalized.filter(t=>t.historico&&dk(t.date).startsWith('2026-10'));
  check('octubre: histórico anterior intacto, 301 nuevos y cero sin clasificar', () => {
    assert.equal(require('node:crypto').createHash('sha256')
      .update(JSON.stringify(raw.filter(t=>t.src!=='stripe'&&t.date<'2026-10'))).digest('hex'),
      'b54355d06e1ba94505bf5dbadea6d22904be6ddba4b6ade80590aee67708ac31');
    assert.equal(octRaw.length,301);
    assert.equal(oct.filter(t=>t.sub==='sin_clasificar').length,0);
    assert.ok(raw.every((t,i)=>!i||t.date>=raw[i-1].date));
  });
  for(const [src,usd,cuenta,n,neto] of [
    ['mp',false,null,34,517154],['santander',false,null,24,169683],
    ['scotiabank',false,null,25,956355],['g66',true,null,17,0.27],
    ['relay',true,'Business Checking',120,1119.68],['relay',true,'InmoCRM AC',58,120],
    ['relay',true,'InmoCRM eXp',17,-545.77],['relay',true,'Overhead HH',6,108.81],
  ]) check(`octubre conciliación ${src} ${cuenta||''}`,()=>{
    const ts=oct.filter(t=>t.src===src&&t.usd===usd&&(!cuenta||t.cuenta===cuenta));
    assert.equal(ts.length,n);
    equalNumber('neto',sumaOriginal(ts),neto);
  });
  function casoOct(label,filtro,n,monto,cat,sub,linea='acelerador') {
    check(`octubre ${label}`,()=>{
      const ts=oct.filter(filtro);
      assert.equal(ts.length,n);
      equalNumber('monto original',sumaOriginal(ts),monto);
      for(const t of ts) {
        assert.equal(`${t.cat}/${t.sub}`,`${cat}/${sub}`,t.desc);
        assert.equal(lineaDe(t,rate),linea,t.desc);
      }
    });
  }
  casoOct('Guillermo vía G66 CLP',t=>t.name==='Guillermo — sueldo vía Global66 CLP'&&!t.anticipo,4,-3100000,'team','nomina');
  casoOct('traspasos MP a Scotiabank',t=>t.src==='mp'&&/Agencia Convierte/.test(t.desc)&&['2026-10-08','2026-10-20'].includes(dk(t.date)),4,-1650000,'other','transferencia_interna');
  casoOct('refacturación Santander separada',t=>t.src==='santander'&&t.sub==='refacturacion_ghl',3,214721,'ingreso','refacturacion_ghl','exp');
  casoOct('fee Santander',t=>t.src==='santander'&&/EXP CHILE/i.test(t.desc)&&t.sub!=='refacturacion_ghl',8,5368752,'ingreso','transferencia','exp');
  casoOct('refacturación Perú',t=>t.src==='g66'&&t.sub==='refacturacion_ghl',1,55.17,'ingreso','refacturacion_ghl','exp');
  casoOct('devoluciones CLP',t=>!t.usd&&t.sub==='devolucion',3,-1950000,'ingreso','devolucion');
  casoOct('Lisdey cuota 3',t=>/LISDEY/i.test(t.desc),1,-300,'ingreso','devolucion');
  casoOct('Nury comisión',t=>t.src==='scotiabank'&&/NURY/i.test(t.desc),1,-174420,'team','comision');
  casoOct('Josna',t=>/MAHALO/i.test(t.desc),2,-950,'team','colab_usd');
  casoOct('crédito',t=>/Pago Cobranzas|Pago Cuota Crédito/.test(t.desc),2,-1377831,'impuestos','credito');
  casoOct('sobregiro',t=>/Sobregiro/.test(t.desc),1,-27,'overhead','bancario');
  casoOct('SII',t=>/SII/.test(t.desc),2,-461486,'impuestos','sii');
  casoOct('Skool ingresos',t=>/SKOOL — ACH/.test(t.desc),3,95.70,'ingreso','transferencia');
  casoOct('G66 a Relay',t=>t.src==='relay'&&/Agencia Conviert/.test(t.desc),1,2006,'other','transferencia_interna');
  casoOct('ahorro',t=>/Business Savings/.test(t.desc),1,-400,'other','transferencia_interna');
  casoOct('deuda PREVIRED e Isapre',t=>t.sub==='previred',9,-3626394,'team','previred');
  check('anticipos: cuatro pagos de octubre imputados a noviembre',()=>{
    const ts=oct.filter(t=>t.anticipo);
    assert.equal(ts.length,4);
    equalNumber('CLP',sumaOriginal(ts.filter(t=>!t.usd)),-2000000);
    equalNumber('USD',sumaOriginal(ts.filter(t=>t.usd)),-1000);
    for(const t of ts) {
      assert.equal(dk(t.date),'2026-10-30');
      assert.equal(txnMk(t),'2026-11');
      assert.equal(`${t.cat}/${t.sub}`,'team/nomina');
    }
    equalNumber('nómina octubre sin anticipos',plMes('2026-10').nomina,plMes('2026-10',txns.filter(t=>!t.anticipo)).nomina);
    equalNumber('nómina noviembre',ts.filter(t=>txnMk(t)==='2026-11').reduce((s,t)=>s-t.monto,0),2982280);
    assert.equal(txnMk({...ts[0],date:pd('2026-12-30')}),'2027-01');
  });
  check('octubre desglose del cierre',()=>{
    const p=plMes('2026-10');
    const esperado={ingOp:16398569,ingExp:13827639,ingExpFee:11572831,
      ingExpRefacturacion:268913,pauta:2363109,costoServ:545791,
      nomina:8693211,previred:1504464,colabUSD:3472360,comision:174420,
      totalTeam:13844455,totalOH:1494595,sii:461486,cred:1377831,
      expGHL:1598925,expBanc:65820,expDaniel:0,ingNoOp:98,
      deudaPaisesUSD:2171.95,porCobrarPaisesUSD:445.26,deudaPrevired:2295343};
    for(const [k,v] of Object.entries(esperado)) equalNumber(k,p[k],v);
    const devoluciones=oct.filter(t=>t.sub==='devolucion').reduce((s,t)=>s+t.monto,0);
    equalNumber('devoluciones',devoluciones,-2244684);
    equalNumber('ventas brutas',p.ingOp-devoluciones,18643253);
    equalNumber('memo total último cierre',plMes(null).deudaPrevired,p.deudaPrevired);
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
  // Hallazgos de la revisión adversarial de T9/T10 (resueltos por Opus).
  check('el agregado sin mes cuadra con la suma de los meses mostrados', () => {
    const ultimoBanco = txns.filter(esMovimientoBancario).reduce((u,t)=>{const k=dk(t.date).slice(0,7);return k>u?k:u;},'');
    const meses = [...new Set(txns.map(txnMk))].filter(k=>k<=ultimoBanco);
    const total = computePL({ txns, cobros: [], ventas: [], cuotas: [], rate, mes: null, ahora });
    const suma = meses.reduce((s,m)=>s+plMes(m).res,0);
    assert.equal(Math.round(total.res), Math.round(suma));
  });
  check('un anticipo exportado y vuelto a cargar sigue imputado al mes siguiente', () => {
    const ant = raw.filter(t=>t.anticipo);
    assert.equal(ant.length, 4);
    // Mismo mapeo que exportHistorico() en index.html: conserva la marca anticipo.
    const exportado = normalizeHistorico(raw, rate).filter(t=>t.anticipo).map(t=>({
      date: dk(t.date), desc: t.desc, monto: t.usd&&t.montoOrig!=null?t.montoOrig:t.monto,
      usd: !!t.usd, rut: t.rut||'', src: t.src, ...(t.anticipo?{anticipo:true}:{}) }));
    const recargado = normalizeHistorico(exportado, rate);
    assert.ok(recargado.every(t=>t.anticipo && txnMk(t)==='2026-11'));
    assert.match(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'), /anticipo:true/);
  });
  // Revisión adversarial de T12 (resuelto por Opus): reembolsos en el importador de Stripe.
  check('importador Stripe: Paid → Refunded no deja cobros obsoletos y es idempotente', () => {
    const os = require('node:os'); const cp = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-'));
    const hist = path.join(dir, 'h.json'); fs.writeFileSync(hist, '[]');
    const cols = ['id','Created date (UTC)','Amount','Amount Refunded','Currency','Fee','Refunded date (UTC)','Status','Description','Statement Descriptor','walletId (metadata)','entityId (metadata)','saasPlanId (metadata)'];
    const csvDe = fila => cols.join(',')+'\n'+cols.map(c=>fila[c]??'').join(',')+'\n';
    const base = {id:'ch_test','Created date (UTC)':'2026-10-06 10:00:00',Amount:'100.00',Currency:'usd',Fee:'3.00',Description:'Workshop'};
    const correr = (fila, hasta='2026-11-30') => { const f=path.join(dir,'x.csv'); fs.writeFileSync(f,csvDe(fila));
      const r=cp.spawnSync('python3',['-I',path.join(__dirname,'..','scripts','importar_stripe.py'),f,'--hasta',hasta,'--historico',hist]);
      assert.equal(r.status,0,String(r.stderr)); return JSON.parse(fs.readFileSync(hist,'utf8')); };
    const total = l => Math.round(l.reduce((s,t)=>s+t.monto,0)*100)/100;
    assert.equal(total(correr({...base,Status:'Paid','Amount Refunded':'0'})), 97);
    const reemb = {...base,Status:'Refunded','Amount Refunded':'100.00','Refunded date (UTC)':'2026-11-06 09:00:00'};
    let l = correr(reemb);
    assert.equal(total(l), -3);                       // se pierde la comisión, no el cobro
    assert.equal(l.find(t=>t.stripeTipo==='reembolso').date, '2026-11-06');
    assert.deepEqual(correr(reemb), l);               // idempotente
    assert.equal(total(correr(reemb,'2026-10-31')), 97); // reembolso posterior al corte queda fuera
  });
} catch (error) {
  failed++;
  console.error(`FALLO al preparar o calcular la regresión: ${error.stack || error.message}`);
}

console.log(`Regresión: ${passed} verificaciones pasaron; ${failed} fallaron.`);
process.exitCode = failed ? 1 : 0;

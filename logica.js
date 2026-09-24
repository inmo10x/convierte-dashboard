const RUT_MAP = {
  '16495676':{ name:'Guillermo (Socio)',         cat:'team',     sub:'nomina'   },
  '16608090':{ name:'Karim (Director)',           cat:'team',     sub:'nomina'   },
  '15763593':{ name:'Ignacio (Closer)',           cat:'team',     sub:'nomina'   },
  '28712920':{ name:'María (Traffic Sr)',         cat:'team',     sub:'nomina'   },
  '16630410':{ name:'Alexandra (Social)',         cat:'team',     sub:'nomina'   },
  '16941029':{ name:'Alexander (Foreign)',        cat:'team',     sub:'nomina'   },
  '17506376':{ name:'Nury (KAM)',                 cat:'team',     sub:'nomina'   },
  '17652139':{ name:'Claudia (Confirmer)',        cat:'team',     sub:'comision' },
  '16523408':{ name:'Arriendo Oficina',           cat:'overhead', sub:'arriendo' },
  '76187287':{ name:'Telefonía',                  cat:'overhead', sub:'telecom'  },
  '11498999':{ name:'Devolución cliente',         cat:'other',    sub:'devolucion'},
  '19359163':{ name:'Pago puntual (Maximiliano)', cat:'other',    sub:'puntual'  },
  '77008658':{ name:'Pago de trámite',            cat:'other',    sub:'tramite'  },
  '13918250':{ name:'Devolución cliente (ene)',   cat:'other',    sub:'devolucion'}, // Alvaro Bonich
  '18257052':{ name:'Devolución reserva (ene)',   cat:'other',    sub:'devolucion'},
  '96572800':{ name:'Imposiciones atrasadas',     cat:'team',     sub:'previred' },
  '16994268':{ name:'Daniel (Socio eXp 50%)',     cat:'team',     sub:'socio_exp'}, // 50% líquido proyecto eXp
  '77450452':{ name:'Pago interno',               cat:'other',    sub:'interno'  },
  // Formato alternativo Santander: "0RRRRRRRRD Transf a NOMBRE" → extrae 0+primeros7
  '01660809':{ name:'Karim (Director)',           cat:'team',     sub:'nomina'   },
  '01649567':{ name:'Guillermo (Socio)',          cat:'team',     sub:'nomina'   },
  '01576359':{ name:'Ignacio (Closer)',           cat:'team',     sub:'comision' }, // "015763593K Transf a Ignacio"
};
const KW_MAP = [
  // ── Transferencias internas G66↔Santander (excluir de gastos) ──────────
  {kw:['CONVERSI','AGENCIA CONVIERTE','AGENCIA CONVIER','GLOBAL AGENCIA','MP: RETIRO','MP: INGRESO DE DINERO','77450452-4','RELAY: TRASPASO INTERNO'],cat:'other', sub:'transferencia_interna'},
  {kw:['MP: COMISIÓN','MP: COMISION'],                                        cat:'overhead', sub:'financiero'           },
  {kw:['MP: PAGO RECIBIDO'],                                                  cat:'ingreso',  sub:'mercadopago'          },
  {kw:['MP: SUELDO'],                                                         cat:'team',     sub:'nomina'               },
  {kw:['MP: PAGO META ADS'],                                                  cat:'pauta',    sub:'digital'              },
  {kw:['ALEXANDRA ALBORNOZ'],                                                 cat:'team',     sub:'nomina'               },
  {kw:['ACH (KA)'],                                                           cat:'team',     sub:'colab_usd'            },
  {kw:['IGNACIO RIVERA','RIVERA ZAMORA'],                                     cat:'team',     sub:'comision'             },
  {kw:['PARQUE EMPRESARIAL'],                                                 cat:'overhead', sub:'arriendo'             },
  {kw:['MAKE.COM','ATLASSIAN','CAPTIONS','MIRAGE','ADOBE','MP: FLOW','FINTOC','LOOM'],cat:'overhead', sub:'herramienta' },
  {kw:['MERCADO LIBRE'],                                                      cat:'overhead', sub:'oficina'              },
  {kw:['MP: DEVOLUCI'],                                                       cat:'ingreso',  sub:'devolucion'           },
  {kw:['VENTA CON LINK','VENTA POR SUSCRIPCI','MP: VENTA'],                   cat:'ingreso',  sub:'mercadopago'          },
  {kw:['TELEFONICA DEL SUR'],                                                 cat:'overhead', sub:'telecom'              },
  // ── Relay (cuenta USD de la LLC) ────────────────────────────────────────
  {kw:['SUELDO GUILLERMO','SUELDO KARIM','PROVISIÓN SUELDO'],                  cat:'team',     sub:'nomina'               },
  {kw:['LISDEY CASTRO'],                                                      cat:'ingreso',  sub:'devolucion'           },
  {kw:['EXP PUERTO RICO','INMOCRM EXP — ACH'],                                cat:'ingreso',  sub:'transferencia'        },
  {kw:['STRIPE — ACH','ACELERADOR INMOB — ACH'],                              cat:'ingreso',  sub:'transferencia'        },
  {kw:['HIGGSFIELD'],                                                         cat:'overhead', sub:'herramienta'          },
  // ── Comisiones y cargos G66 (overhead bancario) ─────────────────────────
  {kw:['CARGO POR SERVICIO','COMISIÓN ENVÍO','COMISION ENVIO'],               cat:'overhead', sub:'bancario'             },
  // ── Intereses (ingreso financiero menor) ─────────────────────────────────
  // ── Ingresos NO operacionales (no son venta: van bajo la línea) ─────────
  {kw:['INTERESES ABONADOS','INTERESES PAGADOS','TESORER','REGAL'],           cat:'ingreso',  sub:'no_operacional'       },
  // ── Reversos de compras: ni ingreso ni gasto ────────────────────────────
  {kw:['REVERSO','REVERSA'],                                                  cat:'other',    sub:'reverso'              },
  // ── Préstamo interno entre cuentas propias (a devolver) ─────────────────
  {kw:['PRÉSTAMO INTERNO','PRESTAMO INTERNO'],                                cat:'other',    sub:'prestamo'             },
  // ── Errores y reembolsos: se anulan, no son gasto ni ingreso ────────────
  {kw:['TRANSFERENCIA MAL HECHA','DEVOLUCIÓN TRANSFERENCIA','REEMBOLSO'],     cat:'other',    sub:'anulado'              },
  // ──────────────────────────────────────────────────────────────────────────
  {kw:['PREVIRED','AFP ','ISAPRE','FONASA','CCAF','COMPIN'],               cat:'team',     sub:'previred'   },
  {kw:['SEBASTIAN CADENA','CADENA CHIQUITO','CLAUDIA BARDAVID'],                            cat:'team',sub:'comision'  },
  {kw:['IGNACIO RIVERA'],                                                                  cat:'team',sub:'comision'  },
  {kw:['MARIA PERALTA','MARÍA PERALTA'],                                                   cat:'team',sub:'nomina'    },
  {kw:['DANIEL ÁLVAREZ','DANIEL ALVAREZ','DANIEL ÁLVA','DANIEL ALVA'],                     cat:'team',sub:'socio_exp' },
  {kw:['GLOBAL66','JOSNA','PATRICIA PAUL','PATRICIA ACOSTA','JUAN S','MINERVA','CADENA','ELBER','ALEXANDER G','ALEXANDER STEPHAN','(ALEXANDER','CLARITY PROFITS','OSPINA RIOS','SALAZAR PEÑA','JOSNA MALAVE'],cat:'team',sub:'colab_usd'},
  {kw:['WHOP*'],                                                              cat:'overhead', sub:'herramienta'},  // compra en Whop (suscripción/curso)
  {kw:['FACEBK','FACEBOOK','META ADS','GOOGLE','TIKTOK ADS','INSTAGRAM ADS'], cat:'pauta', sub:'digital'    },
  // GHL: la suscripción de agencia es herramienta; todo lo demás (recargas de
  // mensajería/WhatsApp, AppLevel) es costo del servicio. Validado por Karim 09-2026.
  {kw:['HIGHLEVEL AGENCY'],                                                   cat:'overhead', sub:'herramienta'},
  {kw:['HIGHLEVEL','HIGH LEVEL','APPLEVEL','APP LEVEL'],                    cat:'costo_servicio', sub:'ghl'},
  {kw:['SKOOL','WASABIL','KUTT','CLICKUP','CLAUDE AI','CLAUDE.AI','ANTHROPIC','OPENAI','CHATGPT','LOVABLE','GAMMA','NOTION','CANVA','NAME-CHEAP','NAMECHEAP','FIRMAVIRTUAL','ZAPSIGN','COMPRA MP','TASKLET','HOSTINGER','RAILWAY','GITHUB','CONTENTCREATOR'],    cat:'overhead', sub:'herramienta'},
  {kw:['LATAM.COM','GRUPO DHL','HOTEL ','OK PARKING','CONCESA','MAIPO PONIENTE','NOTARIA'],cat:'overhead', sub:'viajes_admin'},
  {kw:['SBX ','STA ISABEL','MARINA VINA','INMOBILIARIA SACO','EDUARDO GAMBOA','UNIRED','ESSBIO','PAGOS CGE','TELEFONICA','GASTOS COMUNES','E-CERTCHI'],cat:'overhead', sub:'oficina'},
  {kw:['KFC ','MCDONALD','SUBWAY','DOMINO','PEDIDOSYA','UBER EATS','RAPPI'],  cat:'overhead', sub:'bienestar'   },
  {kw:['FLOW PROP','PROPITEQ','BLUEHACK'],                                  cat:'overhead', sub:'advisory'   },
  {kw:['MERCADO PAGO','MP ','MERCADOPAGO'],                                 cat:'overhead', sub:'financiero' },
  {kw:['ARTISAN','CAFÉ','CAFE '],                                           cat:'overhead', sub:'bienestar'  },
  {kw:['EASY ','IKEA','DP *IKEA','SODIMAC'],                               cat:'overhead', sub:'muebles'    },
  {kw:['TOTTUS','JUMBO','LIDER','HIP LIDER'],                              cat:'overhead', sub:'oficina'    },
  {kw:['WORK CAFÉ','WORKCAFE','STARBUCKS'],                                 cat:'overhead', sub:'reuniones'  },
  {kw:['KIOSCLUB','CHRISMARY','GONZALEZ BARDA'],                            cat:'overhead', sub:'oficina'    },
  {kw:['COM.MANTENCION','MANTENCION PLAN','CUOTA MANEJO','COMISION BANCO','IVA POR COMISION'], cat:'overhead', sub:'bancario'   },
  {kw:['ENTEL','MOVISTAR','CLARO','WOM','VTR'],                            cat:'overhead', sub:'telecom'    },
  {kw:['SII','S.I.I','PPM ','IMPUESTO IVA','DECLARACION IVA'],              cat:'impuestos',sub:'sii'        },
  {kw:['CREDITO','CRÉDITO','CUOTA CREDITO','BCI','SCOTIABANK'],             cat:'impuestos',sub:'credito'    },
  {kw:['TRANSFERENCIA RECIBIDA','ABONO TRANSF','DEPOSITO'],                 cat:'ingreso',  sub:'transferencia'},
  {kw:['WHOP','STRIPE','PAYPAL'],                                           cat:'ingreso',  sub:'whop'       },
];

// ── Tipo de cambio mensual (dólar observado promedio, SII) ────────────────
// Cada movimiento en USD se convierte con el TC del mes al que pertenece.
// Los meses en null caen al valor manual de Fuentes & Config.
// Fuente oficial: sii.cl → Valores y Fechas → Dólar observado (promedio mensual)
const TC_MENSUAL = {
  '2026-01': 884, '2026-02': 862, '2026-03': 910, '2026-04': 898,
  '2026-05': 898, '2026-06': 903, '2026-07': 931, '2026-08': 917.66,
};
function tcFor(d, rateFn = () => rate()){
  const k = d instanceof Date ? mk(d) : String(d||'').slice(0,7);
  return TC_MENSUAL[k] || rateFn();
}

function mk(d){ return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:null; }

// Re-extrae el RUT desde la glosa con la normalización vigente. La glosa manda
// sobre el valor precalculado (historico.json / localStorage pueden traer RUTs
// generados con la normalización antigua que cortaba mal el DV pegado).
function extractRut(desc,rutCol){
  const d=String(desc||'');
  const m1=d.match(/^(\d{8,10})[kK]?\s/);
  const m2=d.match(/(\d{1,2})\.(\d{3})\.(\d{3})-[\dkK]/i);
  const raw=m1?m1[1]:m2?(m2[1]+m2[2]+m2[3]):String(rutCol||'').replace(/\D/g,'');
  return raw.length>=9&&raw[0]==='0'?raw.slice(1,9):raw.slice(0,8);
}

function categorize(desc,rut,monto){
  const d=desc.toUpperCase();
  // Costo único de salida: manda sobre el mapa de RUT, porque es la misma
  // persona pero el pago no es sueldo recurrente.
  if(/FINIQUITO|INDEMNIZAC/.test(d)) return {name:desc.slice(0,50),cat:'team',sub:'finiquito'};
  if(RUT_MAP[rut]) return {...RUT_MAP[rut]};
  for(const rule of KW_MAP) if(rule.kw.some(k=>d.includes(k))){
    const a=Math.abs(monto);
    if(rule.cat==='costo_servicio' && /^HIGHLEVEL — /.test(d) && ((a>=290&&a<=300)||(a>=490&&a<=500)))
      return {name:desc.slice(0,50),cat:'overhead',sub:'herramienta'};
    return {name:desc.slice(0,50),cat:rule.cat,sub:rule.sub};
  }
  return {name:desc.slice(0,50),cat:monto>0?'ingreso':'other',sub:monto>0?'transferencia':'sin_clasificar'};
}

function pd(s){
  if(!s) return null;
  const str=String(s).trim();
  let m=str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1]);
  m=str.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/); // handles ISO with or without time
  if(m) return new Date(+m[1],+m[2]-1,+m[3]);
  const n=parseFloat(str);
  if(!isNaN(n)&&n>40000) return new Date((n-25569)*86400*1000);
  const d=new Date(s); return isNaN(d)?null:d;
}

function normalizeHistorico(raw, rateFn){
  return raw.map(r => {
      const usd   = !!r.usd;
      const monto = usd ? Math.round(r.monto * tcFor(r.date, rateFn)) : r.monto;
      const rut   = extractRut(r.desc, r.rut);
      const cat   = categorize(r.desc, rut, monto);
      // cat_hint from G66 overrides when no RUT match
      // pd() interpreta 'YYYY-MM-DD' como fecha LOCAL; new Date() lo leería como UTC
      // y en Chile (UTC-4) correría cada movimiento un día hacia atrás.
      return { ...cat, ...r, rut, date: pd(r.date), monto, montoOrig: r.monto, usd, historico: true };
    });
}

// Clave de dedup: fecha completa + descripción + monto original + fuente.
// El sufijo #n permite N pagos idénticos el mismo día (cartolas solapadas siguen dedupando).
function dk(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function txnKeys(arr){
  const c={};
  return arr.map(t=>{
    const amt=t.usd?`U${t.montoOrig}`:`C${t.montoOrig??t.monto}`;
    const b=`${dk(t.date)}|${t.desc}|${amt}|${t.src}`;
    c[b]=(c[b]||0)+1;
    return `${b}#${c[b]}`;
  });
}
function mergeTxnArrays(existing,newt){
  const ex=new Set(txnKeys(existing));
  const keys=txnKeys(newt);
  const added=newt.filter((t,i)=>!ex.has(keys[i]));
  return [...existing,...added].sort((a,b)=>a.date-b.date);
}

// ═══════════════════════════════════════════════
// COMPUTE
// ═══════════════════════════════════════════════
// Consumo GHL refacturado a eXp por mes (USD). Es un pass-through: lo que se
// le cobra a los países ES su consumo, así que sirve para separar la parte
// variable de GHL que le corresponde. El resto de los cargos variables
// (mensajería y WhatsApp de la cuenta Agencia Convierte) queda en Acelerador.
// Fuente: panel GHL → wallet por sub-cuenta. Meses en null: todo a Acelerador.
const GHL_EXP_MENSUAL = {
  '2026-01': null, '2026-02': null, '2026-03': null, '2026-04': null,
  '2026-05': null, '2026-06': 1149.08, '2026-07': 1186.88, '2026-08': 1966.64,
};
// Desde agosto 2026 eXp cobra y paga su GHL desde su propia subcuenta Relay
// (los países prepagan el consumo ahí mismo), así que ese costo ya está en su
// línea y no se traspasa consumo desde las cuentas de Agencia Convierte.
const GHL_EXP_PROPIO_DESDE = '2026-08';

// ══════════════════════════════
// LÍNEA DE NEGOCIO
// ══════════════════════════════
// 'exp' = InmoCRM eXp: negocio externo que administra Daniel (50% del líquido).
//   Ingresos: fees de los 8 países. Costos directos: cuenta GHL de US$495 con sus
//   variables. La parte variable se separa por el monto refacturado, no por
//   la cuenta desde la que se pagó (ver GHL_EXP_MENSUAL).
// 'acelerador' = el resto del negocio, con toda la nómina, pauta y overhead.
function lineaDe(t, rateFn = () => rate()){
  const d=(t.desc||'').toUpperCase();
  if(t.sub==='socio_exp') return 'exp';
  if(/AGENCY SUB|INMOCRM EXP/.test(d)) return 'exp';
  // Dos suscripciones GHL cada mes desde enero: la de ~US$297 es Agencia
  // Convierte y la de ~US$495 es InmoCRM eXp. Solo se distinguen por monto.
  if(/HIGHLEVEL AGENCY/.test(d)) return Math.abs(t.monto)/tcFor(t.date, rateFn)>400?'exp':'acelerador';
  if(/EXP CHILE|EXP PUERTO RICO|EXP MX|EXP BRASIL|EXP COLOMBIA|EXP PERU|EXP ECUADOR/.test(d)) return 'exp';
  if(t.src==='g66' && /^ABONO/.test(d) && !/CLIENTE/.test(d)) return 'exp';
  return 'acelerador';
}

// Mes contable de un movimiento. PREVIRED se paga el mes siguiente al de las
// remuneraciones → se imputa (devenga) al mes anterior al del pago.
function txnMk(t){
  if(t.cat==='team'&&t.sub==='previred'){
    const d=new Date(t.date); d.setDate(1); d.setMonth(d.getMonth()-1);
    return mk(d);
  }
  return mk(t.date);
}

function filterBy(arr,m){ return m?arr.filter(r=>mk(r.date)===m):arr; }

function computePL({ txns, cobros, ventas, cuotas, rate, mes: m, ahora = new Date() }){
  const r=rate();
  const fc=filterBy(cobros,m), fv=filterBy(ventas,m), ft=m?txns.filter(t=>txnMk(t)===m):txns;
  const cobUSD  = fc.reduce((s,x)=>s+x.monto,0);
  // Cada cobro se convierte con el TC de su propio mes
  const cobCLP  = fc.reduce((s,x)=>s+x.monto*tcFor(x.date, rate),0);
  const ventaUSD= fv.reduce((s,x)=>s+x.venta,0);
  const cobVUSD = fv.reduce((s,x)=>s+x.cobrado,0);
  const arUSD   = fv.reduce((s,x)=>s+x.pendiente,0);
  const whopUSD = fc.filter(x=>x.metodo==='Whop').reduce((s,x)=>s+x.monto,0);
  const trUSD   = fc.filter(x=>x.metodo==='Transferencia').reduce((s,x)=>s+x.monto,0);
  const mpUSD   = fc.filter(x=>x.metodo==='Mercado Pago').reduce((s,x)=>s+x.monto,0);
  // Los subtotales operacionales miran solo Acelerador; eXp va aparte
  const ftA=ft.filter(t=>lineaDe(t, rate)!=='exp'), ftE=ft.filter(t=>lineaDe(t, rate)==='exp');
  const bc=(cat,sub)=>ftA.filter(t=>t.cat===cat&&(!sub||t.sub===sub)&&t.monto<0).reduce((s,t)=>s+Math.abs(t.monto),0);
  const pauta=bc('pauta');
  const nomina=bc('team','nomina'), previred=bc('team','previred'), colabUSD=bc('team','colab_usd'), comision=bc('team','comision');
  const finiquito=bc('team','finiquito');
  const teamOth=ftA.filter(t=>t.cat==='team'&&t.monto<0&&!['nomina','previred','colab_usd','comision','finiquito'].includes(t.sub)).reduce((s,t)=>s+Math.abs(t.monto),0);
  const totalTeam=nomina+previred+colabUSD+comision+finiquito+teamOth;
  const teamRec=totalTeam-finiquito;   // costo recurrente, sin costos únicos de salida
  const herr=bc('overhead','herramienta'), arr=bc('overhead','arriendo'), adv=bc('overhead','advisory');
  const banc=bc('overhead','bancario'), tel=bc('overhead','telecom'), reu=bc('overhead','reuniones');
  const mue=bc('overhead','muebles'), of=bc('overhead','oficina'), fin=bc('overhead','financiero'), free=bc('overhead','freelance');
  const costoServ=bc('costo_servicio');
  const totalOH0=herr+arr+adv+banc+tel+reu+mue+of+fin+free+bc('overhead','aseo');
  const sii=bc('impuestos','sii'), cred=bc('impuestos','credito');
  const totalTax=sii+cred;
  // ── INGRESOS: desde los movimientos bancarios (base caja, igual que los gastos) ──
  // Operacionales = ventas. No operacionales = intereses, beneficios tributarios,
  // regalías. Las transferencias internas y préstamos quedan fuera (cat 'other').
  // Suma ambos signos: las devoluciones a clientes restan del ingreso
  const ins=ftA.filter(t=>t.cat==='ingreso');
  const ingOp   = ins.filter(t=>t.sub!=='no_operacional').reduce((s,t)=>s+t.monto,0);
  const ingNoOp = ins.filter(t=>t.sub==='no_operacional').reduce((s,t)=>s+t.monto,0);
  // Cada movimiento se convierte con el TC de su mes (vale también para el agregado)
  // Cash Collected del panel = ventas cobradas de ambas líneas, cada movimiento
  // convertido con el TC de su mes (vale también para el agregado del período)
  const ingOpUSD= ins.filter(t=>t.sub!=='no_operacional').reduce((s,t)=>s+t.monto/tcFor(t.date, rate),0)
                + ftE.filter(t=>t.monto>0&&t.cat!=='other').reduce((s,t)=>s+t.monto/tcFor(t.date, rate),0);
  // Desglose de ingresos operacionales por origen
  const ingWhop = ins.filter(t=>t.sub==='whop').reduce((s,t)=>s+t.monto,0);
  const ingMP   = ins.filter(t=>t.sub==='mercadopago').reduce((s,t)=>s+t.monto,0);
  const ingTrf  = ingOp-ingWhop-ingMP;
  // ── eXp / InmoCRM: negocio externo, con sus propios ingresos y costos ──
  // Traspasos entre subcuentas propias (Relay To/From InmoCRM eXp) no son ingreso ni costo
  const ingExp   =ftE.filter(t=>t.monto>0&&t.cat!=='other').reduce((s,t)=>s+t.monto,0);
  const expDaniel=ftE.filter(t=>t.monto<0&&t.sub==='socio_exp').reduce((s,t)=>s+Math.abs(t.monto),0);
  // Consumo variable refacturado: se mueve desde el costo del servicio de Acelerador a eXp.
  // Nunca más de lo que efectivamente se pagó de GHL variable ese mes.
  const meses   = m?[m]:[...new Set(ft.map(txnMk))];
  const ghlVar  = ftA.filter(t=>t.monto<0&&/highlevel/i.test(t.desc)&&!/AGENCY/i.test(t.desc))
                     .reduce((s,t)=>s+Math.abs(t.monto),0);
  const ghlRef  = Math.min(ghlVar, meses.filter(k=>k<GHL_EXP_PROPIO_DESDE)
                     .reduce((s,k)=>s+(GHL_EXP_MENSUAL[k]||0)*(TC_MENSUAL[k]||r),0));
  const expGHL  =ftE.filter(t=>t.monto<0&&t.sub!=='socio_exp'&&t.cat!=='other').reduce((s,t)=>s+Math.abs(t.monto),0)+ghlRef;
  const gastoExp =expDaniel+expGHL;
  const resExp   =ingExp-gastoExp;
  // ── Resultado operacional (Acelerador), ya neto del consumo refacturado ──
  // Lo refacturado sale del costo del servicio (nunca de las suscripciones)
  const totalOH  =totalOH0, costoServNeto=costoServ-ghlRef;
  const mb=ingOp-pauta-costoServNeto;
  const gastoAcel=pauta+costoServNeto+totalTeam+totalOH+totalTax;
  const resAcel  =ingOp-gastoAcel;
  // ── Resultado neto = operacional + eXp + otros no operacionales ──
  const ingTot=ingOp+ingExp+ingNoOp;          // todo lo cobrado
  const res=resAcel+resExp+ingNoOp;
  // AR vencido (cuotas no pagadas con vencimiento pasado)
  const now=ahora;
  const vencidoUSD=cuotas.filter(c=>!c.pagado&&c.porPagar>0&&c.venc<now).reduce((s,c)=>s+c.porPagar,0);
  return {cobUSD,cobCLP,cobVUSD,ventaUSD,arUSD,whopUSD,trUSD,mpUSD,
          ingOp,ingNoOp,ingTot,ingOpUSD,ingWhop,ingMP,ingTrf,
          gastoAcel,resAcel,ingExp,expDaniel,expGHL,gastoExp,resExp,
          pauta,nomina,previred,colabUSD,comision,finiquito,teamOth,totalTeam,teamRec,
          herr,costoServ:costoServNeto,arr,adv,banc,tel,reu,mue,of,fin,free,totalOH,ghlRef,
          sii,cred,totalTax,mb,res,vencidoUSD,
          tRate:ventaUSD?cobVUSD/ventaUSD*100:0};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  RUT_MAP, KW_MAP, TC_MENSUAL, GHL_EXP_MENSUAL, GHL_EXP_PROPIO_DESDE,
  extractRut, categorize, lineaDe, txnMk, mk, tcFor, filterBy, computePL,
  pd, normalizeHistorico, mergeTxnArrays, dk,
};

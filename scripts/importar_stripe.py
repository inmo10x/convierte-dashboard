#!/usr/bin/env python3
"""Importa pagos Stripe por ID, sin duplicados.
Uso: python3 scripts/importar_stripe.py export.csv --hasta 2026-10-31
Noviembre se importa al cerrar ese mes. No guarda emails ni datos de tarjetas.
"""
import argparse
import csv
import json
from decimal import Decimal
from pathlib import Path

def movimientos(r, hasta):
    """Un cobro genera hasta tres movimientos, cada uno en su propia fecha:
    el cobro bruto y su comisión (fecha de creación) y, si lo hubo, el
    reembolso (fecha del reembolso). Stripe no devuelve la comisión de un
    pago reembolsado, así que la comisión se mantiene. Un reembolso posterior
    a --hasta queda fuera y entra con el mes en que ocurrió."""
    if r['Status'] not in ('Paid', 'Refunded') or r['Created date (UTC)'][:10] > hasta:
        return []
    # Verificación de tarjeta (US$ 1 que Stripe cobra y devuelve al instante): no es venta.
    if (r['Description'] or '').startswith('Add new card'):
        return []
    if r['Currency'].lower() != 'usd':
        raise ValueError(f"Moneda no soportada: {r['id']}")
    base = dict(date=r['Created date (UTC)'][:10], desc=r['Description'] or r['Statement Descriptor'],
                src='stripe', usd=True, cuenta='Stripe InmoCRM / Acelerador',
                stripeId=r['id'], walletId=r['walletId (metadata)'],
                entityId=r['entityId (metadata)'], saasPlanId=r['saasPlanId (metadata)'])
    fee = Decimal(r['Fee'] or '0')
    out = [dict(base, monto=float(Decimal(r['Amount'])), stripeTipo='cobro'),
           dict(base, monto=float(-fee), stripeTipo='fee')]
    reemb = Decimal(r['Amount Refunded'] or '0')
    # Sin fecha de reembolso en el export, se asume la del cobro.
    fecha_reemb = (r.get('Refunded date (UTC)') or r['Created date (UTC)'])[:10]
    if reemb > 0 and fecha_reemb <= hasta:
        out.append(dict(base, date=fecha_reemb, monto=float(-reemb), stripeTipo='reembolso'))
    return out

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv')
    parser.add_argument('--hasta', required=True)
    parser.add_argument('--historico', type=Path, default=Path(__file__).resolve().parents[1] / 'historico.json')
    args = parser.parse_args()
    with open(args.csv, newline='', encoding='utf-8-sig') as f:
        filas = list(csv.DictReader(f))
    nuevos = [t for r in filas for t in movimientos(r, args.hasta)]
    ledger = json.loads(args.historico.read_text())
    # Todo cobro presente en el export se reemplaza entero, cualquiera sea su
    # estado: así un pago que pasó de Paid a Refunded (o a fallido) no deja
    # movimientos obsoletos de una importación anterior.
    ids = {r['id'] for r in filas if r['Created date (UTC)'][:10] <= args.hasta}
    ledger = [t for t in ledger if t.get('stripeId') not in ids] + nuevos
    ledger.sort(key=lambda t: t['date'])
    args.historico.write_text(json.dumps(ledger, ensure_ascii=False) + '\n')
    print(f'{len(nuevos)} movimientos Stripe; {len(ledger)} entradas totales.')

if __name__ == '__main__':
    main()

/**
 * Document examination.
 *
 * This is the part a trade finance officer is paid to do, and the reason a
 * letter of credit has a floor around US$50k. Rules are deterministic and
 * stated in trade-finance language; the model explains them, it does not
 * replace them. A discrepancy blocks release — that is the whole instrument.
 */

const iso = (d) => new Date(d + 'T00:00:00Z').getTime();

export function examine({ po, bl, packing }) {
  const d = [];
  const note = (code, severity, text) => d.push({ code, severity, text });

  if (!bl) note('DOC-MISSING', 'blocking', 'No bill of lading presented.');
  if (!packing) note('DOC-MISSING', 'blocking', 'No packing list presented.');
  if (!bl || !packing) return finish(d);

  if (bl.poNumber !== po.poNumber)
    note('REF-MISMATCH', 'blocking',
      `Bill of lading quotes PO ${bl.poNumber}; credit is opened against PO ${po.poNumber}.`);

  if (bl.portOfLoading !== po.portOfLoading)
    note('PORT-LOADING', 'blocking',
      `Port of loading ${bl.portOfLoading} differs from the port stipulated in the PO (${po.portOfLoading}).`);

  if (bl.portOfDischarge !== po.portOfDischarge)
    note('PORT-DISCHARGE', 'blocking',
      `Port of discharge ${bl.portOfDischarge} differs from the PO (${po.portOfDischarge}).`);

  if (iso(bl.shippedOnBoardDate) > iso(po.latestShipmentDate))
    note('LATE-SHIPMENT', 'blocking',
      `Shipped on board ${bl.shippedOnBoardDate}, after the latest shipment date ${po.latestShipmentDate}.`);

  // Quantity reconciliation, line by line, across all three documents.
  for (const line of po.lines) {
    const b = bl.lines.find((l) => l.sku === line.sku);
    const p = packing.lines.find((l) => l.sku === line.sku);
    if (!b) { note('QTY-ABSENT', 'blocking', `SKU ${line.sku} on the PO does not appear on the bill of lading.`); continue; }
    if (!p) { note('QTY-ABSENT', 'blocking', `SKU ${line.sku} on the PO does not appear on the packing list.`); continue; }
    if (b.qty !== line.qty)
      note('QTY-SHORT', 'blocking',
        `SKU ${line.sku}: bill of lading shows ${b.qty}, PO calls for ${line.qty}.`);
    if (p.qty !== b.qty)
      note('QTY-INCONSISTENT', 'blocking',
        `SKU ${line.sku}: packing list shows ${p.qty} against ${b.qty} on the bill of lading.`);
  }

  const extras = bl.lines.filter((l) => !po.lines.some((x) => x.sku === l.sku));
  for (const e of extras)
    note('GOODS-EXTRA', 'advisory',
      `SKU ${e.sku} appears on the bill of lading but was not ordered.`);

  if (bl.consignee !== po.buyer)
    note('CONSIGNEE', 'advisory',
      `Consignee is ${bl.consignee}; the PO names ${po.buyer} as buyer.`);

  return finish(d);
}

function finish(discrepancies) {
  const blocking = discrepancies.filter((x) => x.severity === 'blocking');
  return {
    clean: blocking.length === 0,
    blocking,
    advisory: discrepancies.filter((x) => x.severity === 'advisory'),
    all: discrepancies,
    // The line a bank would put on the advice.
    verdict: blocking.length === 0
      ? 'Documents conform. Release authorised.'
      : `Documents rejected: ${blocking.length} discrepanc${blocking.length === 1 ? 'y' : 'ies'}. Funds retained in escrow.`,
  };
}

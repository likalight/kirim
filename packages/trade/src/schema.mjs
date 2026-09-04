/**
 * Trade documents. Deliberately structured, not scanned PDFs — the agent
 * reasons over fields. Document *examination* is the product; OCR is not.
 */

export function purchaseOrder(o) {
  return {
    kind: 'purchase_order',
    poNumber: o.poNumber,
    buyer: o.buyer,
    supplier: o.supplier,
    incoterm: o.incoterm ?? 'FOB',
    currency: o.currency ?? 'USD',
    latestShipmentDate: o.latestShipmentDate,
    portOfLoading: o.portOfLoading,
    portOfDischarge: o.portOfDischarge,
    lines: o.lines, // [{ sku, description, qty, unitPriceCents }]
    totalCents: o.lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0),
  };
}

export function billOfLading(o) {
  return {
    kind: 'bill_of_lading',
    blNumber: o.blNumber,
    poNumber: o.poNumber,
    vessel: o.vessel,
    voyage: o.voyage,
    shippedOnBoardDate: o.shippedOnBoardDate,
    portOfLoading: o.portOfLoading,
    portOfDischarge: o.portOfDischarge,
    shipper: o.shipper,
    consignee: o.consignee,
    lines: o.lines, // [{ sku, qty }]
  };
}

export function packingList(o) {
  return {
    kind: 'packing_list',
    poNumber: o.poNumber,
    cartons: o.cartons,
    grossWeightKg: o.grossWeightKg,
    lines: o.lines, // [{ sku, qty }]
  };
}

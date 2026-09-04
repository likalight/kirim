/**
 * Construction milestones and the evidence presented against them.
 *
 * Evidence is deliberately machine-checkable. A photo on its own cannot be
 * examined; a photo with an EXIF timestamp and GPS fix can. That distinction
 * is the whole reason this milestone can be released without a site visit.
 */

export function milestone(o) {
  return {
    kind: 'milestone',
    id: o.id,
    name: o.name,
    projectId: o.projectId,
    amountCents: o.amountCents,
    startsOn: o.startsOn,
    dueOn: o.dueOn,
    dependsOn: o.dependsOn ?? null,
    site: o.site,                          // { lat, lng, radiusM }
    requiredPhotos: o.requiredPhotos ?? 3,
    boq: o.boq ?? [],                      // [{ sku, description, qty }]
    requiresPermit: o.requiresPermit ?? null,
    minInspectionPercent: o.minInspectionPercent ?? 95,
  };
}

export function submission(o) {
  return {
    kind: 'submission',
    milestoneId: o.milestoneId,
    submittedAt: o.submittedAt,
    note: o.note ?? '',
    photos: o.photos ?? [],                // [{ file, takenAt, lat, lng, sha256 }]
    deliveries: o.deliveries ?? [],        // [{ ref, supplier, sku, qty, deliveredAt }]
    permitRef: o.permitRef ?? null,
  };
}

/** Metres between two WGS-84 points. Site radius checks are the point of this. */
export function metresBetween(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

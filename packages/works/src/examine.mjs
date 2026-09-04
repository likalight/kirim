import { metresBetween } from './schema.mjs';

/**
 * Milestone examination.
 *
 * Three outcomes, matching how a site manager actually thinks:
 *
 *   ready      evidence is consistent with the milestone — release authorised
 *   more_info  evidence is missing; nothing is wrong, there is just not enough
 *   flagged    evidence contradicts the milestone — a human must look
 *
 * The distinction matters. "You did not send enough" and "what you sent does
 * not add up" are different messages to a contractor, and only the second one
 * should ever damage a track record.
 *
 * This function is the sole authority on whether money moves. A model narrates
 * the result; it never overturns it. Kirim does not claim to verify
 * construction — it reconciles evidence against an agreed scope and says
 * plainly where the two disagree.
 */
export function examineMilestone({ ms, sub, inspection, photoForensics, materials, priorReleased, seenPhotoHashes = new Set() }) {
  const findings = [];
  const note = (code, severity, text) => findings.push({ code, severity, text });

  // --- sequence -------------------------------------------------------------
  if (ms.dependsOn && !priorReleased?.includes(ms.dependsOn)) {
    note('SEQ-INCOMPLETE', 'blocking',
      `${ms.name} depends on ${ms.dependsOn}, which has not been released. Works cannot be certified out of sequence.`);
  }

  // --- presence of evidence -> more_info, not a rejection -------------------
  if (!sub.photos.length) {
    note('EVIDENCE-NONE', 'missing', 'No site photographs were submitted.');
  } else if (sub.photos.length < ms.requiredPhotos) {
    note('EVIDENCE-THIN', 'missing',
      `${sub.photos.length} photograph(s) submitted; ${ms.requiredPhotos} are required for ${ms.name}.`);
  }
  if (ms.boq.length && !sub.deliveries.length) {
    note('MATERIALS-NONE', 'missing',
      'No delivery notes submitted for the materials scheduled in this milestone.');
  }
  // An inspection that could not assess the works is missing evidence, not a
  // failed inspection. `null < threshold` is true in JavaScript and would
  // otherwise reject a contractor for something the inspector never measured.
  const assessed = inspection && inspection.percentComplete != null;
  if (!inspection) {
    note('INSPECTION-NONE', 'missing', 'No independent inspection was obtained.');
  } else if (!assessed) {
    note('INSPECTION-NORESULT', 'missing',
      'The independent inspection returned no completion figure for this milestone.');
  }

  // --- photographs: where and when -----------------------------------------
  for (const p of sub.photos) {
    if (p.lat == null || p.lng == null) {
      note('PHOTO-NOGEO', 'missing', `${p.file} carries no GPS fix, so its location cannot be confirmed.`);
      continue;
    }
    const away = metresBetween(ms.site, p);
    if (away > ms.site.radiusM) {
      note('PHOTO-GEO', 'blocking',
        `${p.file} was taken ${formatDistance(away)} from the site, outside the ${ms.site.radiusM}m boundary.`);
    }
    if (p.takenAt < ms.startsOn) {
      note('PHOTO-TIME', 'blocking',
        `${p.file} was taken on ${p.takenAt.slice(0, 10)}, before this milestone began on ${ms.startsOn}.`);
    }
    if (p.takenAt > sub.submittedAt) {
      note('PHOTO-TIME', 'blocking', `${p.file} carries a timestamp later than the submission itself.`);
    }
    if (p.sha256 && seenPhotoHashes.has(p.sha256)) {
      note('PHOTO-REUSED', 'blocking',
        `${p.file} is byte-identical to a photograph already submitted against an earlier milestone.`);
    }
  }

  if (photoForensics && photoForensics.tampered?.length) {
    for (const t of photoForensics.tampered) {
      note('PHOTO-TAMPERED', 'blocking', `${t.file}: ${t.reason}`);
    }
  }

  // --- materials against the bill of quantities ----------------------------
  for (const line of ms.boq) {
    const delivered = sub.deliveries
      .filter((d) => d.sku === line.sku)
      .reduce((a, d) => a + d.qty, 0);
    if (!sub.deliveries.length) break; // already reported as missing
    if (delivered < line.qty) {
      note('MATERIALS-SHORT', 'blocking',
        `${line.description}: ${delivered} delivered against ${line.qty} scheduled.`);
    }
  }
  if (materials) {
    for (const d of materials.unverified ?? []) {
      note('DELIVERY-UNVERIFIED', 'blocking',
        `Delivery note ${d.ref} does not appear in ${d.supplier}'s records.`);
    }
  }

  // --- permits --------------------------------------------------------------
  if (ms.requiresPermit && !sub.permitRef) {
    note('PERMIT-MISSING', 'blocking',
      `${ms.name} requires a ${ms.requiresPermit} permit reference; none was provided.`);
  }

  // --- independent inspection ----------------------------------------------
  if (assessed) {
    if (inspection.percentComplete < ms.minInspectionPercent) {
      note('INSPECT-INCOMPLETE', 'blocking',
        `Independent inspection assessed ${inspection.percentComplete}% complete against a ${ms.minInspectionPercent}% threshold for release.`);
    }
    for (const d of inspection.defects ?? []) {
      if (d.severity === 'critical') {
        note('DEFECT-CRITICAL', 'blocking', `Critical defect: ${d.note}`);
      } else {
        note('DEFECT-MINOR', 'advisory', `Minor defect noted: ${d.note}`);
      }
    }
  }

  // --- timeliness -----------------------------------------------------------
  if (sub.submittedAt.slice(0, 10) > ms.dueOn) {
    note('LATE', 'advisory',
      `Submitted ${sub.submittedAt.slice(0, 10)}, after the agreed date of ${ms.dueOn}. Recorded against the track record; it does not block release.`);
  }

  return finish(findings, ms);
}

function finish(findings, ms) {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const missing = findings.filter((f) => f.severity === 'missing');
  const advisory = findings.filter((f) => f.severity === 'advisory');

  let state, verdict;
  if (blocking.length) {
    state = 'flagged';
    verdict = `Flagged for review: ${blocking.length} inconsistenc${blocking.length === 1 ? 'y' : 'ies'} between the evidence and the agreed scope of ${ms.name}. Funds retained.`;
  } else if (missing.length) {
    state = 'more_info';
    verdict = `More information needed: the submission for ${ms.name} is incomplete. Nothing submitted contradicts the scope. Funds retained pending the outstanding evidence.`;
  } else {
    state = 'ready';
    verdict = `Evidence is consistent with the agreed scope of ${ms.name}. Release authorised.`;
  }

  return { state, ready: state === 'ready', blocking, missing, advisory, all: findings, verdict };
}

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
}

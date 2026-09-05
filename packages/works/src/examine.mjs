import { metresBetween } from './schema.mjs';

const money = (cents) => 'US$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

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
/**
 * Thirteen rules is an accurate description and a useless one. Everybody
 * examining a claim is really asking four questions, and every rule answers
 * exactly one of them — so each finding carries the question it belongs to and
 * the console can group them the way a person would.
 */
export const QUESTIONS = [
  { id: 'place', n: 1, ask: 'Is this the right place?',
    detail: 'Every photograph carries a GPS fix, checked against the site boundary.' },
  { id: 'genuine', n: 2, ask: 'Are these photographs genuine?',
    detail: 'Timestamps inside the agreed window, no recycled files, no editing after capture.' },
  { id: 'materials', n: 3, ask: 'Did the materials actually arrive?',
    detail: 'Delivery notes checked against the supplier\u2019s own records and the agreed quantities.' },
  { id: 'built', n: 4, ask: 'Is the work actually built?',
    detail: 'Independent measurement against the model both sides agreed to, and any open defects.' },
];

const ASKS = {
  'PHOTO-GEO': 'place', 'PHOTO-NOGEO': 'place',
  'PHOTO-TIME': 'genuine', 'PHOTO-REUSED': 'genuine', 'PHOTO-TAMPERED': 'genuine',
  'EVIDENCE-NONE': 'genuine', 'EVIDENCE-THIN': 'genuine', 'LATE': 'genuine',
  'MATERIALS-NONE': 'materials', 'MATERIALS-SHORT': 'materials',
  'DELIVERY-UNVERIFIED': 'materials', 'PERMIT-MISSING': 'materials',
  'INVOICE-MISSING': 'materials', 'INVOICE-MISMATCH': 'materials',
  'INSPECTION-NONE': 'built', 'INSPECTION-NORESULT': 'built',
  'INSPECT-INCOMPLETE': 'built', 'DEFECT-CRITICAL': 'built', 'DEFECT-MINOR': 'built',
  'MODEL-SHORT': 'built', 'SEQ-INCOMPLETE': 'built',
  'MODEL-NOEVIDENCE': 'built', 'MODEL-UNEXPECTED': 'genuine',
};

/**
 * Reconcile the survey against the model, element by element.
 *
 * This is what makes "72% complete" a number somebody can argue with rather
 * than a number they have to accept. Both sides agreed the elements; the
 * surveyor counted what exists; the difference is arithmetic.
 */
export function reconcile(elements, inspection, sub) {
  if (!elements?.length || !inspection?.observed) return null;
  const evidencedBy = new Map();
  for (const ph of sub?.photos ?? []) {
    if (!ph.evidences) continue;
    if (!evidencedBy.has(ph.evidences)) evidencedBy.set(ph.evidences, []);
    evidencedBy.get(ph.evidences).push(ph.file);
  }

  const rows = elements.map((e) => {
    const found = Math.min(inspection.observed[e.id] ?? 0, e.agreed);
    return {
      ...e, found, short: e.agreed - found,
      photos: evidencedBy.get(e.id) ?? [],
    };
  });
  const agreed = rows.reduce((a, r) => a + r.agreed, 0);
  const found = rows.reduce((a, r) => a + r.found, 0);
  const known = new Set(elements.map((e) => e.id));
  const stray = [...evidencedBy.entries()]
    .filter(([id]) => !known.has(id))
    .flatMap(([id, files]) => files.map((f) => ({ file: f, evidences: id })));

  return { rows, agreed, found, stray, percent: agreed ? Math.round((found / agreed) * 100) : null };
}

export function examineMilestone({ ms, sub, inspection, photoForensics, materials, priorReleased, seenPhotoHashes = new Set(), elements = null }) {
  const findings = [];
  const note = (code, severity, text) =>
    findings.push({ code, severity, text, asks: ASKS[code] ?? 'built' });

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
  // Where the stage has model elements and the survey counted them, completion
  // is computed here rather than taken on the surveyor's word.
  const model = reconcile(elements, inspection, sub);
  const percent = model?.percent ?? inspection?.percentComplete ?? null;
  const assessed = inspection && percent != null;
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

  // --- the invoice ----------------------------------------------------------
  // A claim for more than the stage is worth is the oldest trick in progress
  // billing, and it is the one thing here that needs no site visit to catch.
  if (!sub.invoice) {
    note('INVOICE-MISSING', 'missing',
      'No invoice was submitted against this stage.');
  } else if (sub.invoice.amountCents !== ms.amountCents) {
    const over = sub.invoice.amountCents > ms.amountCents;
    note('INVOICE-MISMATCH', 'blocking',
      `Invoice ${sub.invoice.ref} claims ${money(sub.invoice.amountCents)} against an agreed `
      + `${money(ms.amountCents)} for ${ms.name} — ${money(Math.abs(sub.invoice.amountCents - ms.amountCents))} `
      + `${over ? 'more than' : 'less than'} the schedule allows.`);
  }

  // --- independent inspection ----------------------------------------------
  if (assessed) {
    if (percent < ms.minInspectionPercent) {
      if (model) {
        const short = model.rows.filter((r) => r.short > 0);
        note('MODEL-SHORT', 'blocking',
          `${model.found} of ${model.agreed} agreed elements are built — ${percent}% of `
          + `${inspection.measuredAgainst || 'the agreed model'}, against a `
          + `${ms.minInspectionPercent}% threshold. Short: `
          + short.map((r) => `${r.label} ${r.found}/${r.agreed}`).join(', ') + '.');
      } else {
        note('INSPECT-INCOMPLETE', 'blocking',
          `Independent inspection assessed ${percent}% complete, against a `
          + `${ms.minInspectionPercent}% threshold for release.`);
      }
    }

    // An element nobody photographed is not proof of anything either way. That
    // is a gap in the evidence, not a finding against the developer.
    if (model) {
      for (const r of model.rows) {
        if (r.short > 0 && !r.photos.length) {
          note('MODEL-NOEVIDENCE', 'missing',
            `${r.label}: ${r.found} of ${r.agreed} counted, and no photograph was submitted for it.`);
        }
      }
      for (const x of model.stray) {
        note('MODEL-UNEXPECTED', 'advisory',
          `${x.file} is evidence for "${x.evidences}", which is not part of ${ms.name}. Noted, and not counted toward this stage.`);
      }
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

  return finish(findings, ms, model);
}

function byQuestion(findings) {
  return QUESTIONS.map((q) => {
    const mine = findings.filter((f) => f.asks === q.id);
    const worst = mine.some((f) => f.severity === 'blocking') ? 'blocking'
      : mine.some((f) => f.severity === 'missing') ? 'missing'
        : mine.length ? 'advisory' : 'clear';
    return { ...q, answer: worst, findings: mine };
  });
}

function finish(findings, ms, model = null) {
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

  return {
    state, ready: state === 'ready', blocking, missing, advisory, all: findings, verdict,
    questions: byQuestion(findings), model,
  };
}

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
}

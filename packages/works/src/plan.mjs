/**
 * What has to be established before this milestone can be released.
 *
 * The agent does not run a fixed pipeline. It reads the milestone's own terms
 * — how many photographs were agreed, whether materials were scheduled,
 * whether a permit is required, what completion threshold was set — and works
 * out which of those it can still establish given what the contractor actually
 * presented. Then it decides what to buy.
 *
 * This module produces the requirements deterministically. Choosing between
 * providers, and justifying a skip, is the agent's job.
 */

/**
 * Requirements derived from the milestone and the submission in front of it.
 *
 * `mandatory` means the release rules will block without it, so the plan may
 * not drop it to save money. `moot` means the evidence cannot help — buying a
 * forensics report on zero photographs establishes nothing.
 */
export function requirements({ ms, sub, daysLate = -1, prefs = {} }) {
  const out = [];

  out.push({
    id: 'photo-integrity',
    need: `Establish that the ${sub.photos.length} submitted photograph(s) are original captures, `
      + `so their timestamps and GPS can be relied on against the ${ms.site.radiusM}m site boundary.`,
    providers: ['photo-forensics'],
    mandatory: false,
    moot: sub.photos.length === 0,
    mootReason: 'No photographs were submitted, so there is nothing to examine.',
  });

  out.push({
    id: 'materials-delivered',
    need: ms.boq.length
      ? `Confirm the ${ms.boq.length} scheduled material line(s) were delivered, against `
        + `${sub.deliveries.length} delivery note(s) presented.`
      : 'No materials were scheduled for this milestone.',
    providers: ['materials-registry'],
    mandatory: false,
    moot: ms.boq.length === 0 || sub.deliveries.length === 0,
    mootReason: ms.boq.length === 0
      ? 'This milestone schedules no materials.'
      : 'No delivery notes were presented, so there is nothing to verify against the registry.',
  });

  // The one genuine trade-off in this plan. It is resolved on the deadline
  // rather than left to a model's judgement: a wrong call here spends the
  // client's money or keeps a contractor waiting, and neither is a good use of
  // a language model's discretion. The agent may still override it, and the
  // override is recorded.
  // The deadline decides first. Where it does not, the client's own leaning
  // does — this is Sarah's money and her stated preference, not a global
  // default someone set in an env file.
  const urgent = daysLate >= 0;
  const leaning = prefs.leaning ?? 'cost';
  const preferred = urgent
    ? 'site-inspection-express'
    : (leaning === 'speed' || leaning === 'quality')
      ? 'site-inspection-express'
      : 'site-inspection';

  out.push({
    id: 'completion',
    need: `Independently establish completion against the ${ms.minInspectionPercent}% threshold `
      + `agreed for ${ms.name}.`,
    providers: ['site-inspection', 'site-inspection-express'],
    preferred,
    tradeoff: urgent
      ? `This milestone is ${daysLate} day(s) past its agreed date, so the express survey's `
        + `turnaround buys back real time the contractor is already waiting through.`
      : leaning === 'speed'
        ? `The milestone is inside its agreed date, but ${prefs.clientName ?? 'the client'} asked for speed `
          + `over cost, so the express survey is taken anyway.`
        : leaning === 'quality'
          ? `The milestone is inside its agreed date, but ${prefs.clientName ?? 'the client'} asked for the `
            + `most reliable survey, and the express provider carries the better record.`
          : `This milestone is inside its agreed date and ${prefs.clientName ?? 'the client'} leans to cost, `
            + `so the slower survey costs nothing and the difference stays with them.`,
    mandatory: true,
    moot: false,
  });

  return out;
}

/**
 * Constrain a proposed plan to what is real and affordable.
 *
 * The model may choose between providers and may justify skipping a
 * discretionary check. It may not invent a provider, exceed the budget, or
 * drop something the release rules will block on — those are corrected here
 * and the correction is reported, not hidden.
 */
export function validatePlan({ proposed, reqs, catalog, budgetUsd }) {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const up = (id) => byId.get(id) && byId.get(id).available !== false;
  const steps = [];
  const skipped = [];
  const corrections = [];

  for (const req of reqs) {
    const choice = proposed?.find((p) => p.requirement === req.id);

    if (req.moot) {
      skipped.push({ requirement: req.id, why: req.mootReason });
      continue;
    }

    let providerId = choice?.provider;
    if (providerId && !byId.has(providerId)) {
      corrections.push(`${providerId} is not in the catalogue; fell back to ${req.providers[0]}.`);
      providerId = null;
    }
    if (providerId && !req.providers.includes(providerId)) {
      corrections.push(`${providerId} does not establish ${req.id}; fell back to ${req.providers[0]}.`);
      providerId = null;
    }

    if (!providerId) {
      if (choice?.skip && !req.mandatory) {
        skipped.push({ requirement: req.id, why: choice.why || 'The agent judged it unnecessary.' });
        continue;
      }
      providerId = req.preferred ?? req.providers[0];
    }

    // Where the deadline settles the choice, the deadline settles it. A model
    // may word the plan; it does not get to spend more of the client's money,
    // or keep a contractor waiting, against a rule this crisp. A differing
    // suggestion is recorded as considered rather than silently dropped.
    if (req.preferred && providerId !== req.preferred && up(req.preferred)) {
      corrections.push(`${providerId} was suggested for ${req.id}; ${req.preferred} was bought `
        + `because the deadline and the client's own terms decide this one.`);
      providerId = req.preferred;
    }

    // A provider that is not accepting requests cannot be bought from, however
    // well it scores on price. Route to the alternative and say so.
    if (!up(providerId)) {
      const alternative = req.providers.find((id) => id !== providerId && up(id));
      if (alternative) {
        corrections.push(`${providerId} is unavailable; bought ${alternative} instead so the `
          + `milestone is not held up by a provider outage.`);
        providerId = alternative;
      } else if (req.mandatory) {
        corrections.push(`${providerId} is unavailable and nothing else establishes ${req.id}. `
          + `The milestone cannot be released until it returns.`);
        skipped.push({ requirement: req.id, why: `No available provider for ${req.id}.`, blocked: true });
        continue;
      } else {
        skipped.push({ requirement: req.id, why: `${providerId} is unavailable.` });
        continue;
      }
    }

    if (choice?.skip && req.mandatory) {
      corrections.push(`${req.id} cannot be skipped — the release rules block without it.`);
    }

    steps.push({
      requirement: req.id,
      provider: providerId,
      priceUsd: byId.get(providerId).price,
      why: req.tradeoff ?? (choice?.why || req.need),
    });
  }

  // Budget is not the model's to overrun. Trim discretionary steps, dearest
  // first, until the plan fits.
  let total = () => steps.reduce((a, s) => a + Number(s.priceUsd), 0);
  while (total() > budgetUsd) {
    const discretionary = steps
      .map((s, i) => ({ s, i, req: reqs.find((r) => r.id === s.requirement) }))
      .filter((x) => !x.req.mandatory)
      .sort((a, b) => Number(b.s.priceUsd) - Number(a.s.priceUsd))[0];
    if (!discretionary) break;
    steps.splice(discretionary.i, 1);
    skipped.push({
      requirement: discretionary.s.requirement,
      why: `Dropped to stay inside the US$${budgetUsd.toFixed(2)} evidence budget for this milestone.`,
    });
    corrections.push(`The proposed plan cost more than the budget; ${discretionary.s.provider} was dropped.`);
  }

  return { steps, skipped, corrections, estimatedUsd: total().toFixed(2) };
}

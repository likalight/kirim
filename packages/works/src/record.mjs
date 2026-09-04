/**
 * The contractor's track record.
 *
 * Not a row in our database. Each released milestone issues an XLS-70
 * Credential to the contractor's own XRPL account, so the record is portable,
 * verifiable by any future client without asking Kirim, and survives us.
 *
 * Kirim does not claim a credential makes a contractor trustworthy. It makes
 * their history visible. Less blind trust, more visible proof.
 */
export function summarise(credentials) {
  const milestones = credentials.filter((c) => c.type.startsWith('KIRIM:'));
  const projects = new Set(milestones.map((c) => c.projectId).filter(Boolean));
  const onTime = milestones.filter((c) => c.onTime).length;
  return {
    milestonesCompleted: milestones.length,
    projectsCompleted: projects.size,
    onTimeRate: milestones.length ? Math.round((onTime / milestones.length) * 100) : null,
    latest: milestones.slice(-5).reverse(),
  };
}

/** kirim:milestone/<projectId>/<milestoneId>/<slug>?onTime=1 */
export function credentialUri({ projectId, milestoneId, name, onTime }) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `kirim:milestone/${projectId}/${milestoneId}/${slug}?onTime=${onTime ? 1 : 0}`;
}

export function parseCredentialUri(uri) {
  const [path, query] = String(uri).split('?');
  const [, projectId, milestoneId, slug] = path.split('/');
  return {
    projectId, milestoneId, slug,
    onTime: new URLSearchParams(query || '').get('onTime') === '1',
  };
}

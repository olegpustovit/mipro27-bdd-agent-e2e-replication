// The study deadline is campaign configuration, never a constant in a plan file.
// Order of precedence: value recorded in the campaign's frozen journal (resume) > --deadline > STUDY_DEADLINE_UTC.
// The value must be an absolute UTC ISO instant and is recorded in the campaign's frozen inputs.
export const historicalDeadlines = Object.freeze({
  // Provenance only: the absolute deadline of the four campaigns of 2026-11-01 (A-D). Never used as a default.
  'campaigns-20261101': '2026-11-01T21:55:00Z',
});
export function requireDeadline(...candidates) {
  const value = candidates.find(v => typeof v === 'string' && v);
  if (!value) throw new Error('A campaign deadline is required: pass --deadline <ISO UTC> or set STUDY_DEADLINE_UTC (restarting must not reset the study budget)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid campaign deadline ${value}: use an absolute UTC ISO instant such as 2026-12-01T12:00:00Z`);
  return value;
}

// Static check of the ported faults (no app, no model). For each of the 12 seeded faults, build the healthy and the
// faulty source set on v0, v1 and v2 with the harness's own revisionSources(), and check that:
//  - the faulty build differs from the healthy build of the same revision only in the fault's file;
//  - in that file, the healthy build contains the fault's `before` anchor and the faulty build its `after` text
//    (after the v1 hook prefix where the anchor contains a data-test value), exactly once;
//  - both builds parse as TSX.
// Output: one JSON line per case and revision, then a summary line. Exit 1 on any failure.
import ts from 'typescript';
import { cases } from '../harness/study/manifest.mjs';
import { faults, pristineSources } from '../harness/scripts/mutations.mjs';
import { revisionSources } from '../harness/scripts/ui-revisions.mjs';

const strip = s => s.replace(/\n\/\*! study-build-[a-f0-9]+ \*\/\n$/, '');
const prefixed = (text, revision) => revision === 'v0' ? text : text.replace(/data-test="/g, 'data-test="v1-');
const parses = (path, source) => !ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length;
const original = pristineSources();
let failures = 0;
for (const item of cases) for (const revision of ['v0', 'v1', 'v2']) {
  const [path, before, after] = faults[item.id];
  const healthy = revisionSources(item.id, revision, { fault: false, original }).sources;
  const faulty = revisionSources(item.id, revision, { fault: true, original }).sources;
  const changedFiles = Object.keys(faulty).filter(p => strip(faulty[p]) !== strip(healthy[p]));
  const count = (s, t) => s.split(t).length - 1;
  // v2 bank-delete moves the delete command into the confirmation dialog (ui-revisions deleteConfirmation): the anchor
  // then sits inside the dialog's onClick, still once.
  const h = strip(healthy[path]), f = strip(faulty[path]);
  const checks = {
    onlyFaultFileChanged: changedFiles.length === 1 && changedFiles[0] === path,
    healthyHasAnchorOnce: count(h, prefixed(before, revision)) === 1,
    faultyHasFaultOnce: count(f, prefixed(after, revision)) === 1,
    faultyLacksAnchor: count(f, prefixed(before, revision)) === 0,
    healthyParses: parses(path, h), faultyParses: parses(path, f),
  };
  const ok = Object.values(checks).every(Boolean);
  failures += !ok;
  console.log(JSON.stringify({ type: 'fault-build-static-check', caseId: item.id, revision, file: path, changedFiles, checks, ok }));
}
console.log(JSON.stringify({ type: 'summary', cells: cases.length * 3, failures }));
process.exitCode = failures ? 1 : 0;

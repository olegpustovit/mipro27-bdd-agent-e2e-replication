import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPackets, buildPacket, opaqueId } from './judge2/packet.mjs';
import { main, SYSTEM_PROMPT } from './judge2/run.mjs';

const packets = allPackets();
test('540 packets, opaque ids unique', () => {
  assert.equal(packets.length, 540);
  assert.equal(new Set(packets.map(p => buildPacket(p.campaign, p.entry).opaqueId)).size, 540);
});
test('packets carry no arm label, trial id, stage or first-reviewer verdict', () => {
  const adj = new Map();
  for (const p of packets) {
    const pk = buildPacket(p.campaign, p.entry), t = pk.text;
    assert.ok(!/maintained|runtime|baseline_|cucumber/i.test(t), p.trialId);
    assert.ok(!t.includes(p.trialId) && !t.includes(p.entry.record.trial.stage) && !t.includes(p.campaign));
    assert.ok(!/classification|adjudicat|judge1/i.test(t));
    assert.ok(pk.steps >= 0);
  }
});
test('fault packets show the seeded defect, healthy packets do not', () => {
  const f = packets.find(p => p.entry.record.trial.kind === 'fault'), h = packets.find(p => p.entry.record.trial.kind === 'healthy');
  assert.match(buildPacket(f.campaign, f.entry).text, /Seeded defect/); assert.doesNotMatch(buildPacket(h.campaign, h.entry).text, /Seeded defect/);
});
test('run is idempotent and resumable (stubbed judge, no model call)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j2t-')), verdictsFile = path.join(dir, 'v.jsonl'), errorsFile = path.join(dir, 'e.jsonl'); let calls = 0;
  const judge = p => (++calls, p.opaqueId.endsWith('0') && calls === 1 ? { ok: false, opaqueId: p.opaqueId, error: 'x' } : { ok: true, opaqueId: p.opaqueId, classification: p.classes[0], reason: 'r', citedStep: null, confidence: 'high' });
  const first = main(['--limit', '4'], { verdictsFile, errorsFile, judge });
  assert.equal(first.summary.selected, 4);
  const done = fs.readFileSync(verdictsFile, 'utf8').trim().split('\n').length;
  const second = main(['--limit', '4'], { verdictsFile, errorsFile, judge });
  assert.equal(second.summary.alreadyJudged, done);
  const ids = fs.readFileSync(verdictsFile, 'utf8').trim().split('\n').map(l => JSON.parse(l).opaqueId);
  assert.equal(new Set(ids).size, ids.length);
  const dry = main(['--dry-run'], { verdictsFile, errorsFile, judge }); assert.equal(dry.summary.selected, 540 - ids.length);
  fs.rmSync(dir, { recursive: true });
});
test('system prompt asks for the same classes as the first reviewer', () => {
  for (const c of ['supported_detection', 'wrong_reason', 'unsupported_pass', 'no_opportunity', 'true_pass', 'unsupported_healthy_pass', 'false_alarm', 'action_failure']) assert.ok(SYSTEM_PROMPT.includes(c));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedPreviewSequence,
  VbeePreviewProtocolRecorder
} from './preview-recorder.js';

test('VbeePreviewProtocolRecorder validates expected preview sequence', () => {
  const recorder = new VbeePreviewProtocolRecorder();

  for (const frame of expectedPreviewSequence()) {
    recorder.record(frame);
  }

  const result = recorder.verifyExpectedPreviewSequence();

  assert.equal(result.ok, true);
  assert.equal(result.missing.length, 0);
});

test('VbeePreviewProtocolRecorder detects missing GET_REMAINING_PREVIEW', () => {
  const recorder = new VbeePreviewProtocolRecorder();

  recorder.record({ direction: 'server', type: 'INIT' });
  recorder.record({ direction: 'client', type: 'INIT' });
  recorder.record({ direction: 'client', type: 'SYNTHESIS' });
  recorder.record({ direction: 'server', type: 'SYNTHESIS', status: 'IN_PROGRESS' });
  recorder.record({ direction: 'server', type: 'SYNTHESIS', status: 'SUCCESS' });

  const result = recorder.verifyExpectedPreviewSequence();

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.at(-1), {
    direction: 'server',
    type: 'GET_REMAINING_PREVIEW'
  });
});

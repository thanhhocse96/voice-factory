// Confirmed against two independent live captures from studio.vbee.vn (2026-09-09):
// - The client opens the connection and sends INIT (carrying accessToken) first;
//   the server INIT is the ack, not an unprompted hello. Both captures agreed on
//   this order, opposite of what this list originally assumed.
// - GET_REMAINING_PREVIEW is a leftover-quota check the UI fires *after* the
//   audio_link has already arrived - it is unrelated to audio delivery, and
//   requestPreviewSynthesis (vbee-preview.js) stops as soon as it has the
//   SUCCESS frame, so those frames are never observed by design. Intentionally not
//   part of the expected sequence below - including them would make every real run
//   "incomplete".
const EXPECTED_PREVIEW_SEQUENCE = [
  { direction: 'client', type: 'INIT' },
  { direction: 'server', type: 'INIT' },
  { direction: 'client', type: 'SYNTHESIS' },
  { direction: 'server', type: 'SYNTHESIS', status: 'IN_PROGRESS' },
  { direction: 'server', type: 'SYNTHESIS', status: 'SUCCESS' }
];

export class VbeePreviewProtocolRecorder {
  constructor() {
    this.frames = [];
  }

  record(frame) {
    const normalized = normalizeFrame(frame);
    this.frames.push({
      ...normalized,
      recordedAt: new Date().toISOString()
    });
    return normalized;
  }

  snapshot() {
    return this.frames.map(({ direction, type, status, payload }) => ({
      direction,
      type,
      status,
      payload
    }));
  }

  verifyExpectedPreviewSequence() {
    const frames = this.snapshot();
    const missing = [];
    let cursor = 0;

    for (const expected of EXPECTED_PREVIEW_SEQUENCE) {
      const index = frames.findIndex((frame, frameIndex) => (
        frameIndex >= cursor && frameMatches(frame, expected)
      ));

      if (index === -1) {
        missing.push(expected);
      } else {
        cursor = index + 1;
      }
    }

    return {
      ok: missing.length === 0,
      missing,
      frames
    };
  }
}

export function expectedPreviewSequence() {
  return EXPECTED_PREVIEW_SEQUENCE.map((item) => ({ ...item }));
}

function normalizeFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    throw new TypeError('protocol frame must be an object');
  }

  const direction = String(frame.direction || '').toLowerCase();
  if (direction !== 'client' && direction !== 'server') {
    throw new TypeError('protocol frame direction must be client or server');
  }

  const type = String(frame.type || frame.payload?.type || '').toUpperCase();
  if (!type) {
    throw new TypeError('protocol frame type is required');
  }

  const status = frame.status || frame.payload?.status || null;
  return {
    direction,
    type,
    status,
    payload: frame.payload || null
  };
}

function frameMatches(frame, expected) {
  return frame.direction === expected.direction
    && frame.type === expected.type
    && (!expected.status || frame.status === expected.status);
}

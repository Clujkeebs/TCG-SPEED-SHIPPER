import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCameraError, cameraConstraints } from './camera-errors.js';

const E = (name, message) => Object.assign(new Error(message || name), { name });

test('each Safari/Chrome failure gets its own plain sentence', () => {
  assert.match(describeCameraError(E('NotAllowedError')), /blocked.*aA.*Website Settings.*Camera.*Allow/);
  assert.match(describeCameraError(E('NotFoundError')), /No camera was found/);
  assert.match(describeCameraError(E('OverconstrainedError')), /No camera was found/);
  assert.match(describeCameraError(E('NotReadableError')), /busy.*other tabs/);
  assert.match(describeCameraError(E('AbortError')), /busy/);
  assert.match(describeCameraError(E('SecurityError')), /https/);
  assert.match(describeCameraError(E('TypeError')), /Reload/);
  assert.match(describeCameraError(E('Weird', 'boom')), /boom/);
  assert.match(describeCameraError(undefined), /could not start/);
});

test('insecure page and missing API are named first, whatever the error', () => {
  assert.match(describeCameraError(E('NotAllowedError'), { secure: false }), /secure page/);
  assert.match(describeCameraError(E('NotAllowedError'), { hasApi: false }), /cannot use the camera/);
});

test('constraints use ideal only, never exact', () => {
  const c = cameraConstraints();
  assert.deepEqual(c.video.facingMode, { ideal: 'environment' });
  assert.deepEqual(c.video.width, { ideal: 1280 });
  assert.equal(JSON.stringify(c).includes('exact'), false);
  assert.equal(c.audio, false);
});

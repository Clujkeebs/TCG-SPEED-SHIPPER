// Plain-words camera problems, written for Safari first. err is what getUserMedia threw (or undefined).
export function describeCameraError(err, { secure = true, hasApi = true } = {}) {
  if (!secure) return 'The camera only works on a secure page. Open the https link, not an http one.';
  if (!hasApi) return 'This browser cannot use the camera. Try Safari or Chrome, or upload photos instead.';
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'The camera is blocked. On iPad or iPhone: tap the "aA" in the address bar, then Website Settings, then Camera, then Allow. Or open Settings, Safari, Camera. Then tap Start again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. You can upload photos instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The camera is busy. Close other tabs or apps that use the camera, then tap Start again.';
  }
  if (name === 'SecurityError') return 'The browser would not allow the camera here. Open the https link and try again.';
  if (name === 'TypeError') return 'The camera could not be set up. Reload the page and tap Start again.';
  return 'The camera could not start' + (err && err.message ? ' (' + err.message + ')' : '') + '. You can upload photos instead.';
}

// getUserMedia constraints. Everything is "ideal", never "exact": exact settings make Safari refuse on devices
// that do not match (for example an iPad with no back-camera label).
export function cameraConstraints() {
  return { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
}

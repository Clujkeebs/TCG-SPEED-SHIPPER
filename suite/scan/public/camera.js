// Camera access. Everything stays on the device: frames are drawn to a canvas and never uploaded.
// Written for Safari on iPad/iPhone first: the stream starts only from a tap (the caller's click handler), the video is
// muted and inline (no full-screen takeover), and every constraint is "ideal", never "exact".
import { cameraConstraints, describeCameraError } from '../core/camera-errors.js';
import { scaleToMax } from '../core/imagesize.js';

export class CameraError extends Error {
  constructor(message, cause) { super(message); this.name = 'CameraError'; this.cause = cause; }
}

export async function startCamera(video) {
  const secure = window.isSecureContext;
  const hasApi = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!secure || !hasApi) throw new CameraError(describeCameraError(undefined, { secure, hasApi }));
  video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
  video.muted = true; video.setAttribute('muted', ''); video.autoplay = true;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(cameraConstraints()); }
  catch (e) { throw new CameraError(describeCameraError(e, { secure, hasApi }), e); }
  video.srcObject = stream;
  try { await video.play(); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; throw new CameraError(describeCameraError(e, { secure, hasApi }), e); }
  // Rotating the iPad can pause the picture; start it again. If the camera is taken away, tell the page.
  const resume = () => { if (video.srcObject && video.paused) video.play().catch(() => {}); };
  window.addEventListener('orientationchange', resume);
  window.addEventListener('resize', resume);
  const ended = () => video.dispatchEvent(new Event('cameralost'));
  stream.getTracks().forEach((t) => t.addEventListener('ended', ended));
  return () => {
    window.removeEventListener('orientationchange', resume); window.removeEventListener('resize', resume);
    stream.getTracks().forEach((t) => { t.removeEventListener('ended', ended); t.stop(); });
    video.srcObject = null;
  };
}

// One frame, shrunk so its long side is at most 1600 px (memory and speed on an iPad).
export function grabFrame(video, canvas) {
  const { width, height } = scaleToMax(video.videoWidth, video.videoHeight);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  return { width: img.width, height: img.height, data: img.data };
}

// Decode a picked photo, upright and shrunk. Tries the fast path, then falls back to an <img> element (older Safari).
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try the next way */ }
  try { return await createImageBitmap(file); } catch { /* try the next way */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

export async function frameFromFile(file, canvas) {
  const src = await decode(file);
  const w = src.width || src.naturalWidth; const h = src.height || src.naturalHeight;
  const { width, height } = scaleToMax(w, h);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, width, height);
  src.close?.();
  const img = ctx.getImageData(0, 0, width, height);
  return { width: img.width, height: img.height, data: img.data };
}

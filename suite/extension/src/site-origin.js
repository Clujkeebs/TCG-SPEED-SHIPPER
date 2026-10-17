import { API_BASE } from './build-config.js';

// The one site the optional permission covers (localhost only in the throw-away test build).
export const SITE_ORIGIN = new URL(API_BASE).origin + '/*';

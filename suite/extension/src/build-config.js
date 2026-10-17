// Build switches. The PRODUCTION build (this file as committed) never talks to localhost and only calls the real site.
// scripts/make-test-build.js writes a TEST COPY of the extension with ALLOW_LOCALHOST = true and API_BASE pointing at a
// local stub server, so the browser tests never touch the internet.
export const ALLOW_LOCALHOST = false;
export const API_BASE = 'https://tcgspeedshipper.com';

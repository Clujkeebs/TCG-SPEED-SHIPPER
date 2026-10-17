// Build switches. The PRODUCTION build (this file as committed) never talks to localhost.
// scripts/make-test-build.js writes a copy of the extension with ALLOW_LOCALHOST = true for the browser tests.
export const ALLOW_LOCALHOST = false;

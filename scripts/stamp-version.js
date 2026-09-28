/* Build step (netlify.toml): writes public/version.json so anyone can see
   which commit the live site was built from. The admin Setup checks card
   compares it with the head of `main` on GitHub and warns when production
   has fallen behind. On 2026-09-27 production sat on an old deploy for ~14 h
   while deploy previews kept building, and nothing flagged it.
   Netlify sets COMMIT_REF and CONTEXT during builds. (On Railway, server.js
   answers /version.json itself from RAILWAY_GIT_COMMIT_SHA.) */
const fs = require('fs');
const path = require('path');

const out = {
  commit: process.env.COMMIT_REF || null,
  context: process.env.CONTEXT || 'local',
  branch: process.env.BRANCH || null,
  built_at: new Date().toISOString()
};
fs.writeFileSync(path.join(__dirname, '..', 'public', 'version.json'), JSON.stringify(out) + '\n');
console.log('version.json:', out.commit ? out.commit.slice(0, 7) : '(no commit)', out.context);

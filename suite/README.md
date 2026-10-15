# suite/

Code for the TCG Speed Suite (Scan, Chrome extension, Agent). It is **not** part of the live site:
the live server never reads this folder, and Railway only runs the root `npm start`.

- `shared/`: contracts every product uses (`models.js`, with tests). Owned by the Builder session.
- `scan/`, `extension/`, `agent/`: one folder per product, created by its own session.

Run all suite tests (offline): `cd suite && npm test`.
Plan, rules and the log: `docs/suite/`.

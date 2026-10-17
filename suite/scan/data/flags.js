// Switches for things that are built but must stay OFF until a person has checked them. Change a value here (and say so
// in the log); tests inject their own flags and never read the real ones for behaviour.
export const FLAGS = {
  // One Piece lookup through optcgapi.com. OFF: its terms, response fields and browser access (CORS) are UNVERIFIED.
  // See docs/suite/SCAN-COVERAGE.md ("One Piece: built but OFF") for what turns it on.
  onePieceLive: false,
};

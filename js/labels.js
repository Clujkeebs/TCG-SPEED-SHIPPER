// Shared label parsing/rendering used by both the manual entry page
// and the paste-address import page.
const Labels = (() => {
  const CITY_STATE_ZIP_RE = /^(.+?),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Splits pasted text into address blocks separated by one or more blank lines.
  function splitBlocks(text) {
    return text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  // Parses a single address block of the form:
  //   Name
  //   Street line 1
  //   Street line 2 (optional)
  //   City, ST 12345
  function parseAddressBlock(block) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return {
        raw: block,
        error: "Needs at least a name line and a \"City, ST ZIP\" line.",
      };
    }

    const lastLine = lines[lines.length - 1];
    const match = lastLine.match(CITY_STATE_ZIP_RE);

    if (!match) {
      return {
        raw: block,
        error: `Last line "${lastLine}" doesn't look like "City, ST ZIP".`,
      };
    }

    const name = lines[0];
    const streetLines = lines.slice(1, lines.length - 1);

    const data = {
      name,
      street1: streetLines[0] || "",
      street2: streetLines.slice(1).join(", "),
      city: match[1],
      state: match[2].toUpperCase(),
      zip: match[3],
      raw: block,
    };

    if (!data.street1) {
      data.warning = "No street address line found between the name and city/state/zip.";
    }

    return data;
  }

  function parseAddressText(text) {
    return splitBlocks(text).map(parseAddressBlock);
  }

  // Renders one label as an HTML string. `data` requires name, city, state, zip;
  // street1/street2 are optional. `from` is an optional return-address object with
  // the same shape.
  function renderLabelHTML(data, from) {
    const returnBlock = from && (from.name || from.street1 || from.city)
      ? `
        <div class="return-block">
          ${from.name ? `<div>${escapeHtml(from.name)}</div>` : ""}
          ${from.street1 ? `<div>${escapeHtml(from.street1)}</div>` : ""}
          ${from.street2 ? `<div>${escapeHtml(from.street2)}</div>` : ""}
          ${from.city ? `<div>${escapeHtml(from.city)}, ${escapeHtml(from.state)} ${escapeHtml(from.zip)}</div>` : ""}
        </div>`
      : "<div></div>";

    return `
      <div class="label">
        ${returnBlock}
        <div class="recipient-block">
          <div>${escapeHtml(data.name)}</div>
          ${data.street1 ? `<div>${escapeHtml(data.street1)}</div>` : ""}
          ${data.street2 ? `<div>${escapeHtml(data.street2)}</div>` : ""}
          <div>${escapeHtml(data.city)}, ${escapeHtml(data.state)} <span class="zip">${escapeHtml(data.zip)}</span></div>
        </div>
      </div>`;
  }

  function renderBatch(container, items, from) {
    container.innerHTML = items.map((item) => renderLabelHTML(item, from)).join("\n");
  }

  return { parseAddressText, parseAddressBlock, renderLabelHTML, renderBatch, escapeHtml };
})();

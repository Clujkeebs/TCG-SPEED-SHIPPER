(() => {
  const fromFields = {
    name: document.getElementById("from-name"),
    street1: document.getElementById("from-street1"),
    street2: document.getElementById("from-street2"),
    city: document.getElementById("from-city"),
    state: document.getElementById("from-state"),
    zip: document.getElementById("from-zip"),
  };

  const addressText = document.getElementById("address-text");
  const parseBtn = document.getElementById("parse-btn");
  const parseIssues = document.getElementById("parse-issues");
  const resultsPanel = document.getElementById("results-panel");
  const resultsSummary = document.getElementById("results-summary");
  const printBtn = document.getElementById("print-btn");
  const labelSheet = document.getElementById("label-sheet");

  let parsedGood = [];

  function getFromAddress() {
    const out = {};
    Object.keys(fromFields).forEach((key) => {
      out[key] = fromFields[key].value.trim();
    });
    if (out.state) out.state = out.state.toUpperCase();
    return out;
  }

  parseBtn.addEventListener("click", () => {
    const results = Labels.parseAddressText(addressText.value);

    parsedGood = results.filter((r) => !r.error);
    const bad = results.filter((r) => r.error);
    const warned = parsedGood.filter((r) => r.warning);

    parseIssues.innerHTML = "";
    if (results.length === 0) {
      parseIssues.innerHTML = '<div class="parse-warning">Paste at least one address block above, then parse again.</div>';
    }

    bad.forEach((item) => {
      const div = document.createElement("div");
      div.className = "parse-warning parse-error";
      div.textContent = `Couldn't parse this block — ${item.error}\n---\n${item.raw}`;
      parseIssues.appendChild(div);
    });

    warned.forEach((item) => {
      const div = document.createElement("div");
      div.className = "parse-warning";
      div.textContent = `${item.name}: ${item.warning}`;
      parseIssues.appendChild(div);
    });

    if (parsedGood.length > 0) {
      resultsPanel.style.display = "block";
      resultsSummary.textContent = `${parsedGood.length} label${parsedGood.length === 1 ? "" : "s"} ready to print` +
        (bad.length > 0 ? ` (${bad.length} block${bad.length === 1 ? "" : "s"} skipped — see warnings above).` : ".");
      Labels.renderBatch(labelSheet, parsedGood, getFromAddress());
    } else {
      resultsPanel.style.display = "none";
      labelSheet.innerHTML = "";
    }
  });

  printBtn.addEventListener("click", () => {
    if (parsedGood.length === 0) return;
    Labels.renderBatch(labelSheet, parsedGood, getFromAddress());
    window.print();
  });
})();

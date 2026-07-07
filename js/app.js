(() => {
  const queue = [];

  const fromFields = {
    name: document.getElementById("from-name"),
    street1: document.getElementById("from-street1"),
    street2: document.getElementById("from-street2"),
    city: document.getElementById("from-city"),
    state: document.getElementById("from-state"),
    zip: document.getElementById("from-zip"),
  };

  const toFields = {
    name: document.getElementById("to-name"),
    street1: document.getElementById("to-street1"),
    street2: document.getElementById("to-street2"),
    city: document.getElementById("to-city"),
    state: document.getElementById("to-state"),
    zip: document.getElementById("to-zip"),
  };

  const formError = document.getElementById("form-error");
  const queueList = document.getElementById("queue-list");
  const labelSheet = document.getElementById("label-sheet");
  const printBtn = document.getElementById("print-btn");
  const clearBtn = document.getElementById("clear-btn");

  function readFields(fields) {
    const out = {};
    Object.keys(fields).forEach((key) => {
      out[key] = fields[key].value.trim();
    });
    if (out.state) out.state = out.state.toUpperCase();
    return out;
  }

  function getFromAddress() {
    return readFields(fromFields);
  }

  function validateRecipient(data) {
    if (!data.name) return "Recipient name is required.";
    if (!data.city) return "Recipient city is required.";
    if (!data.state || data.state.length !== 2) return "Recipient state must be a 2-letter code.";
    if (!/^\d{5}(-\d{4})?$/.test(data.zip)) return "Recipient zip code must be 5 digits (or ZIP+4).";
    return null;
  }

  function renderQueue() {
    if (queue.length === 0) {
      queueList.innerHTML = '<li class="empty-state">No labels queued yet.</li>';
      printBtn.disabled = true;
      clearBtn.disabled = true;
      return;
    }

    queueList.innerHTML = queue
      .map((item, index) => {
        const lines = [item.name, item.street1, item.street2, `${item.city}, ${item.state} ${item.zip}`]
          .filter(Boolean)
          .join("\n");
        return `
          <li class="queue-item">
            <span class="queue-text">${Labels.escapeHtml(lines)}</span>
            <button type="button" class="ghost" data-remove="${index}">Remove</button>
          </li>`;
      })
      .join("");

    printBtn.disabled = false;
    clearBtn.disabled = false;
  }

  document.getElementById("add-label-btn").addEventListener("click", () => {
    const data = readFields(toFields);
    const error = validateRecipient(data);
    if (error) {
      formError.textContent = error;
      formError.style.display = "block";
      return;
    }
    formError.style.display = "none";
    queue.push(data);
    renderQueue();

    Object.values(toFields).forEach((el) => (el.value = ""));
    toFields.name.focus();
  });

  queueList.addEventListener("click", (event) => {
    const index = event.target.getAttribute("data-remove");
    if (index === null) return;
    queue.splice(Number(index), 1);
    renderQueue();
  });

  clearBtn.addEventListener("click", () => {
    queue.length = 0;
    renderQueue();
  });

  printBtn.addEventListener("click", () => {
    if (queue.length === 0) return;
    Labels.renderBatch(labelSheet, queue, getFromAddress());
    window.print();
  });

  renderQueue();
})();

# TCG-SPEED-SHIPPER

A small static app for printing 4x6 shipping labels.

- **`index.html`** — Label Generator. Fill in an optional return address and one or more recipients, queue them up, then print (one label per page, sized for 4x6 label stock).
- **`import.html`** — Paste Addresses. Paste one or more addresses (separated by a blank line), each formatted as:

  ```
  Jane Doe
  456 Oak Ave
  Apt 2B
  Chicago, IL 60601
  ```

  Parsed addresses are shown as label previews and can be printed the same way as the generator page.

Both pages include the recipient's zip code on the printed label. No build step or server required — open `index.html` in a browser, or host the folder as a static site.

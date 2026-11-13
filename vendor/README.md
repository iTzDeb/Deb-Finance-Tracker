# Vendored browser readers

`import.html` loads these locally instead of from a CDN, so the importer has no
third-party runtime dependency and keeps working offline after the first use.

| File | Upstream | Version | License |
| --- | --- | --- | --- |
| `xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com/) | 0.18.5 | Apache-2.0 |
| `pdf.min.js` | [pdf.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | Apache-2.0 |
| `pdf.worker.min.js` | [pdf.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | Apache-2.0 |

Loaded on demand by `import.html` (CSV imports need none of them) and cached by
`sw.js` the first time a file needs them. Update the version in
`TECHNICAL.md` and the service-worker cache name when replacing them.

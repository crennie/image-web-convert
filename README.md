# Image Web Convert

## Overview

Image Web Convert is a tool for preparing images for the modern web.  
It strips personal metadata, normalizes color profiles, and converts files into web-friendly formats that load quickly on any device.

*Note: This is a personal project maintained in my spare time. While feedback is welcome, it may not receive the same level of support as a production-ready library.*

<!-- TODO: Add UI screenshots here -->
*UI Screenshots to be added here*

---

## Installation / Setup

**TBD** — installation instructions will be added soon.

**Requirements:**  

This project is developed and tested using Node.js 22 LTS. Other versions may work, but Node 22 is the recommended runtime.

npm (v10+ recommended)

---

## Usage

**TBD** — usage examples and UI instructions will be documented here.

---

## Development

This project is structured as an Nx monorepo.

- **Run the project locally**
  ```sh
  npm run <target>
  ```
  (Targets are orchestrated by Nx; see each app/package `project.json`.)

  Docker setup: **TBD**.

- **Run tests / linting**
  ```sh
  npx nx test <project>
  npx nx lint <project>
  ```

### Contributing

Contributions are currently closed. This project is maintained as a personal project.
If you have constructive feedback or comments, please open an issue or reach out. Feedback is always welcome, but pull requests are not being accepted at this time.

---

## Roadmap / Features

*Subject to change as development progresses.*

### Completed

- [x] Browser uploads with session-based workflow
- [x] Browser downloads - individual files and zip files
- [x] Conversion to web-ready formats with metadata stripping
- [x] HEIC/HEIF input support (iphone images)
- [x] OpenTelemetry logging middleware

### Planned

- [ ] Dockerization
- [ ] Additional output formats besides WEBP, such as AVIF.
- [ ] Multiple output sizes per file per conversion
- [ ] Configurable output presets (quality, dimensions, available formats, etc)
- [ ] User-selectable file conversion options
- [ ] Uploaded/temp file cleanup job, to ensure no retained data
- [ ] App workflow polish (UI error states/handling, polling uploads for better progress)
- [ ] Unit test coverage
- [ ] E2E test suites for happy path and main error cases

---

## License

Licensed under the MIT License. See [LICENSE](./LICENSE) for details.

---

## Security

Please see [SECURITY.md](./SECURITY.md) for how to report potential vulnerabilities.

---

## Acknowledgements

This project is built with:
- [Express](https://expressjs.com/) — backend API
- [Sharp](https://sharp.pixelplumbing.com/) — high-performance image processing
- [Nx](https://nx.dev/) — monorepo tooling
- [React](https://react.dev/) — front-end interface
- [Tailwind CSS](https://tailwindcss.com/) — styling

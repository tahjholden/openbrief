# OpenBrief Sidecar Binaries

`tauri.conf.json` registers sidecar base names such as
`binaries/openbrief-helper` and `binaries/openbrief-supertonic`. Tauri resolves
each base name to `<base-name>-<target-triple>` and adds `.exe` on Windows.

Debug Rust/Tauri builds create an ignored placeholder automatically when the real
sidecar is absent. Release builds refuse to bundle that placeholder and require a
real sidecar binary over the placeholder size threshold. Local development can
also run:

```sh
npm run setup:dev-sidecars
```

That command builds the Rust helper sidecar in debug mode and creates a
Supertonic placeholder for the current host target. Release packaging must run
`npm run build:sidecars`, which builds the Rust helper and PyInstaller
Supertonic sidecars before Tauri bundles them.

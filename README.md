# Zen Multiverse

A calm 3D zen garden that grows into an exploration game. A gift.

Walk the garden, tend the plants, then take a rocket to the moon and on to other worlds. Dig into the ground, carry and throw stones, craft tools, and build things that stand (or gently fall) like real ones.

## Download

**[Download the latest version](https://github.com/dpztxzx9nf-lab/zen-multiverse/releases/latest)**

On that page, pick the file for your computer:

- **Windows:** the file that ends with `_x64-setup.exe`
- **Mac:** the file that ends with `_universal.dmg`

From version 0.2.0 on, the app updates itself. New versions download quietly in the background, and you'll get one prompt to restart.

### First time on Windows

Windows may show a SmartScreen warning because the installer isn't code-signed. Click **More info**, then **Run anyway**.

### First time on a Mac

If macOS says the app can't be opened, right-click the app and choose **Open**.

## For developers

This is a static [Three.js](https://threejs.org/) web app (and a PWA) with a [Tauri](https://tauri.app/) v2 desktop wrapper.

### Layout

- `index.html`, `js/`, `css/`, `assets/`, `vendor/` — the web app (`assets/audio/` is music and SFX, Opus + AAC, lazy-loaded)
- `sw.js`, `manifest.webmanifest`, `icons/` — the PWA
- `src-tauri/` — the desktop app
- `scripts/copy-dist.mjs` — copies the web app into `dist/` for Tauri
- `.github/workflows/release.yml` — builds installers when a version tag is pushed

### Run locally

Serve the repo root as a static site:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

For the desktop app, install [Rust](https://rustup.rs/) and the [Tauri CLI](https://v2.tauri.app/start/create-project/), then from the repo root:

```bash
cargo tauri dev
```

### Releases

Push a version tag such as `v0.3.0`. GitHub Actions builds unsigned Windows and macOS installers and publishes a GitHub Release, including `latest.json` so existing installs can update themselves.

Third-party assets and licenses are listed in [CREDITS.md](CREDITS.md).

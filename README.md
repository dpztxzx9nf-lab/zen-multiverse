# Zen Multiverse

A calm 3D zen garden that grows into an exploration game. A gift.

Walk the garden, tend the plants, then take a rocket to the moon and on to other worlds. Dig into the ground, carry and throw stones, craft tools, and build things that stand (or gently fall) like real ones.

## Download

**[Download the latest version](https://github.com/dpztxzx9nf-lab/zen-multiverse/releases/latest)**

The newest version is **0.2.10**: no more rain falling in space (weather only happens where there's air), and the ship's cruise drive stops at the edge of the solar system instead of carrying you off into the dark. 0.2.9 brought: flying near the Sun now heats and can wreck your ship instead of hitting an invisible wall, the ship tells you whether you have enough fuel to reach where you're going, you can make fuel from ice, and sound follows the air (real crickets in the grass at night, silence in space). 0.2.8 added playing with a friend in the same world, on top of a whole universe to explore, round planets with living people, a rocket that flies the way you build it, and digging.

On that page, pick the file for your computer:

- **Windows:** the file that ends with `_x64-setup.exe`
- **Mac:** the file that ends with `_universal.dmg`

From version 0.2.0 on, the app updates itself. New versions download quietly in the background, and you'll get one prompt to restart.

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). See [CODE_SIGNING.md](CODE_SIGNING.md) for the full policy. Signing is pending approval, so Windows may still warn for now.

### First time on Windows

Windows may show a SmartScreen warning until signing is approved. Click **More info**, then **Run anyway**.

### First time on a Mac

If macOS says the app can't be opened, right-click the app and choose **Open**.

New releases will include a file called `SHA256SUMS.txt` on that same page. That is a list of checksums so you can check that the installer you downloaded is the same file we published.

The [code](LICENSE) is open (MIT). The art, music, and the Zen Multiverse name and logo stay with the author; see [NOTICE](NOTICE) and [ASSETS-LICENSE.md](ASSETS-LICENSE.md). Third-party credits are in [CREDITS.md](CREDITS.md).

## Play with friends

From 0.2.8, two people can be in the same world together.

1. Both of you download and open the latest version.
2. In the game, click **Play together**.
3. Type your email, tick the "verify you are human" box, and click **Send code**.
4. Enter the 6-digit code from the email (it comes from Zen Multiverse, `noreply@thinkcore.io`). If you're new, pick a name in the game.
5. One of you clicks **Invite to my garden**. That copies a link and shows a code like XXXX-XXXX (good for 24 hours).
6. The other person either opens the link, or clicks **Play together**, pastes the code under **Have a code?**, and clicks **Join with code**.

You should see each other in the garden. You can also add each other as friends by name and number (Name#1234) or by searching a name. If the server is down, the game still works on your own.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The full policy, team roles, and privacy note are in [CODE_SIGNING.md](CODE_SIGNING.md). Signing is pending approval, so Windows may still show the SmartScreen warning above.

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

Before tagging, run the long-session soak test (needs Node 22+ and Chrome; about 30 minutes):

```bash
node scripts/soak.mjs --minutes 30
```

It wanders the garden, the moon and fresh planets and fails if anything errors, if memory keeps growing, or (with `--gpu` on a machine with a real graphics card) if frame times spike. Only tag when it passes.

Push a version tag such as `v0.3.0`. GitHub Actions builds Windows and macOS installers and publishes a GitHub Release, including `latest.json` so existing installs can update themselves.

Licenses: [LICENSE](LICENSE) (code), [ASSETS-LICENSE.md](ASSETS-LICENSE.md) (art, audio, name, and logo), [CODE_SIGNING.md](CODE_SIGNING.md). Third-party assets and libraries are listed in [CREDITS.md](CREDITS.md).

# Zen Multiverse

A calm 3D zen garden that grows into an exploration game. A gift.

Walk the garden, tend the plants, then take a rocket to the moon and on to other worlds. Dig into the ground, carry and throw stones, craft tools, and build things that stand (or gently fall) like real ones.

## Download

**[Download the latest version](https://github.com/dpztxzx9nf-lab/zen-multiverse/releases/latest)**

The newest version is **0.2.25**: walls are real for everyone. The server now holds every player to the same walls, rocks, tents and buildings the game draws, so nobody can walk through them, even with a modified game. If you bump into one, you just stop. Other players, camp folk, foxes and deer are solid too, but nobody can push you around or box you in: keep walking into someone for a couple of seconds and you slip past. 0.2.24: restarting the game (or an automatic update) while on a planet no longer kicks you. 0.2.23: what you build on a planet stays there. Pieces and digs on a planet show again after a restart or reload (they were always saved, just not shown). 0.2.22: the game updates and restarts by itself. New versions download quietly, then it saves and relaunches at a calm moment (a menu, a loading or death screen, or when you're idle — never mid-fight, mid-build, in the air or in the water). There is no Update, Restart or Reconnect button to click, and a server update puts you back where you were. 0.2.20: no more walking or seeing through walls. Walls, rocks, tents and buildings stop you exactly where they are drawn, the camera no longer slips inside them, and crates, lockers, safes and stations are solid too. 0.2.19: crates, safes and workbenches. Set down a wooden crate (20 slots, anyone can open it, and it can be broken open) a metal locker (16 slots, opens for you and the friends you pick, but someone with a real tool can pry it open), or a metal safe (12 slots, only you and your friends can open it, and nothing breaks it). Tools, spears, rods and crates are made at a workbench, metal, lockers and safes at a metal smelter, and food at a campfire: walk up and press E. The garden has one of each, and you can build your own. A leather shoulder bag lets you carry 6 things in your hands, the travel pack 9. 0.2.18: building no longer disconnects you, and in first person looking down shows your legs and feet, not the inside of your body. 0.2.17: a bold new look. The whole game is now painted in our own Raked Light style: soft bands of sunlight with warm light and cool shadows, ink outlines around things, a painted sky with a round sun and big cartoon clouds, a sea with bands of colour, a white foam line on the shore and twinkling sparkles, and richer colours on plants, rocks and people. Phones get thinner outlines so they stay smooth. 0.2.16: climbing out of the water no longer kicks you off the server ("failed checks"), and Reconnect works again. 0.2.15 checked for updates while the app is open, fixed a slow memory leak when the game was left running for hours, and stopped faraway trees floating over hills. 0.2.14 gave the game its first painted touches, and there's a first hour made for two. Ula walks you through gathering, crafting, fishing, building and trading, and a friend nearby shares the progress. There's also a salt cove with a hidden sea cave, hares and a fox that notice you, camps that pay for what you bring them, and building together in the garden. 0.2.13 showed the people you play with as real characters who walk, run and swim like you. 0.2.12 brought one shared server (invite a friend and they spawn next to you), places to explore around the spawn, things to do from the first minute, swimming, and an escape pod that brings you home. 0.2.11 kept your newest save from being replaced. 0.2.10: no more rain in space, and the ship's cruise drive stops at the edge of the solar system.

On that page, pick the file for your computer:

- **Windows:** the file that ends with `_x64-setup.exe`
- **Mac:** the file that ends with `_universal.dmg`

From version 0.2.0 on, the app updates itself. New versions download quietly in the background, then the game saves and restarts at a calm moment (a menu, a loading or death screen, or when you're idle — never mid-fight, mid-build, in the air or in the water). There's no Update or Restart button to click. Since 0.2.15 it also checks every 45 minutes while it's running.

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). See [CODE_SIGNING.md](CODE_SIGNING.md) for the full policy. Signing is pending approval, so Windows may still warn for now.

### First time on Windows

Windows may show a SmartScreen warning until signing is approved. Click **More info**, then **Run anyway**.

### First time on a Mac

If macOS says the app can't be opened, right-click the app and choose **Open**.

New releases will include a file called `SHA256SUMS.txt` on that same page. That is a list of checksums so you can check that the installer you downloaded is the same file we published.

The [code](LICENSE) is open (MIT). The art, music, and the Zen Multiverse name and logo stay with the author; see [NOTICE](NOTICE) and [ASSETS-LICENSE.md](ASSETS-LICENSE.md). Third-party credits are in [CREDITS.md](CREDITS.md).

## Play with friends

Everyone plays in one shared world on the same server. New players arrive at the spawn, a round arrival stone on the lawn in front of the garden.

1. **Get the app.** Download the latest version (see Download above), install it and open it once.
2. **Get the link.** Your friend clicks **Play together**, then **Invite to the server**, and sends you the link (good for 24 hours).
3. **Click the link.** The app opens and says you're invited. Type your email, tick the "verify you are human" box, click **Send code**, and enter the 6-digit code from the email (from Zen Multiverse, `noreply@thinkcore.io`). You only do this the first time; after that the app remembers you.
4. **Play.** You spawn right next to your friend, or at the spawn if they're not playing right now.

If the link doesn't open the app, click **Play together**, paste the code from the link page under **Have a code?**, and click **Join with code**. You can also add each other as friends by name and number (Name#1234) or by searching a name. If the server is down, the game still works on your own.

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

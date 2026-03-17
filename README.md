# SoundCount

**[▶ Open SoundCount](https://felixdombek.github.io/soundcount/)**

A Progressive Web App (PWA) for counting sounds — claps, knocks, or any
sharp noise.  Works in your browser on any device and can be installed as
a home-screen app on Android and iOS.

---

## Features

| Feature | Details |
|---------|---------|
| **Generic mode** | Counts any sudden, loud sound event without setup |
| **Matched mode** | Record a 3-second reference sample; only sounds that match the recording are counted |
| **Large counter** | Prominent number display, easy to read at a glance |
| **Manual adjust** | Tap **−** / **+** to correct the count at any time |
| **Target** | Set a goal number; the background smoothly transitions from green → red as you approach it |
| **Sensitivity & interval** | Adjust how easy it is to trigger a count and the minimum time between events |
| **Offline support** | Cached by a service worker — works without internet after first load |
| **Installable** | Add to home screen on Android (Chrome) and iOS (Safari) |

---

## Installation on Android

1. Open **https://felixdombek.github.io/soundcount/** in Chrome.
2. Tap the browser menu → **Add to Home Screen**.
3. Launch the app from your home screen like any native app.

## Installation on iOS

1. Open **https://felixdombek.github.io/soundcount/** in Safari.
2. Tap the Share button → **Add to Home Screen**.

---

## How to use

### Generic mode
1. Tap **▶ Start** — grant microphone permission when asked.
2. Make sounds; the counter increments on each detected event.
3. Adjust *Sensitivity* and *Min. interval* if needed.
4. Tap **■ Stop** when done.

### Matched mode
1. Switch to the **Matched** tab.
2. Tap **🎙 Record Sample** and make your target sound (clap, knock, …)
   during the 3-second window.
3. Tap **▶ Start** — only sounds spectrally similar to your sample are counted.
4. Use the *Match threshold* slider to fine-tune selectivity.

---

## Development

The app is pure HTML / CSS / JavaScript — no build step required.

```bash
# Serve locally (any static server works)
npx serve .
# Then open http://localhost:3000
```

GitHub Actions automatically deploys the `main` branch to GitHub Pages on
every push.
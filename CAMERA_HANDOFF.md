# Handoff: camera reactions for Desk Buddy

## Context

Desk Buddy is a static PWA on GitHub Pages, running full-screen in landscape on a rooted OnePlus 6T (Android 11 / OxygenOS 11, Chrome, no Android camera-in-use indicator).

Repo files: `index.html` (all markup, CSS and JS inline), `manifest.webmanifest`, `icon-192.png`, `icon-512.png`. There is no build step and no service worker.

### How the current code works (read `index.html` first)

- **Drawing:** a canvas draws two round white eyes with dark pupils, floating yellow brows and a closed-line mouth. It runs at 30 fps (8 fps when asleep), with DPR capped at 1.5.
- **Mood parameters:** moods are entries in `MOODS`, built with `M({...})`. The parameters are `open`, `pupil`, `heart`, `browY`, `browA`, `browC`, `asym`, `side`, `mW`, `mC`, `mO` and `mSk`. Some legacy parameters (`up`, `tilt`, `low`, `blush`) still exist but nothing draws them.
- **Moods:** normal, happy, sad, angry, sleepy, surprised, love, curious, smug, unimpressed, suspicious, skeptical, annoyed, asleep.
- **Mood resolution:** `resolveMood(now)` takes the first match from: the `?mood=` preview param, then a temporary mood set with `setTemp(mood, ms)`, then a manual mood from settings, then the night schedule (sleepy from 22:00, asleep 23:00–06:00, touch wakes it for 10 s), then auto mode (a random mood every 25–75 s).
- **Gaze:** `lookT` (target, x/y in −1..1) and `lookHold` (a timestamp; while `now < lookHold`, wandering is paused). Drag already sets these, so camera tracking should use the same mechanism.
- **Touch:** tap = happy, double-tap = love with hearts, 6 pokes = angry, drag = eyes follow, long-press 0.8 s = settings panel.
- **Settings:** stored in `localStorage` under the key `buddy-settings-v2`. Every read and write must stay wrapped in try/catch.
- **Wake lock:** the screen wake lock is requested on load, on `visibilitychange` and on `pointerdown`.

## Goal

Use the front camera to detect whether someone is at the desk and where their face is, and make the buddy react. This is **face detection only**: no recognition or identification, and nothing stored or sent anywhere.

## Privacy requirements (non-negotiable)

1. **Off by default.** Add a "Camera" toggle to the settings panel. Request camera permission only when the user turns it on, from that tap, never on page load.
2. **Frames never leave the page.** Do not call `toDataURL`, `toBlob` or `fetch`, and do not use WebSocket, `sendBeacon` or any upload. Do not store frames, face crops or landmarks in localStorage or IndexedDB. Keep only in-memory values: present (boolean), face center x/y and face size. Do not log detections to the console in production.
3. **No third-party network requests.** Self-host MediaPipe's JS, WASM and `.tflite` model under `/vendor/` in the repo, with the exact version pinned. Load nothing from a CDN at runtime.
4. **Lock the page down with CSP.** GitHub Pages can't set headers, so use a `<meta http-equiv="Content-Security-Policy">` tag. Move the inline script into `buddy.js` (and the CSS into `buddy.css` if needed) so `script-src` can drop `'unsafe-inline'`. Target policy:
   `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`
   Adjust only if MediaPipe genuinely needs it, and write down why in a comment. `connect-src 'self'` is what blocks exfiltration if someone ever injects code, so it must stay.
5. **Show when the camera is on.** Android 11 has no system camera indicator, so draw a small, clearly visible dot in a screen corner whenever a camera track is live, and remove it as soon as the track stops.
6. **Turn the camera off for real.** Between checks and whenever the camera is disabled, call `track.stop()` on every track and drop the stream. Pausing the video element is not enough.
7. **Hard off windows.** No camera while the buddy is asleep or sleepy at night (22:00–07:00), while the page is hidden (`visibilitychange`), or while the toggle is off.
8. **Fail quietly.** If the user denies permission, or the model or camera fails, switch the toggle off, show a short message in the panel, and keep the buddy working exactly as it does now.

## Heat and battery requirements

The phone sits plugged in all day, and heat is the main battery risk.

- **Low resolution:** request about 320×240, or the lowest the camera offers.
- **Duty cycle while nobody is detected:** open the camera for about 2 s every 30 s, run a few detections, then stop the tracks.
- **While someone is present:** keep the camera on and detect at 2 fps (every 500 ms) with `requestVideoFrameCallback` or a timer, not every animation frame.
- **Back to idle:** after the absence timeout below, return to the duty cycle.
- **Don't slow the animation:** detection must not block the 30 fps loop. Run it off the render path. A worker is fine if it's simple, but this isn't required.

## Behavior mapping

Smooth the face position with an EMA (about 0.3), and use hysteresis on presence: present after 2 consecutive detections, absent after 5 s without a face.

- **Face present:** the eyes follow the face. Set `lookT` from the face center and set `lookHold = now + 1500` on each update so wandering stays paused. Check the left/right direction on the device so the eyes look *toward* the person, and add a "Flip camera direction" setting in case it's reversed.
- **Arrival (absent → present):** `setTemp('surprised', 1200)`, then `setTemp('happy', 3000)`.
- **Leaving (present → absent):** look around (wander as normal), then `setTemp('sad', 2500)`.
- **Absent for 10 minutes or more:** treat the base mood as `sleepy` until someone returns. Night rules still take priority.
- **Face very close** (bounding box wider than about 45% of the frame): `setTemp('curious', 2500)`. Cooldown 20 s.
- **Present continuously for 50 minutes or more:** `setTemp('unimpressed', 4000)` once, as a nudge to take a break. Repeat at most every 30 minutes.
- **Using your phone at the desk** (phone detected for 10 s or more, see below): `setTemp('unimpressed', 5000)` with the gaze held down toward the phone (`lookT.y ≈ 0.7`). When the phone disappears again, `setTemp('happy', 2000)`. Cooldown 2 minutes.
- **Precedence:** the camera reactions above call `setTemp`, which overrides a manual mood the same way touch reactions do. Don't change the night schedule or touch handling beyond that.

## Implementation notes

- **Detector:** use the MediaPipe Tasks Vision face detector with the short-range BlazeFace model. Check the current package name, version, WASM file names and model file name against the official docs before pinning. Don't assume them.
- **Load lazily:** load the WASM and model only when the camera toggle is first enabled.
- **Structure:** put the camera logic in its own module (`camera.js`) that exposes something like `start()`, `stop()` and an `onUpdate({present, x, y, size})` callback. `buddy.js` maps updates to gaze and mood.
- **Settings:** add new fields to the existing settings object (`camera: false`, `camFlip: false`). Keep the same storage key, and default missing fields so existing saved settings still load.
- **Phone detection:** use the MediaPipe Tasks Vision object detector (an EfficientDet-Lite model, self-hosted in `/vendor/` like the face model) and look for the COCO "cell phone" class with score ≥ 0.5. To limit heat, run it only while a face is present, every 3 s, on the same low-resolution frame. Require 2 hits in a row before counting the phone as present, and 2 misses in a row before counting it as gone. If the object model proves too heavy on the 6T, fall back to a simpler cue: face present but head tilted down (eye keypoints well above the nose relative to face size) for 10 s or more. Document which approach was chosen.
- **Hidden video:** use a `<video playsinline muted>` element that is never shown on screen.

## Testing and acceptance

- [ ] With the camera off (the default), the DevTools Network tab shows only same-origin requests, and none happen after load.
- [ ] With the camera on, there are still only same-origin requests: nothing from MediaPipe's CDN or any other host.
- [ ] Adding a temporary `fetch('https://example.com')` in the console is blocked by CSP.
- [ ] The corner dot appears exactly while a camera track is live and disappears within 1 s of `track.stop()`.
- [ ] In idle duty-cycle mode, the camera is live about 2 s out of every 30 (check with the dot and `chrome://media-internals`).
- [ ] Turning the toggle off, hiding the page or reaching night hours stops all tracks immediately.
- [ ] Denying permission leaves the buddy fully working, with the toggle off.
- [ ] The eyes follow a face left/right and up/down in the correct direction on the 6T.
- [ ] Arrival, leaving, close-up and long-session reactions all fire as specified.
- [ ] Holding a phone in view at the desk for 10 s or more makes the buddy look down at it, unimpressed. Putting the phone away makes it happy, and the reaction doesn't repeat within 2 minutes.
- [ ] The animation stays smooth at 30 fps with the camera on (Chrome remote debugging from the Mac).
- [ ] After 1 hour of continuous presence, battery temperature stays under about 40 °C (`adb shell cat /sys/class/power_supply/battery/temp`, value is °C × 10). If it exceeds that, lower the detection rate.
- [ ] `?mood=` previews still work, and all existing touch and auto behavior is unchanged.

## Out of scope

Recording, face recognition, the microphone, any server or analytics, and a service worker. If the agent later adds a service worker, it must cache the `/vendor/` files and must not loosen the CSP.

## Reminder for the owner (not code)

Turn on 2FA for the GitHub account that hosts the page, because anyone who can push to the repo could change what the camera code does. A physical camera cover is the only guaranteed off switch.

## As built (2026-11-12)

- **Files:** `buddy.js` (was the inline script), `buddy.css`, `camera.js` (camera, duty cycle, smoothing, presence and phone hysteresis), `vision-worker.js` (MediaPipe), `vendor/`.
- **Vendored:** `@mediapipe/tasks-vision` 1.1.1 (only `vision_bundle.mjs` and the module-worker WASM build `vision_wasm_module_internal.{js,wasm}`), `blaze_face_short_range.tflite` (float16, v1) and `efficientdet_lite0.tflite` (int8, v1), from `storage.googleapis.com/mediapipe-models/`. SHA-256:
  - `vendor/models/blaze_face_short_range.tflite`: `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`
  - `vendor/models/efficientdet_lite0.tflite`: `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`
  - `vendor/tasks-vision-1.1.1/vision_bundle.mjs`: `a84921e02321e582484c1f8126d344b5f33b791fa09c640a52e20ee8632068f1`
  - `vendor/tasks-vision-1.1.1/wasm/vision_wasm_module_internal.js`: `539a4386fd12d0723d6e900ec80467d168ba7290dda2f79e77a2181b8e906115`
  - `vendor/tasks-vision-1.1.1/wasm/vision_wasm_module_internal.wasm`: `3b57e4b55ac6346bf940212e3e11250b308a6a474077385e2f527b119cf74525`
- **Detection runs in a module worker**, so it can't block the 30 fps loop.
- **The worker is started from a `blob:` URL so the page's CSP covers it.** A worker loaded from its own URL takes its CSP from response headers, which GitHub Pages can't set. That gap was real: MediaPipe 1.1.1 POSTs usage logs to `https://odml.pa.googleapis.com/v1/log` with no documented way to turn it off. With the blob worker, `connect-src 'self'` blocks it (seen as a CSP violation in testing). Keep `worker-src blob:` for this reason, and re-check for new hosts after any MediaPipe upgrade.
- **Phone detection:** EfficientDet-Lite0 "cell phone" (score ≥ 0.5), every 3 s while a face is present. If that model fails to load, it falls back to the head-tilt cue automatically. To force the head-tilt cue (e.g. if the 6T runs hot), set `PHONE_MODE = 'tilt'` in `camera.js`. The tilt threshold (`TILT_DROP = 0.42`) is a guess: a frontal test face measured about 0.23.
- **Camera hours:** off from 22:00 to 07:00, whatever mood is set.
- **Permission prompt** appears only from a tap on the toggle. Automatic starts (on load, when the page becomes visible again, at 07:00) only run if permission is already granted. Otherwise the toggle turns off with a message.
- **Away for 10 minutes → sleepy** applies only in auto mood, not when a mood is picked by hand.

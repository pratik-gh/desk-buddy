// Front-camera presence tracking. Frames go only to the local worker; only
// present/x/y/size/phone are kept, in memory.

// 'object' = EfficientDet "cell phone" detection; 'tilt' = head tilted down.
// Switch to 'tilt' if the object model makes the phone run hot.
const PHONE_MODE = 'object';

const DETECT_MS = 500;
const IDLE_EVERY_MS = 30000;
const IDLE_WINDOW_MS = 2000;
const PHONE_EVERY_MS = 3000;
const ABSENT_AFTER_MS = 5000;
const HITS_TO_PRESENT = 2;
const EMA = 0.3;
const TILT_DROP = 0.42;         // nose-below-eyes / face width; unmeasured, tune on device
// Covers the first phone check, which also loads the 4.6 MB object model.
const RESULT_TIMEOUT_MS = 15000;

export function createCamera({ onUpdate, onLive, onError }) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');

  let worker = null, workerReady = null, pending = null, reqId = 0;
  let stream = null, timer = 0, gen = 0, running = false;
  let phoneMode = PHONE_MODE;
  let state = freshState();

  function freshState() {
    return { present: false, hits: 0, lastSeen: 0, x: 0.5, y: 0.5, size: 0,
             phone: false, phoneHits: 0, phoneMisses: 0, lastPhoneCheck: 0 };
  }

  function getWorker() {
    if (workerReady) return workerReady;
    // A worker started from its own URL takes its CSP from response headers, which GitHub
    // Pages can't set. A blob: worker inherits this page's CSP instead, so connect-src 'self'
    // also applies inside it. That matters: MediaPipe posts usage logs to Google by default.
    const src = new URL('./vision-worker.js', import.meta.url).href;
    const blobUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(src)};`], { type: 'text/javascript' }));
    worker = new Worker(blobUrl, { type: 'module' });
    workerReady = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { URL.revokeObjectURL(blobUrl); resolve(); }
        else if (data.type === 'objectsFailed') phoneMode = 'tilt';
        else if (data.type === 'result') settle(data.id, (p) => p.resolve(data));
        else if (data.type === 'error') {
          const err = new Error(data.message);
          if (data.id != null) settle(data.id, (p) => p.reject(err)); else reject(err);
        }
      };
      worker.onerror = (e) => {
        const err = new Error(e.message || 'worker failed');
        if (pending) settle(pending.id, (p) => p.reject(err));
        reject(err);
      };
    });
    worker.postMessage({ type: 'init' });
    workerReady.catch(() => { worker.terminate(); worker = null; workerReady = null; });
    return workerReady;
  }

  async function openCam(myGen) {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10, max: 15 } },
    });
    // Stopped (and maybe restarted) while waiting: this stream belongs to no one, so end it here.
    if (myGen !== gen) { for (const t of s.getTracks()) t.stop(); return false; }
    stream = s;
    for (const t of stream.getTracks()) t.addEventListener('ended', closeCam);
    onLive(true);
    video.srcObject = stream;
    await video.play();
    return true;
  }

  function closeCam() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
    onLive(false);
  }

  async function detectOnce(now) {
    if (!stream || video.readyState < 2 || !video.videoWidth) return null;
    const checkPhone = phoneMode === 'object' && state.present && now - state.lastPhoneCheck >= PHONE_EVERY_MS;
    if (checkPhone) state.lastPhoneCheck = now;
    const bitmap = await createImageBitmap(video);
    const id = ++reqId;
    const result = new Promise((resolve, reject) => {
      const t = setTimeout(() => settle(id, (p) => p.reject(new Error('detection timed out'))), RESULT_TIMEOUT_MS);
      pending = { id, t, resolve, reject };
    });
    worker.postMessage({ type: 'frame', id, bitmap, checkPhone }, [bitmap]);
    return result;
  }

  function settle(id, fn) {
    if (!pending || pending.id !== id) return;
    const p = pending; pending = null;
    clearTimeout(p.t); fn(p);
  }

  function emit() {
    onUpdate({ present: state.present, x: state.x, y: state.y, size: state.size, phone: state.phone });
  }

  function applyPhone(hit) {
    if (hit) { state.phoneHits++; state.phoneMisses = 0; } else { state.phoneMisses++; state.phoneHits = 0; }
    if (!state.phone && state.phoneHits >= 2) state.phone = true;
    else if (state.phone && state.phoneMisses >= 2) state.phone = false;
  }

  function apply(res, now) {
    const f = res && res.face;
    if (f) {
      state.lastSeen = now;
      state.hits++;
      if (state.present) {
        state.x += (f.x - state.x) * EMA; state.y += (f.y - state.y) * EMA; state.size += (f.size - state.size) * EMA;
      } else {
        state.x = f.x; state.y = f.y; state.size = f.size;
      }
      if (!state.present && state.hits >= HITS_TO_PRESENT) state.present = true;
      if (state.present) {
        if (phoneMode === 'tilt') applyPhone(f.drop != null && f.drop > TILT_DROP);
        else if (res.phone !== null) applyPhone(res.phone);
      }
    } else {
      state.hits = 0;
      if (state.present && now - state.lastSeen >= ABSENT_AFTER_MS) {
        state.present = false; state.phone = false; state.phoneHits = state.phoneMisses = 0;
      }
    }
    emit();
  }

  const wait = (ms) => new Promise((r) => { timer = setTimeout(r, ms); });

  // One idle check, which turns into continuous tracking while someone is present.
  async function cycle(myGen) {
    try {
      if (!await openCam(myGen) || myGen !== gen) return;
      await getWorker();
      if (myGen !== gen) return;
      const windowEnd = Date.now() + IDLE_WINDOW_MS;
      while (myGen === gen) {
        const start = Date.now();
        const res = await detectOnce(start);
        if (myGen !== gen) return;
        apply(res, Date.now());
        if (!state.present && state.hits === 0 && Date.now() >= windowEnd) break;
        await wait(Math.max(0, DETECT_MS - (Date.now() - start)));
      }
      if (myGen !== gen) return;
      closeCam();
      await wait(IDLE_EVERY_MS - IDLE_WINDOW_MS);
      if (myGen === gen) cycle(myGen);
    } catch (e) {
      if (myGen !== gen) return;
      stop();
      if (worker) { worker.terminate(); worker = null; workerReady = null; }
      onError(e);
    }
  }

  function start() {
    if (running) return;
    running = true;
    cycle(++gen);
  }

  function stop() {
    gen++;
    running = false;
    clearTimeout(timer);
    if (pending) settle(pending.id, (p) => p.resolve(null));
    closeCam();
    state = freshState();
  }

  return { start, stop, get running() { return running; } };
}

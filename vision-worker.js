import { FaceDetector, ObjectDetector } from './vendor/tasks-vision-1.1.1/vision_bundle.mjs';
import ModuleFactory from './vendor/tasks-vision-1.1.1/wasm/vision_wasm_module_internal.js';

// Paths are fixed here rather than sent by the page, so nothing posted to this
// worker can make it load from anywhere else.
// No wasmLoaderPath: MediaPipe would import() the loader for each task and then clear
// self.ModuleFactory, but a repeated import() is cached and doesn't set it again, so
// the second task fails. withFactory() hands it the factory imported above instead.
const FILESET = {
  wasmLoaderPath: '',
  wasmBinaryPath: new URL('./vendor/tasks-vision-1.1.1/wasm/vision_wasm_module_internal.wasm', import.meta.url).href,
};
const withFactory = (create) => { self.ModuleFactory = ModuleFactory; return create(); };
const FACE_MODEL = new URL('./vendor/models/blaze_face_short_range.tflite', import.meta.url).href;
const OBJECT_MODEL = new URL('./vendor/models/efficientdet_lite0.tflite', import.meta.url).href;

let face = null, objects = null, objectsFailed = false;

async function loadObjects() {
  if (objects || objectsFailed) return objects;
  try {
    objects = await withFactory(() => ObjectDetector.createFromOptions(FILESET, {
      baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', scoreThreshold: 0.5, maxResults: 1, categoryAllowlist: ['cell phone'],
    }));
  } catch (e) {
    objectsFailed = true;
    postMessage({ type: 'objectsFailed' });
  }
  return objects;
}

function biggestFace(bitmap) {
  let best = null;
  for (const d of face.detect(bitmap).detections) {
    const b = d.boundingBox;
    if (!b || (best && b.width <= best.box.width)) continue;
    best = { box: b, kp: d.keypoints };
  }
  if (!best) return null;
  const { box, kp } = best, w = bitmap.width, h = bitmap.height;
  const out = { x: (box.originX + box.width / 2) / w, y: (box.originY + box.height / 2) / h, size: box.width / w };
  // BlazeFace keypoints: 0 right eye, 1 left eye, 2 nose tip (normalized 0..1).
  // Tilting the head down pushes the nose tip further below the eyes relative to face width.
  if (kp && kp.length >= 3) out.drop = ((kp[2].y - (kp[0].y + kp[1].y) / 2) * h) / box.width;
  return out;
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      face = await withFactory(() => FaceDetector.createFromOptions(FILESET, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE', minDetectionConfidence: 0.6,
      }));
      postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      const bitmap = data.bitmap;
      const f = biggestFace(bitmap);
      let phone = null;
      if (f && data.checkPhone && await loadObjects()) {
        phone = objects.detect(bitmap).detections.length > 0;
      }
      bitmap.close();
      postMessage({ type: 'result', id: data.id, face: f, phone });
    }
  } catch (e) {
    data.bitmap?.close();
    postMessage({ type: 'error', id: data.id, message: String(e && e.message || e) });
  }
};

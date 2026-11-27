// Quality presets. Lighting is baked at load (progressively refined), so the runtime cost is
// dominated by resolution, MSAA, reflection/volumetric resolution and the flashlight shadow.
export const PRESETS = {
  test: { lmDensity: 0.6, scale: 0.5, msaa: 0, reflScale: 0.5, volScale: 0.25, volSteps: 8, bloomLevels: 5, flashShadow: 512, lmSize: 1024, groundLm: 512, bakeSamples: 1, skyDirs: 6, cubeSize: 128, skyMapSize: 512, texSize: 512, envSize: 32, motionBlur: false, maxDpr: 1, maxPixels: 1.0e6, minScale: 0.5, preRounds: 1, bakeBudget: 50 },
  low: { lmDensity: 0.7, scale: 0.75, msaa: 0, reflScale: 0.35, volScale: 0.25, volSteps: 10, bloomLevels: 5, flashShadow: 512, lmSize: 1024, groundLm: 640, bakeSamples: 4, skyDirs: 16, cubeSize: 128, skyMapSize: 512, texSize: 512, envSize: 64, motionBlur: false, maxDpr: 1, maxPixels: 1.3e6, minScale: 0.55, preRounds: 1, bakeBudget: 4 },
  medium: { lmDensity: 1.0, scale: 1.0, msaa: 2, reflScale: 0.5, volScale: 0.25, volSteps: 14, bloomLevels: 6, flashShadow: 1024, lmSize: 2048, groundLm: 800, bakeSamples: 8, skyDirs: 32, cubeSize: 256, skyMapSize: 1024, texSize: 1024, envSize: 128, motionBlur: false, maxDpr: 1.25, maxPixels: 2.3e6, minScale: 0.65, preRounds: 1, bakeBudget: 5 },
  high: { lmDensity: 1.8, scale: 1.0, msaa: 4, reflScale: 0.5, volScale: 0.5, volSteps: 20, bloomLevels: 6, flashShadow: 2048, lmSize: 2048, groundLm: 1024, bakeSamples: 16, skyDirs: 48, cubeSize: 256, skyMapSize: 1024, texSize: 2048, envSize: 128, motionBlur: false, maxDpr: 2, maxPixels: 3.7e6, minScale: 0.72, preRounds: 1, bakeBudget: 6 },
  ultra: { lmDensity: 2.4, scale: 1.0, msaa: 4, reflScale: 0.75, volScale: 0.5, volSteps: 28, bloomLevels: 7, flashShadow: 2048, lmSize: 4096, groundLm: 1536, bakeSamples: 32, skyDirs: 64, cubeSize: 512, skyMapSize: 2048, texSize: 2048, envSize: 256, motionBlur: false, maxDpr: 2, maxPixels: 8.3e6, minScale: 0.75, preRounds: 1, bakeBudget: 8 },
};

// Internal render resolution: native pixels (devicePixelRatio) up to a per-preset pixel budget,
// e.g. high renders a 2560x1440 window at 1:1 and a 5K retina window at ~1440p + sharpening.
export function renderPixelRatio(q, cssW, cssH) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, q.maxDpr);
  const budget = Math.sqrt(q.maxPixels / Math.max(1, cssW * cssH));
  return Math.max(0.5, Math.min(dpr, budget));
}

export function detectQuality(renderer) {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  if (mobile) return 'low';
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { /* ignore */ }
  gpu = String(gpu).toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(gpu)) return 'test';
  if (/intel(?!.*arc)|uhd|iris|mali|adreno|powervr/.test(gpu)) return 'medium';
  return 'high';
}

export function resolveQuality(name) {
  return { name, ...PRESETS[name] };
}

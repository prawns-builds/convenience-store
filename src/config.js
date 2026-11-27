// Quality presets. Lighting is baked at load (progressively refined), so the runtime cost is
// dominated by resolution, MSAA, reflection/volumetric resolution and the flashlight shadow.
export const PRESETS = {
  test: { lmDensity: 0.6, scale: 0.5, msaa: 0, reflScale: 0.5, volScale: 0.25, volSteps: 8, bloomLevels: 5, flashShadow: 512, lmSize: 1024, groundLm: 512, bakeSamples: 1, skyDirs: 6, cubeSize: 128, skyMapSize: 512, texSize: 512, envSize: 32, motionBlur: false, maxDpr: 1, preRounds: 1, bakeBudget: 50 },
  low: { lmDensity: 0.7, scale: 0.62, msaa: 0, reflScale: 0.35, volScale: 0.25, volSteps: 10, bloomLevels: 5, flashShadow: 512, lmSize: 1024, groundLm: 640, bakeSamples: 4, skyDirs: 16, cubeSize: 128, skyMapSize: 512, texSize: 512, envSize: 64, motionBlur: false, maxDpr: 1, preRounds: 2, bakeBudget: 4 },
  medium: { lmDensity: 1.0, scale: 0.82, msaa: 2, reflScale: 0.5, volScale: 0.25, volSteps: 14, bloomLevels: 6, flashShadow: 1024, lmSize: 2048, groundLm: 800, bakeSamples: 8, skyDirs: 32, cubeSize: 256, skyMapSize: 1024, texSize: 1024, envSize: 128, motionBlur: true, maxDpr: 1, preRounds: 2, bakeBudget: 5 },
  high: { lmDensity: 1.25, scale: 1.0, msaa: 4, reflScale: 0.5, volScale: 0.5, volSteps: 20, bloomLevels: 6, flashShadow: 1024, lmSize: 2048, groundLm: 1024, bakeSamples: 16, skyDirs: 48, cubeSize: 256, skyMapSize: 1024, texSize: 2048, envSize: 128, motionBlur: true, maxDpr: 1.25, preRounds: 3, bakeBudget: 6 },
  ultra: { lmDensity: 1.6, scale: 1.0, msaa: 4, reflScale: 0.75, volScale: 0.5, volSteps: 28, bloomLevels: 7, flashShadow: 2048, lmSize: 4096, groundLm: 1536, bakeSamples: 32, skyDirs: 64, cubeSize: 512, skyMapSize: 2048, texSize: 2048, envSize: 256, motionBlur: true, maxDpr: 2, preRounds: 4, bakeBudget: 8 },
};

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

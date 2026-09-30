// Pixel-diff logic, done inside a Chromium <canvas> via an already-open
// Playwright page: deliberately no native image-diff library dependency.
// Returns a normalized 0..1 mean-channel-difference score: 0 = identical,
// larger = more different. Used by capture.mjs both to measure a
// per-scenario noise floor (base shot vs. base shot) and to compare base
// vs. head.

import fs from 'node:fs/promises';

export async function compareImages(page, pathA, pathB) {
  const [bufA, bufB] = await Promise.all([fs.readFile(pathA), fs.readFile(pathB)]);
  const dataA = bufA.toString('base64');
  const dataB = bufB.toString('base64');

  return page.evaluate(async ({ a, b }) => {
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    const [imgA, imgB] = await Promise.all([
      loadImage(`data:image/png;base64,${a}`),
      loadImage(`data:image/png;base64,${b}`),
    ]);

    const w = Math.max(imgA.naturalWidth, imgB.naturalWidth);
    const h = Math.max(imgA.naturalHeight, imgB.naturalHeight);
    if (w === 0 || h === 0) return 1; // treat an unloadable image as fully different

    const canvasA = document.createElement('canvas');
    const canvasB = document.createElement('canvas');
    canvasA.width = w;
    canvasA.height = h;
    canvasB.width = w;
    canvasB.height = h;

    const ctxA = canvasA.getContext('2d');
    const ctxB = canvasB.getContext('2d');
    ctxA.drawImage(imgA, 0, 0);
    ctxB.drawImage(imgB, 0, 0);

    const pixelsA = ctxA.getImageData(0, 0, w, h).data;
    const pixelsB = ctxB.getImageData(0, 0, w, h).data;

    let diffSum = 0;
    for (let i = 0; i < pixelsA.length; i++) {
      diffSum += Math.abs(pixelsA[i] - pixelsB[i]);
    }
    return diffSum / (pixelsA.length * 255);
  }, { a: dataA, b: dataB });
}

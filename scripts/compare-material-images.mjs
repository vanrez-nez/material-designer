#!/usr/bin/env node

import sharp from "sharp";

const args = process.argv.slice(2);
const exact = args.includes("--exact");
const files = args.filter((arg) => arg !== "--exact");
if (files.length !== 2) {
  console.error("Usage: npm run compare:images -- [--exact] <reference.png> <candidate.png>");
  process.exitCode = 2;
} else {
  const [referencePath, candidatePath] = files;
  const [reference, candidate] = await Promise.all([readImage(referencePath), readImage(candidatePath)]);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Image dimensions differ: ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}`,
    );
  }

  const report = compare(reference, candidate);
  console.log(JSON.stringify({ reference: referencePath, candidate: candidatePath, exactRequired: exact, ...report }, null, 2));
  if (exact && report.mismatchedPixels > 0) process.exitCode = 1;
}

async function readImage(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function compare(reference, candidate) {
  const pixels = reference.width * reference.height;
  const channelCount = Math.min(reference.channels, candidate.channels);
  const refMean = [0, 0, 0];
  const candidateMean = [0, 0, 0];
  let squaredError = 0;
  let maxChannelDelta = 0;
  let mismatchedPixels = 0;
  const refLuma = new Float64Array(pixels);
  const candidateLuma = new Float64Array(pixels);

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * reference.channels;
    let mismatched = false;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const a = reference.data[offset + channel] / 255;
      const b = candidate.data[offset + channel] / 255;
      const delta = Math.abs(a - b);
      squaredError += delta * delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      mismatched ||= delta !== 0;
      if (channel < 3) {
        refMean[channel] += a;
        candidateMean[channel] += b;
      }
    }
    if (mismatched) mismatchedPixels += 1;
    refLuma[pixel] = luminance(reference.data, offset);
    candidateLuma[pixel] = luminance(candidate.data, offset);
  }

  for (let channel = 0; channel < channelCount; channel += 1) {
    refMean[channel] /= pixels;
    candidateMean[channel] /= pixels;
  }

  const refStdDev = channelStdDev(reference, refMean);
  const candidateStdDev = channelStdDev(candidate, candidateMean);
  const refGradientEnergy = gradientEnergy(refLuma, reference.width, reference.height);
  const candidateGradientEnergy = gradientEnergy(candidateLuma, candidate.width, candidate.height);

  return {
    pixelCount: pixels,
    mismatchedPixels,
    mismatchPercent: (mismatchedPixels / pixels) * 100,
    maxChannelDelta,
    rmse: Math.sqrt(squaredError / (pixels * channelCount)),
    globalSsim: globalSsim(refLuma, candidateLuma),
    referenceStats: {
      mean: refMean,
      stdDev: refStdDev,
      gradientEnergy: refGradientEnergy,
      seam: seamMetrics(refLuma, reference.width, reference.height),
    },
    candidateStats: {
      mean: candidateMean,
      stdDev: candidateStdDev,
      gradientEnergy: candidateGradientEnergy,
      seam: seamMetrics(candidateLuma, candidate.width, candidate.height),
    },
    gradientEnergyRatio:
      refGradientEnergy > 0 ? candidateGradientEnergy / refGradientEnergy : candidateGradientEnergy === 0 ? 1 : null,
  };
}

function luminance(data, offset) {
  return (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
}

function channelStdDev(image, mean) {
  const sums = [0, 0, 0];
  const pixels = image.width * image.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * image.channels;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = image.data[offset + channel] / 255 - mean[channel];
      sums[channel] += delta * delta;
    }
  }
  return sums.map((sum) => Math.sqrt(sum / pixels));
}

function gradientEnergy(values, width, height) {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = values[index + 1] - values[index];
      const dy = values[index + width] - values[index];
      sum += dx * dx + dy * dy;
      count += 2;
    }
  }
  return count > 0 ? sum / count : 0;
}

function seamMetrics(values, width, height) {
  let wrapH = 0;
  let wrapV = 0;
  let interiorH = 0;
  let interiorV = 0;
  for (let y = 0; y < height; y += 1) {
    wrapH += Math.abs(values[y * width + width - 1] - values[y * width]);
    for (let x = 0; x < width - 1; x += 1) {
      interiorH += Math.abs(values[y * width + x + 1] - values[y * width + x]);
    }
  }
  for (let x = 0; x < width; x += 1) {
    wrapV += Math.abs(values[(height - 1) * width + x] - values[x]);
    for (let y = 0; y < height - 1; y += 1) {
      interiorV += Math.abs(values[(y + 1) * width + x] - values[y * width + x]);
    }
  }
  wrapH /= height;
  wrapV /= width;
  interiorH /= height * Math.max(1, width - 1);
  interiorV /= width * Math.max(1, height - 1);
  return {
    ratioH: wrapH / Math.max(interiorH, 1e-6),
    ratioV: wrapV / Math.max(interiorV, 1e-6),
    wrapH,
    wrapV,
    interiorH,
    interiorV,
  };
}

function globalSsim(a, b) {
  const count = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < count; index += 1) {
    meanA += a[index];
    meanB += b[index];
  }
  meanA /= count;
  meanB /= count;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let index = 0; index < count; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    varianceA += da * da;
    varianceB += db * db;
    covariance += da * db;
  }
  const denominator = Math.max(1, count - 1);
  varianceA /= denominator;
  varianceB /= denominator;
  covariance /= denominator;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  return (
    ((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
    ((meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2))
  );
}

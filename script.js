const heart = document.querySelector("#heart");
const phraseInput = document.querySelector("#phrase");
const colorInput = document.querySelector("#glow-color");
const speedInput = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const heartSvg = document.querySelector(".heart__outline");
const heartOutline = document.querySelector("#heart-outline");

const SAMPLE_COUNT = 720;
const MAX_TOTAL_ITEM_COUNT = 84;
const MAX_PRIMARY_ITEM_COUNT = Math.floor(MAX_TOTAL_ITEM_COUNT / 2);
const PATH_SPACING = 0.52;
const CUSP_SOFTENING_SPAN = 0.075;
const CURVE_WIDTH = 32;
const TIP_ROUNDING_WIDTH = 6.5;
const TWO_PI = Math.PI * 2;
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

let curve;
let items = [];
let flowProgress = 0;
let speedSeconds = Number(speedInput.value);
let previousFrameTime = null;

function getHeartPoint(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = -(
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t)
  );

  return { x, y };
}

function findTipBoundary(targetX, start, end) {
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (start + end) / 2;
    if (Math.abs(getHeartPoint(middle).x) < targetX) {
      start = middle;
    } else {
      end = middle;
    }
  }

  return getHeartPoint((start + end) / 2).y;
}

// Round both cusps while preserving the original parametric heart between them.
const topTipY = getHeartPoint(0).y;
const bottomTipY = getHeartPoint(Math.PI).y;
const topBoundaryY = findTipBoundary(TIP_ROUNDING_WIDTH, 0, Math.PI / 2);
const bottomBoundaryY = findTipBoundary(
  TIP_ROUNDING_WIDTH,
  Math.PI,
  Math.PI * 1.5,
);
const topBoundaryDepth = topTipY - topBoundaryY;
const bottomBoundaryDepth = bottomTipY - bottomBoundaryY;

function getRoundedHeartPoint(t) {
  const point = getHeartPoint(t);
  const distanceToTop = Math.min(t, TWO_PI - t);
  const distanceToBottom = Math.abs(t - Math.PI);
  const isTopTip = distanceToTop < distanceToBottom;
  const depth = isTopTip ? topBoundaryDepth : bottomBoundaryDepth;

  if (Math.abs(point.x) >= TIP_ROUNDING_WIDTH) {
    return point;
  }

  const ratio = Math.abs(point.x) / TIP_ROUNDING_WIDTH;
  const smoothDepth = depth * ((7 / 3) * ratio ** 2 - (4 / 3) * ratio ** 3);
  return {
    x: point.x,
    y: (isTopTip ? topTipY : bottomTipY) - smoothDepth,
  };
}

const basePoints = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
  getRoundedHeartPoint((index / SAMPLE_COUNT) * TWO_PI),
);
const minY = Math.min(...basePoints.map((point) => point.y));
const maxY = Math.max(...basePoints.map((point) => point.y));
const curveHeight = maxY - minY;
const curveCenterY = (minY + maxY) / 2;

function getPhraseWidth(phrase, font) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = font;
  return context.measureText(phrase).width;
}

function createCurve(unitSize, width, height) {
  const points = basePoints.map((point) => ({
    x: width / 2 + point.x * unitSize,
    y: height / 2 + (point.y - curveCenterY) * unitSize,
  }));
  const distances = [0];

  for (let index = 1; index < points.length; index += 1) {
    distances.push(
      distances[index - 1] +
        Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y),
    );
  }

  const last = points[points.length - 1];
  const first = points[0];
  const length =
    distances[distances.length - 1] + Math.hypot(first.x - last.x, first.y - last.y);
  const pathData = `M ${points
    .map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" L ")} Z`;

  return { points, distances, length, pathData };
}

// Binary search the cumulative arc lengths for a smooth, even loop.
function pointAtDistance(path, distance) {
  const target = ((distance % path.length) + path.length) % path.length;
  let low = 1;
  let high = path.points.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (path.distances[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const endIndex = low;
  const startIndex = endIndex - 1;
  const start = path.points[startIndex];
  const end = path.points[endIndex % path.points.length];
  const startDistance = path.distances[startIndex];
  const endDistance =
    endIndex === path.points.length ? path.length : path.distances[endIndex];
  const segmentLength = endDistance - startDistance;
  const amount = segmentLength ? (target - startDistance) / segmentLength : 0;

  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function getTangentAtDistance(distance) {
  const tangentStep = (curve.length / SAMPLE_COUNT) * 4;
  const before = pointAtDistance(curve, distance - tangentStep);
  const after = pointAtDistance(curve, distance + tangentStep);
  return Math.atan2(after.y - before.y, after.x - before.x);
}

function updateItemTransforms() {
  if (!curve) return;

  items.forEach((item) => {
    const phase = (item.phase + flowProgress) % 1;
    const distance = phase * curve.length;
    const point = pointAtDistance(curve, distance);
    const tangent = getTangentAtDistance(distance);
    const pulse = motionPreference.matches
      ? 0
      : (Math.sin(phase * TWO_PI) + 1) / 2;
    const cuspDistance = Math.min(phase, 1 - phase, Math.abs(phase - 0.5));
    const cuspClearance = Math.min(1, cuspDistance / CUSP_SOFTENING_SPAN);
    const opacity =
      item.opacity + (item.peakOpacity - item.opacity) * pulse;
    const cuspOpacity = item.isTrail
      ? 0.05 + 0.95 * cuspClearance
      : 0.28 + 0.72 * cuspClearance;
    const scale =
      (item.scale + item.pulseScale * pulse) *
      (1 - (item.isTrail ? 0.12 : 0.06) * (1 - cuspClearance));
    const x = point.x - Math.sin(tangent) * item.normalOffset;
    const y = point.y + Math.cos(tangent) * item.normalOffset;
    const sway = Math.sin(tangent) * 18;

    item.element.style.opacity = String(opacity * cuspOpacity);
    item.element.style.transform =
      `translate3d(${x}px, ${y}px, 0) ` +
      `translate(-50%, -50%) rotate(${sway}deg) scale(${scale})`;
  });
}

function animate(timestamp) {
  const delta =
    previousFrameTime === null
      ? 0
      : Math.min((timestamp - previousFrameTime) / 1000, 0.05);
  previousFrameTime = timestamp;

  if (!motionPreference.matches && speedSeconds > 0) {
    flowProgress = (flowProgress + delta / speedSeconds) % 1;
  }

  updateItemTransforms();
  requestAnimationFrame(animate);
}

function renderHeart() {
  const phrase = phraseInput.value.trim() || "I Love You Ima..";
  const bounds = heart.getBoundingClientRect();
  const probe = document.createElement("span");
  probe.className = "heart__word";
  probe.textContent = phrase;
  probe.style.visibility = "hidden";
  heart.append(probe);
  const probeStyle = getComputedStyle(probe);
  const fontSize = Number.parseFloat(probeStyle.fontSize);
  const phraseWidth = getPhraseWidth(phrase, probeStyle.font);
  probe.remove();

  const margin = phraseWidth / 2 + 10;
  const unitSize = Math.min(
    (bounds.width - margin * 2) / CURVE_WIDTH,
    (bounds.height - margin * 2) / curveHeight,
  );
  curve = createCurve(unitSize, bounds.width, bounds.height);
  heartSvg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  heartSvg.setAttribute("preserveAspectRatio", "none");
  heartOutline.setAttribute("d", curve.pathData);
  const boundedPrimaryCount = Math.min(
    MAX_PRIMARY_ITEM_COUNT,
    Math.max(1, Math.floor(curve.length / (phraseWidth * PATH_SPACING))),
  );
  const primaryCount =
    boundedPrimaryCount > 2 && boundedPrimaryCount % 2 === 0
      ? boundedPrimaryCount - 1
      : boundedPrimaryCount;
  const trailCount = Math.ceil(primaryCount / 2);
  const layers = [
    {
      count: primaryCount,
      phaseOffset: 0,
      normalOffset: 0,
      fontScale: 1,
      opacity: 0.78,
      peakOpacity: 0.9,
      scale: 0.98,
      pulseScale: 0.035,
      zIndex: 4,
      isTrail: false,
    },
    {
      count: trailCount,
      phaseOffset: 0,
      normalOffset: -fontSize * 0.85,
      fontScale: 0.84,
      opacity: 0.22,
      peakOpacity: 0.34,
      scale: 0.8,
      pulseScale: 0.02,
      zIndex: 2,
      isTrail: true,
    },
    {
      count: trailCount,
      phaseOffset: trailCount ? 0.5 / trailCount : 0,
      normalOffset: fontSize * 0.85,
      fontScale: 0.84,
      opacity: 0.22,
      peakOpacity: 0.34,
      scale: 0.8,
      pulseScale: 0.02,
      zIndex: 3,
      isTrail: true,
    },
  ];
  const fragment = document.createDocumentFragment();
  items = [];

  heart.setAttribute("aria-label", `A glowing heart formed from the words ${phrase}`);

  layers.forEach((layer) => {
    for (let index = 0; index < layer.count; index += 1) {
      const depth = (index % 3) / 2;
      const phase = ((index + 0.5) / layer.count + layer.phaseOffset) % 1;
      const element = document.createElement("span");
      const item = {
        element,
        phase,
        normalOffset: layer.normalOffset,
        isTrail: layer.isTrail,
        opacity: layer.opacity + depth * 0.1,
        peakOpacity: layer.peakOpacity + depth * 0.1,
        scale: layer.scale + depth * 0.05,
        pulseScale: layer.pulseScale,
      };

      element.className = layer.isTrail
        ? "heart__word heart__word--trail"
        : "heart__word";
      element.textContent = phrase;
      element.setAttribute("aria-hidden", "true");
      element.style.setProperty(
        "--item-size",
        `${fontSize * layer.fontScale * (1 + depth * 0.04)}px`,
      );
      element.style.setProperty("--layer", String(layer.zIndex));
      fragment.append(element);
      items.push(item);
    }
  });

  heart.replaceChildren(heartSvg, fragment);
  updateItemTransforms();
}

function updateSpeed() {
  speedSeconds = Number(speedInput.value);
  speedValue.value = `${speedSeconds.toFixed(1)} s`;
}

phraseInput.addEventListener("input", renderHeart);
colorInput.addEventListener("input", () => {
  heart.style.setProperty("--glow-color", colorInput.value);
});
speedInput.addEventListener("input", updateSpeed);
window.addEventListener("resize", renderHeart);

renderHeart();
updateSpeed();
requestAnimationFrame(animate);

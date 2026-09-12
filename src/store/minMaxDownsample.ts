export type PointSeries = { xs: number[]; ys: number[] };

/**
 * Spike-preserving Min/Max envelope downsample.
 * - n <= maxPoints → exact copy
 * - otherwise: first + last always kept; middle partitioned into buckets;
 *   each bucket emits min and max in chronological order
 * - output.length <= maxPoints (hard budget)
 * - O(n) single pass per bucket; no sort; no mutation of inputs
 */
export function minMaxDownsample(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  maxPoints: number
): PointSeries {
  const n = Math.min(xs.length, ys.length);
  return minMaxDownsampleFrom(n, (i) => xs[i]!, (i) => ys[i]!, maxPoints);
}

/** Same algorithm with random-access readers (e.g. ChannelRing). */
export function minMaxDownsampleFrom(
  n: number,
  xAt: (i: number) => number,
  yAt: (i: number) => number,
  maxPoints: number
): PointSeries {
  if (n <= 0 || maxPoints <= 0) return { xs: [], ys: [] };
  if (n <= maxPoints) {
    const xs = new Array<number>(n);
    const ys = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      xs[i] = xAt(i);
      ys[i] = yAt(i);
    }
    return { xs, ys };
  }
  if (maxPoints === 1) {
    return { xs: [xAt(n - 1)], ys: [yAt(n - 1)] };
  }
  if (maxPoints === 2) {
    return { xs: [xAt(0), xAt(n - 1)], ys: [yAt(0), yAt(n - 1)] };
  }

  const outX: number[] = [];
  const outY: number[] = [];
  const push = (i: number): void => {
    outX.push(xAt(i));
    outY.push(yAt(i));
  };

  // Always keep first visible sample.
  push(0);

  const middleBudget = maxPoints - 2;
  const midStart = 1;
  const midEnd = n - 2;
  const midLen = midEnd - midStart + 1;

  if (midLen > 0) {
    if (middleBudget === 1) {
      // Only one middle slot: keep the point farthest from endpoint midpoint.
      const ref = (yAt(0) + yAt(n - 1)) / 2;
      let best = midStart;
      let bestScore = -1;
      for (let i = midStart; i <= midEnd; i++) {
        const score = Math.abs(yAt(i) - ref);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      push(best);
    } else {
      const bucketCount = Math.max(1, Math.floor(middleBudget / 2));
      let used = 0;
      for (let b = 0; b < bucketCount; b++) {
        const start = midStart + Math.floor((b * midLen) / bucketCount);
        const end = midStart + Math.floor(((b + 1) * midLen) / bucketCount) - 1;
        if (start > end) continue;

        let minI = start;
        let maxI = start;
        let minV = yAt(start);
        let maxV = minV;
        for (let i = start + 1; i <= end; i++) {
          const v = yAt(i);
          if (v < minV) {
            minV = v;
            minI = i;
          }
          if (v > maxV) {
            maxV = v;
            maxI = i;
          }
        }

        // Chronological order within the bucket (never fixed min→max).
        if (minI === maxI) {
          if (used < middleBudget) {
            push(minI);
            used += 1;
          }
        } else {
          const first = minI < maxI ? minI : maxI;
          const second = minI < maxI ? maxI : minI;
          if (used < middleBudget) {
            push(first);
            used += 1;
          }
          if (used < middleBudget) {
            push(second);
            used += 1;
          }
        }
      }
    }
  }

  // Always keep last visible sample.
  push(n - 1);

  return { xs: outX, ys: outY };
}

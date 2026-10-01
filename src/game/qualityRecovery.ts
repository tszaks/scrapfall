/** A bounded upward experiment when AUTO has stayed slow despite reducing quality.
 * Cadence alone cannot distinguish a display cap from GPU pressure. Try one higher
 * setting, retain it only if three measured windows are no worse, otherwise undo it.
 */
export type RecoverySetting = { tier: "low" | "medium" | "high"; dpr: number };
export class QualityRecovery {
  private nextAt = 30;
  private slowWindows = 0;
  private previousFrameMs = 0;
  private acceptedFrameMs: number | null = null;
  private acceptedUntil = 0;
  private trial: {
    before: RecoverySetting;
    frameMs: number;
    cpuMs: number;
    frames: number[];
    cpus: number[];
  } | null = null;
  stableSlow(slow: boolean, frameMs: number, cpuMs: number) {
    const stable =
      this.previousFrameMs > 0 &&
      Math.abs(frameMs - this.previousFrameMs) <= this.previousFrameMs * 0.1;
    this.slowWindows = slow && cpuMs < 13 ? (stable ? this.slowWindows + 1 : 1) : 0;
    this.previousFrameMs = frameMs;
    return this.slowWindows >= 3;
  }
  reset(now: number) {
    this.slowWindows = 0;
    this.previousFrameMs = 0;
    this.trial = null;
    this.acceptedFrameMs = null;
    this.acceptedUntil = 0;
    this.nextAt = now + 30;
  }
  due(now: number) {
    return !this.trial && now >= this.nextAt;
  }
  discardProtection() {
    this.acceptedFrameMs = null;
    this.acceptedUntil = 0;
  }
  protectsQuality(now: number, frameMs: number, cpuMs: number) {
    return (
      now < this.acceptedUntil &&
      this.acceptedFrameMs !== null &&
      frameMs <= this.acceptedFrameMs * 1.1 &&
      cpuMs < 13
    );
  }
  get active() {
    return this.trial !== null;
  }
  begin(now: number, before: RecoverySetting, frameMs: number, cpuMs: number) {
    this.nextAt = now + 30;
    this.trial = { before, frameMs, cpuMs, frames: [], cpus: [] };
  }
  sample(
    now: number,
    frameMs: number,
    cpuMs: number,
  ): { keep: boolean; before: RecoverySetting } | null {
    const t = this.trial;
    if (!t) return null;
    t.frames.push(frameMs);
    t.cpus.push(cpuMs);
    if (t.frames.length < 3) return null;
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const keep = mean(t.frames) <= t.frameMs * 1.05 && mean(t.cpus) <= Math.max(13, t.cpuMs * 1.1);
    if (keep) {
      this.acceptedFrameMs = mean(t.frames);
      // Reassess occasionally even if the observed cadence is unchanged.
      this.acceptedUntil = now + 300;
    }
    this.trial = null;
    this.nextAt = now + 30;
    return { keep, before: t.before };
  }
}

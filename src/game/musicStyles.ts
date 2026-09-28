// Music styles for the big maps added after Vice Heights, and the name/layout lookup that
// picks a style for a map. The sequencer itself lives in audio.ts.
import type { Style } from "./audio";
import type { Voice } from "./musicVoices";

/** A melodic line layered on top of a style's arp. */
export type Part = {
  voice: Voice;
  /** semitone offsets, null = rest (a note holds through the rests after it) */
  notes: (number | null)[];
  /** sixteenths per note */
  rate: number;
  /** "bar": offsets from the bar's root; "key": from the first bar's root (a real tune) */
  rel: "bar" | "key";
  /** semitones added on top (the roots sit in the bass register) */
  oct: number;
  gain: number;
  /** music level the part joins at: 0 from the first wave, 1 mid-run, 2 late, 3 boss only */
  from: number;
};

/** Optional extras a style can use on top of the original fields. */
export type StyleExtras = {
  /** melodic layers */
  parts?: Part[];
  /** the arp lead played with one of the new voices instead of a bare oscillator */
  leadVoice?: Voice;
  /** pad chord intervals (default [0, 7, 15], a minor colour) and voice */
  padIv?: number[];
  padVoice?: Voice;
  /** sixteenths that get a clip-clop (alternating bright/dark hoof) */
  clop?: number[];
  /** sixteenths that get a shake of sleigh bells (from level 1) */
  jingle?: number[];
  /** a low bell toll on the downbeat every other bar (from level 2) */
  toll?: boolean;
};

const R = null;

export const EXTRA_STYLES: Record<string, Style> = {
  // Dry Gulch: spaghetti western. Andalusian cadence (Am G F E), a twangy power-chord pluck
  // with slapback, a lopey clip-clop, a whistled theme mid-run and a harmonica late.
  gulch: {
    roots: [45, 43, 41, 40],
    bpm: 100,
    arp: [0, 7, 12, 7, 0, 7, 12, 19],
    lead: "sawtooth",
    leadVoice: "twang",
    leadCut: 3000,
    bass: "triangle",
    kick: [0, 8],
    snare: [],
    hat: "none",
    arpRate: 2,
    oct: 12,
    bassRate: 4,
    leadLen: 1,
    echo: true,
    swing: 0.12,
    clop: [0, 3, 8, 11],
    parts: [
      {
        voice: "whistle",
        rel: "key",
        oct: 24,
        rate: 4,
        gain: 0.075,
        from: 1,
        //       Am                 G                 F               E (G# leading tone)
        notes: [7, R, 12, R, 10, R, 7, 5, 3, 5, 3, 0, -1, R, R, R],
      },
      { voice: "harmonica", rel: "bar", oct: 12, rate: 8, gain: 0.045, from: 2, notes: [7, 12] },
      { voice: "twang", rel: "bar", oct: 0, rate: 1, gain: 0.07, from: 3, notes: [0, 0, 12, 0, 7, 0, 12, 10] },
    ],
  },
  // Pacific Pier: sunny surf / yacht rock. E-A-B-A, a reverb-drenched tremolo guitar, a glockenspiel
  // tune that joins mid-run, an organ bed and a low surf riff late.
  surf: {
    roots: [40, 45, 47, 45],
    bpm: 118,
    arp: [0, 4, 7, 12, 7, 4, 7, 4],
    lead: "square",
    leadVoice: "surf",
    leadCut: 3800,
    bass: "triangle",
    kick: [0, 8, 10],
    snare: [4, 12],
    hat: "odd",
    arpRate: 2,
    oct: 12,
    bassRate: 2,
    leadLen: 1,
    pad: true,
    padIv: [0, 4, 7],
    padVoice: "organ",
    parts: [
      {
        voice: "glock",
        rel: "key",
        oct: 24,
        rate: 4,
        gain: 0.07,
        from: 1,
        //       E               A              B              A
        notes: [16, 14, 12, R, 9, 12, 14, R, 14, 11, 7, R, 12, 9, 5, 4],
      },
      { voice: "surf", rel: "bar", oct: 0, rate: 2, gain: 0.06, from: 2, notes: [0, 0, 12, 0, 10, 0, 7, 5] },
    ],
  },
};

/** map name -> style key (checked before audio.ts's own table) */
export const EXTRA_MAP_STYLE: Record<string, string> = {
  "Dry Gulch": "gulch",
  "Pacific Pier": "surf",
};
/** big-map layout -> style key, for maps renamed after this was written */
export const LAYOUT_STYLE: Record<string, string> = {
  western: "gulch",
  beach: "surf",
  alpine: "alpine",
  city: "vice",
};

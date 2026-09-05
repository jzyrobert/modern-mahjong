import { describe, expect, test } from 'vitest';
import { cameraFor, portraitMetrics, projectPreset } from '../table/cameraPresets';
import { HAND_Z, OWN_HAND_Z } from '../table/layout';
import { TILE_D, TILE_H } from '../tiles/geometry';
import {
  REPLAY_BADGE_H,
  desktopBadgeSlots,
  landscapeBadgeSlots,
  portraitApronFor,
  replayCameraFor,
  replayChromeFor,
  replayHeldFrameFor,
  replaySyncTuning,
} from './layout';

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

describe('replayChromeFor', () => {
  test('portrait: the dock under the held hand is the match footer + tray', () => {
    for (const [w, h] of [
      [412, 700],
      [360, 640],
      [412, 915],
    ] as const) {
      const c = replayChromeFor(w, h, NO_INSETS);
      const m = portraitMetrics(h);
      expect(c.cls).toBe('phone-portrait');
      expect(c.pad).toBe(12);
      expect(c.chromeTop).toBe(12);
      expect(c.stripTop).toBe(12 + 44 + 8);
      // The hand's baseline (`heldBottom` above the bottom) sits one
      // tray gap above the dock's top edge.
      expect(c.dockBottom + c.dockH + m.trayGap).toBe(m.heldBottom);
      expect(c.fullscreenReserve).toBe(0);
    }
  });
  test('landscape: 8 px chrome pad, dense footer, fullscreen reserve', () => {
    const c = replayChromeFor(915, 412, NO_INSETS);
    expect(c.cls).toBe('phone-landscape');
    expect(c.chromeTop).toBe(8);
    expect(c.chromeH).toBe(38);
    expect(c.footerH).toBe(40);
    expect(c.footerBottom).toBe(5);
    expect(c.fullscreenReserve).toBeGreaterThan(124);
  });
  test('desktop: 24 px pad and the footer panel clears the hand row', () => {
    const w = 1440;
    const h = 900;
    const c = replayChromeFor(w, h, NO_INSETS);
    expect(c.cls).toBe('desktop');
    expect(c.pad).toBe(24);
    const handBottom = projectPreset(cameraFor(w, h), w, h, [0, 0, OWN_HAND_Z + TILE_D / 2]).y;
    expect(h - c.footerBottom - c.footerH).toBeGreaterThan(handBottom + 8);
  });
  test('device insets push the chrome and the dock inward', () => {
    const c = replayChromeFor(412, 700, { top: 30, bottom: 20, left: 0, right: 0 });
    expect(c.chromeTop).toBe(42);
    expect(c.dockBottom).toBe(32);
  });
});

describe('camera + held hand', () => {
  test('the replay camera is the match camera; only portrait holds the hand', () => {
    expect(replayCameraFor(1440, 900, 0)).toEqual(cameraFor(1440, 900, 0));
    expect(replayCameraFor(915, 412, 0)).toEqual(cameraFor(915, 412, 0));
    expect(replayHeldFrameFor(1440, 900, 0)).toBeNull();
    expect(replayHeldFrameFor(915, 412, 0)).toBeNull();
    const held = replayHeldFrameFor(412, 700, 0);
    expect(held).not.toBeNull();
    expect(held!.pxPerUnit).toBeGreaterThanOrEqual(44);
  });
  test('sync tuning mirrors the match per viewport class', () => {
    expect(replaySyncTuning('phone-portrait', true)).toMatchObject({
      riverScale: 1.36,
      nearWallDim: 1,
      sideSeatOut: 0,
      farMeldsOnRail: false,
      ownMeldsStanding: true,
    });
    expect(replaySyncTuning('phone-landscape', false)).toMatchObject({
      riverScale: 1,
      nearWallDim: 0.85,
      farMeldsOnRail: true,
    });
    expect(replaySyncTuning('desktop', false).sideSeatOut).toBeGreaterThan(0);
  });
});

describe('badge slots', () => {
  test('desktop: far badge above the far rail, side badges outboard of the racks', () => {
    const w = 1440;
    const h = 900;
    const chrome = replayChromeFor(w, h, NO_INSETS);
    const preset = cameraFor(w, h);
    const slots = desktopBadgeSlots(preset, w, h, chrome);
    expect(slots.top.centerX).toBe(w / 2);
    expect(slots.top.top!).toBeGreaterThanOrEqual(chrome.chromeTop + chrome.chromeH + 8);
    const farRail = projectPreset(preset, w, h, [0, 0.55, -13]).y;
    expect(slots.top.top! + REPLAY_BADGE_H).toBeLessThan(farRail);
    const leftFace = projectPreset(preset, w, h, [-HAND_Z - TILE_D / 2, TILE_H, 0]).x;
    const rightFace = projectPreset(preset, w, h, [HAND_Z + TILE_D / 2, TILE_H, 0]).x;
    expect(w - slots.left.right!).toBeLessThan(leftFace);
    expect(slots.right.left!).toBeGreaterThan(rightFace);
    expect(slots.left.top).toBe(slots.right.top);
  });
  test('landscape: the far badge rides in the chrome row', () => {
    const chrome = replayChromeFor(915, 412, NO_INSETS);
    const slots = landscapeBadgeSlots(915, chrome, NO_INSETS);
    expect(slots.top.centerX).toBe(Math.round(915 / 2));
    expect(slots.top.top!).toBeLessThan(chrome.chromeTop + chrome.chromeH);
    expect(slots.left.top!).toBeGreaterThan(chrome.chromeTop + chrome.chromeH);
    expect(slots.right.top!).toBeGreaterThan(slots.left.top!);
  });
});

describe('portraitApronFor', () => {
  test('portrait: the band runs from the near rail to the held hand, above the dock', () => {
    for (const [w, h] of [
      [412, 700],
      [360, 640],
      [412, 915],
    ] as const) {
      const apron = portraitApronFor(w, h, 0)!;
      expect(apron).not.toBeNull();
      const chrome = replayChromeFor(w, h, NO_INSETS);
      const railBottom = projectPreset(cameraFor(w, h), w, h, [0, 0, 13]).y;
      expect(apron.top).toBe(Math.round(railBottom));
      expect(apron.height).toBeGreaterThanOrEqual(24);
      // The apron ends at the hand's top, which sits above the dock.
      expect(apron.top + apron.height).toBeLessThan(h - chrome.dockBottom - chrome.dockH);
    }
  });
  test('null off portrait', () => {
    expect(portraitApronFor(915, 412, 0)).toBeNull();
    expect(portraitApronFor(1440, 900, 0)).toBeNull();
  });
});

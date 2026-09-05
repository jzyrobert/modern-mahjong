import { describe, expect, test } from 'vitest';
import {
  BODY_CUE_H,
  DENSE_SAVINGS,
  FRAME_HYSTERESIS,
  MIN_SCROLL_LINES,
  SCARCE_ROOM,
  STACKED_HEADER_SAVINGS,
  bodyCap,
  chooseFrame,
  fitBody,
} from './bodyCap';

const LINE = 21;

describe('bodyCap: room → body height', () => {
  test('hands the body the room less the chrome, unsnapped', () => {
    expect(bodyCap(222, 123, LINE)).toBe(99);
  });
  test('never drops under three lines plus the cue gutter', () => {
    expect(bodyCap(150, 123, LINE)).toBe(MIN_SCROLL_LINES * LINE + BODY_CUE_H);
    expect(bodyCap(0, 200, LINE)).toBe(75);
  });
  test('an unbounded room leaves the body unbounded', () => {
    expect(bodyCap(Number.POSITIVE_INFINITY, 236, LINE)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fitBody: whole text when it fits, whole lines above the cue when not', () => {
  test('a text that fits shows whole — no gutter reserved, no overflow', () => {
    // 360×640 phone, dense frame: the room leaves 99 px; a four-line
    // step (84 px) shows all four, where the old cap (snapped to three
    // lines plus the cue) showed two and a chevron.
    expect(fitBody(84, 99, LINE)).toEqual({ overflow: false, height: 84, lines: 4 });
    // Exactly the cap fits too (a room that holds exactly four lines).
    expect(fitBody(84, 84, LINE)).toEqual({ overflow: false, height: 84, lines: 4 });
  });
  test('a longer text gets every whole line that fits above the cue', () => {
    // Five lines (105 px) under a 99 px cap: four lines + the 12 px cue = 96.
    expect(fitBody(105, 99, LINE)).toEqual({ overflow: true, height: 84, lines: 4 });
    // 103 px cap (360×640 dice card, below dock): four lines, not three.
    expect(fitBody(105, 103, LINE)).toEqual({ overflow: true, height: 84, lines: 4 });
  });
  test('the floor cap shows three lines and the cue', () => {
    const cap = bodyCap(0, 999, LINE);
    expect(fitBody(168, cap, LINE)).toEqual({ overflow: true, height: 63, lines: 3 });
  });
  test('never fewer than two lines even under a tiny cap', () => {
    expect(fitBody(105, 30, LINE).lines).toBe(2);
  });
  test('strip lines at 18 px', () => {
    // Portrait dice strip: a 146 px band, 4 px breathing, ~50 px chrome.
    const cap = bodyCap(146 - 4, 50, 18);
    expect(cap).toBe(92);
    expect(fitBody(72, cap, 18)).toEqual({ overflow: false, height: 72, lines: 4 });
    expect(fitBody(108, cap, 18)).toEqual({ overflow: true, height: 72, lines: 4 });
  });
});

describe('chooseFrame: body lines before decoration', () => {
  const phone = { width: 388 };
  const small = { width: 336 };

  test('a scarce room is dense before anything is measured', () => {
    expect(
      chooseFrame({ room: 222, chrome: null, current: 'regular', contentHeight: null, ...small }),
    ).toBe('dense');
    expect(SCARCE_ROOM).toBeGreaterThan(222);
  });
  test('unmeasured cards keep their frame', () => {
    expect(
      chooseFrame({ room: 275, chrome: null, current: 'regular', contentHeight: null, ...phone }),
    ).toBe('regular');
    expect(
      chooseFrame({ room: 275, chrome: 125, current: 'dense', contentHeight: null, ...phone }),
    ).toBe('dense');
  });
  test('regular when the regular frame shows the whole text', () => {
    // 412×700 phone, claims intro: 275 px room, 153 px regular chrome, 84 px text.
    expect(
      chooseFrame({ room: 275, chrome: 153, current: 'regular', contentHeight: 84, ...phone }),
    ).toBe('regular');
  });
  test('dense when the regular frame would scroll the text', () => {
    // Scoring 101: eight lines (168 px) — regular leaves 122 px, dense 150.
    expect(
      chooseFrame({ room: 275, chrome: 153, current: 'regular', contentHeight: 168, ...phone }),
    ).toBe('dense');
  });
  test('an unbounded room (desktop, side dock) stays regular', () => {
    expect(
      chooseFrame({
        room: Number.POSITIVE_INFINITY,
        chrome: 153,
        current: 'regular',
        contentHeight: 300,
        width: 440,
      }),
    ).toBe('regular');
  });
  test('a dense card estimates the regular chrome and only returns with slack', () => {
    // Rooms here sit above `SCARCE_ROOM`, where the content rule decides.
    const chrome = 150;
    const regular = chrome + DENSE_SAVINGS;
    // Room that fits the text under the regular frame by a hair: stays dense.
    expect(
      chooseFrame({
        room: regular + 84 + FRAME_HYSTERESIS - 1,
        chrome,
        current: 'dense',
        contentHeight: 84,
        ...phone,
      }),
    ).toBe('dense');
    // …and returns once the slack is there.
    expect(
      chooseFrame({
        room: regular + 84 + FRAME_HYSTERESIS,
        chrome,
        current: 'dense',
        contentHeight: 84,
        ...phone,
      }),
    ).toBe('regular');
  });
  test('the stacked header counts toward the regular chrome on narrow cards', () => {
    const chrome = 123;
    const wide = chrome + DENSE_SAVINGS;
    const narrow = wide + STACKED_HEADER_SAVINGS;
    const room = narrow + 84 + FRAME_HYSTERESIS - 1;
    expect(chooseFrame({ room, chrome, current: 'dense', contentHeight: 84, ...small })).toBe(
      'dense',
    );
    expect(chooseFrame({ room, chrome, current: 'dense', contentHeight: 84, ...phone })).toBe(
      'regular',
    );
  });
  test('no flip-flop: a regular decision holds after the regular chrome is measured', () => {
    // The dense estimate under-reads the real regular chrome by less
    // than the hysteresis, so the regular measurement still fits.
    const chrome = 150;
    const room = chrome + DENSE_SAVINGS + 84 + FRAME_HYSTERESIS;
    expect(chooseFrame({ room, chrome, current: 'dense', contentHeight: 84, ...phone })).toBe(
      'regular',
    );
    const realRegular = chrome + DENSE_SAVINGS + FRAME_HYSTERESIS - 1;
    expect(
      chooseFrame({ room, chrome: realRegular, current: 'regular', contentHeight: 84, ...phone }),
    ).toBe('regular');
  });
});

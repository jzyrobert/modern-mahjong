import type { BotKind } from '@mahjong/bots';
import type { Claim, Event as EngineEvent, GameState, Seat, Tile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';

export interface LobbyState {
  players: PublicPlayer[];
  host: string | null;
  rules: RuleConfig;
  /** Live spectator count from the server. Older servers omit this; defaults to 0. */
  viewers?: number;
}

/** Felt skin id — drives the table-surface gradient hue + chroma. */
export type FeltSkin = 'sage' | 'jade' | 'ocean' | 'rose';
/** Tile-back skin id — drives the face-down tile gradient. */
export type TileBackSkin = 'cream' | 'blue' | 'plum' | 'mint';

export interface UserSettings {
  felt: FeltSkin;
  tileBack: TileBackSkin;
  /** Override for the OS-level prefers-reduced-motion. true=motion on, false=reduced. */
  animations: boolean;
  /** Sound effects toggle. Gates every cue in `sound.ts` — tile
   *  clacks on discard/claim, dice roll on hand start, the shuffle
   *  fade-in/fade-out during the between-hand ceremony. */
  sound: boolean;
  /** When true, on the user's discard turn (after they've drawn) the
   *  tile the heuristic ranker recommends discarding is highlighted in
   *  the hand. Reads from the same `rankDiscards` ranker the
   *  `heuristicBot` uses, so the hint matches what a smart bot in the
   *  same seat would discard. Off by default so the user's first
   *  match isn't pre-coached. */
  discardHint: boolean;
  /** Per-seat bot kind for solo / practice matches. Indexed by seat
   *  1..3 (seat 0 is the user). The default mirrors the historical
   *  hard-coded mix in `createSoloTransport`. Persisted across
   *  sessions so the user's last-picked skill set survives reloads. */
  botSkills: [BotKind, BotKind, BotKind];
  /** When true, every match auto-saves to the replay library on
   *  teardown. Default off — the user opts in either by flipping this
   *  setting once, or by hitting "Save this match" from the in-match
   *  menu (per-match opt-in). */
  autoRecordReplays: boolean;
  /** Maximum number of replays kept on disk. Oldest entries prune on
   *  insert past this cap. */
  replayQuota: number;
  /** Lesson ids the user has finished. Drives the lobby Tutorial
   *  card's "completed" affordance and the ☰-menu "Restart tutorial"
   *  row. Lessons are append-only; ids never get removed once they
   *  land here. */
  tutorialsCompleted: string[];
  /** Persisted defaults for the lobby's RulePanel — `LobbyView`'s
   *  host-side effect dispatches `setRules` to the engine on first
   *  mount so the user sees their last-chosen values, and the
   *  RulePanel writes back here on every change. Keeps the user's
   *  preferred faan floor + turn-timer setting sticky across matches
   *  instead of resetting to the engine defaults each time. */
  lobbyRulePrefs: {
    faanMin: RuleConfig['faanMin'];
    /** ms, with `0` representing "no turn timer" (∞). */
    turnTimeoutMs: number;
  };
  /** Which accordion sections the user last left open in the
   *  phone-class `LobbyAccordion`. Persisted so the lobby feels
   *  "remembered" across matches — a user who collapses Bots after
   *  picking a mix shouldn't have to collapse it again next match.
   *  Sections only render in contexts where they're meaningful
   *  (Bots = host, Invite = LAN host), so persisting a key that
   *  doesn't apply to the next match's role is harmless — the row
   *  just won't render. */
  lobbyAccordionOpen: ReadonlyArray<'bots' | 'rules' | 'invite'>;
}

const DEFAULT_SETTINGS: UserSettings = {
  felt: 'sage',
  tileBack: 'blue',
  animations: true,
  sound: true,
  discardHint: false,
  botSkills: ['heuristic', 'simple', 'passive'],
  autoRecordReplays: false,
  replayQuota: 50,
  tutorialsCompleted: [],
  // Mirrors the new `DEFAULT_RULES` floor (faan 0, timer off) — the
  // user opts in to higher floors / armed timers via the lobby
  // RulePanel and the change persists here.
  lobbyRulePrefs: {
    faanMin: 0,
    turnTimeoutMs: 0,
  },
  // Mirrors `LobbyAccordion`'s former first-paint default: hosts land
  // with Bots open (single most-actionable knob in a fresh lobby).
  // The user's manual toggles overwrite this and stick from then on.
  lobbyAccordionOpen: ['bots'],
};

const SETTINGS_STORAGE_KEY = 'mj.settings.v1';

/**
 * Read the persisted UserSettings out of localStorage, with each
 * sub-field falling back to `DEFAULT_SETTINGS` when missing.
 *
 * The merge is intentionally one-level-deep for `lobbyRulePrefs`: a
 * persisted blob whose `lobbyRulePrefs` is partial (e.g. only
 * `faanMin` because a future migration added a third field, or a
 * hand-edited devtools value) would otherwise replace the whole
 * sub-object via the top-level spread, leaving sub-fields `undefined`
 * even though the type declares them required. The downstream
 * `setRules` dispatch in `LobbyView` would then send `undefined` into
 * the engine as a typed `number`, breaking turn-deadline scheduling.
 *
 * Other top-level sub-objects (`botSkills`, `tutorialsCompleted`) are
 * arrays and don't suffer the same partial-shape risk — a missing
 * array key still inherits the default via the top-level spread; a
 * persisted array fully replaces the default by design (the user's
 * recorded bot picks should win over the seed mix).
 *
 * Exported so unit tests can pin migration behaviour directly without
 * round-tripping through the zustand factory.
 */
export function loadSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      lobbyRulePrefs: {
        ...DEFAULT_SETTINGS.lobbyRulePrefs,
        ...parsed.lobbyRulePrefs,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(s: UserSettings): void {
  const json = JSON.stringify(s);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, json);
    } catch {
      /* storage might be full or disabled in private mode — silent skip */
    }
  }
}

/**
 * One ring-buffer entry. The engine emits `Event[]` per `apply`; the client
 * keeps the last `LOG_CAPACITY` events tagged with a monotonic `seq` so the
 * UI can render a stable list keyed off it.
 */
export interface LogEntry {
  seq: number;
  event: EngineEvent;
}

const LOG_CAPACITY = 12;

interface ClientGameStore {
  state: GameState | null;
  you: Seat | 'spectator' | null;
  lobby: LobbyState | null;
  /**
   * True while the between-hand shuffle overlay is active. `Tile` reads
   * this to swap to a slower transition so the layoutId-driven dispense
   * (every tile flying from its old position to its new wall position)
   * is deliberate enough to read.
   */
  shuffling: boolean;
  /**
   * User preferences — felt skin, tile-back, sort behaviour, animations,
   * sound. Loaded from localStorage on init; mirrored back on every
   * `setSettings` call. On native, the `expo-sqlite/localStorage/install`
   * polyfill imported at app startup makes localStorage durable across
   * WebView wipes / app reinstalls, so no separate native-preferences
   * mirror is needed.
   */
  settings: UserSettings;
  /**
   * Last `LOG_CAPACITY` engine events the server broadcast on this match.
   * Cleared on reset; populated by `appendEvents(events)` from the
   * server's `delta` messages.
   */
  log: LogEntry[];
  /**
   * Engine `tileId` of the tile the local seat most recently drew, or
   * null when the user has discarded / it's not their turn / they haven't
   * drawn yet. Drives the soft gold glow on the just-drawn tile in
   * `Hand.tsx`. Maintained inside `appendEvents` from the engine's
   * `drew` / `discarded` events so it stays in sync with the wire stream.
   */
  drawnTileId: number | null;
  /**
   * Per-tileId display order used when `sortMode === 'manual'`. Cleared on
   * reset / handStarted so each fresh hand starts from a clean slate. New
   * tiles drawn into the hand append to the end; tiles that leave the hand
   * are pruned in `setManualOrder`. Empty array means the user hasn't
   * touched the order yet — Hand falls back to engine order.
   */
  manualOrder: number[];
  /**
   * Recent chat / emote messages — tagged with sender seat and an
   * incrementing local seq so React keys stay stable. Cleared on reset.
   * The `ChatBubbles` overlay reads this and auto-dismisses each entry
   * after a short window.
   */
  chats: ChatEntry[];
  /**
   * Monotonic counter incremented when a claim attempt loses the race
   * — either a server `PHASE` error after the hard fallback fired, or
   * a `claimsResolved` event that didn't crown the user. Drives the
   * `ClaimMissedToast` overlay; cleared on `reset`.
   */
  claimMissedSeq: number;
  /**
   * Most-recent successful chi/peng/gang claim by any seat. `seq` ticks
   * up on every flash so the `ClaimAnnouncementToast` consumer can
   * deduplicate. Set from the `claimsResolved` event handler in
   * `transport-context.tsx`; cleared on `reset` / `handStarted`.
   */
  claimAnnouncement: {
    seq: number;
    seat: Seat;
    kind: ClaimMeldKind;
  } | null;
  /**
   * The most recent local-seat `drew` event the user is still animating
   * through — `seq` ticks up per draw so `DrawTileOverlay` can dedupe
   * consecutive draws (e.g. rapid gang-replacement chains). `slotRect`
   * is the matching `HandTile`'s screen rect in window coordinates
   * (filled in once the tile lays out); the overlay uses it to land
   * the fly phase on the exact destination slot. Cleared on
   * `clearDrawAnimation` / `reset`.
   */
  drawAnimation: {
    seq: number;
    tile: Tile;
    slotRect: { x: number; y: number; width: number; height: number } | null;
    /**
     * `'hold'` for the popup's rise + flip + hold phases (face-down →
     * flip face-up at the cue / wall position). `'fly'` once the popup
     * begins travelling toward the hand. `Hand.tsx` filters the
     * freshly-drawn tile out of its rendered row while `phase === 'hold'`
     * so siblings stay tight — the row only opens to receive the new
     * tile when the popup is actually approaching, which is what the
     * user perceives as the gap appearing "during the animation"
     * rather than at t=0.
     */
    phase: 'hold' | 'fly';
    /** Wall slot the tile is rising from — snapshotted from
     *  `wallSourceContext` at the moment of the draw so the rise
     *  phase originates from the physical wall position even though
     *  the wall layout has already mutated by the time the snapshot
     *  fires. Null on mobile (no wall rendered) → the overlay falls
     *  back to the thumb-zone cue anchor. */
    sourceRect: { x: number; y: number; width: number; height: number } | null;
    /** `true` for east / west wall draws — the wall tile is rendered
     *  rotated 90°, so the overlay starts at that rotation and
     *  reorients to portrait during the rise. */
    sourceLandscape: boolean;
  } | null;
  /**
   * Live screen rect of the wall's next-to-draw slot, kept up to date
   * by `WallEdge` as the next-draw cursor moves around the felt. Reads
   * are one-shot: `flashDrawAnimation` snapshots whatever's here into
   * `drawAnimation.sourceRect/.sourceLandscape` and the field can go
   * stale afterwards — by the time the snapshot fires the wall slot
   * has already disappeared (the tile is now in the hand). `landscape`
   * is true for left/right walls (where the wall tile is rendered
   * rotated 90°).
   */
  wallSourceContext: {
    rect: { x: number; y: number; width: number; height: number };
    landscape: boolean;
  } | null;
  /**
   * Monotonic high-water mark for `drawAnimation.seq`. Persists across
   * `clearDrawAnimation` (which nulls `drawAnimation` but leaves this
   * counter alone) so every subsequent `flashDrawAnimation` gets a
   * strictly increasing seq — the consumer (`DrawTileOverlay`) dedupes
   * via this seq, and a per-object counter that reset to 1 after each
   * clear would alias the second-and-onward draw of every match,
   * silently swallowing the popup. Cleared on `reset` so a fresh
   * lobby → match transition starts the seq at 0 again.
   */
  drawAnimationLastSeq: number;
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: LobbyState) => void;
  setShuffling: (shuffling: boolean) => void;
  setSettings: (patch: Partial<UserSettings>) => void;
  setManualOrder: (ids: number[]) => void;
  appendEvents: (events: EngineEvent[]) => void;
  pushChat: (entry: { from: Seat | 'spectator'; text: string; ts: number }) => void;
  dismissChat: (seq: number) => void;
  flashClaimMissed: () => void;
  flashClaimAnnouncement: (a: { seat: Seat; kind: ClaimMeldKind }) => void;
  flashDrawAnimation: (tile: Tile) => void;
  clearDrawAnimation: () => void;
  setDrawAnimationSlotRect: (
    rect: { x: number; y: number; width: number; height: number } | null,
  ) => void;
  /**
   * Advance the draw animation's phase. `DrawTileOverlay` calls this
   * once per animation when its `progress` value crosses the fly
   * threshold, promoting the popup from `'hold'` (rise + flip + hold
   * face-up at the source position) to `'fly'` (descending into the
   * hand). `Hand.tsx` keys its "is the freshly-drawn tile in the
   * rendered row yet" decision on this — see `drawAnimation.phase`
   * above.
   */
  setDrawAnimationPhase: (phase: 'hold' | 'fly') => void;
  setWallSourceContext: (
    ctx: {
      rect: { x: number; y: number; width: number; height: number };
      landscape: boolean;
    } | null,
  ) => void;
  reset: () => void;
}

/** chi / peng / gang — the three discard-claim kinds that announce a
 *  visible meld. Excludes `pass` and `hu` (the latter has its own
 *  WinCelebration cue). Sourced off the engine's `Claim` union so the
 *  set stays in sync if the rules ever add another meld kind. */
export type ClaimMeldKind = Exclude<Claim['kind'], 'pass' | 'hu'>;

export interface ChatEntry {
  /** Local monotonic counter — used as the React key. */
  seq: number;
  /** Server-tagged sender. */
  from: Seat | 'spectator';
  text: string;
  /** Server timestamp. */
  ts: number;
}

const CHAT_CAPACITY = 24;

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  shuffling: false,
  settings: loadSettings(),
  log: [],
  drawnTileId: null,
  manualOrder: [],
  chats: [],
  claimMissedSeq: 0,
  claimAnnouncement: null,
  drawAnimation: null,
  drawAnimationLastSeq: 0,
  wallSourceContext: null,
  setState: (state, you) => set((prev) => ({ state, you: you ?? prev.you })),
  setLobby: (lobby) => set({ lobby }),
  setShuffling: (shuffling) => set({ shuffling }),
  setSettings: (patch) =>
    set((prev) => {
      const next = { ...prev.settings, ...patch };
      persistSettings(next);
      return { settings: next };
    }),
  setManualOrder: (ids) => set({ manualOrder: [...ids] }),
  pushChat: (entry) =>
    set((prev) => {
      const seq = prev.chats.length > 0 ? prev.chats[prev.chats.length - 1]!.seq + 1 : 0;
      const next = [...prev.chats, { seq, ...entry }];
      return { chats: next.length > CHAT_CAPACITY ? next.slice(-CHAT_CAPACITY) : next };
    }),
  dismissChat: (seq) => set((prev) => ({ chats: prev.chats.filter((c) => c.seq !== seq) })),
  flashClaimMissed: () => set((prev) => ({ claimMissedSeq: prev.claimMissedSeq + 1 })),
  flashClaimAnnouncement: (a) =>
    set((prev) => ({
      claimAnnouncement: {
        seat: a.seat,
        kind: a.kind,
        seq: (prev.claimAnnouncement?.seq ?? 0) + 1,
      },
    })),
  flashDrawAnimation: (tile) =>
    set((prev) => {
      const seq = prev.drawAnimationLastSeq + 1;
      return {
        drawAnimation: {
          tile,
          seq,
          slotRect: null,
          phase: 'hold',
          sourceRect: prev.wallSourceContext?.rect ?? null,
          sourceLandscape: prev.wallSourceContext?.landscape ?? false,
        },
        drawAnimationLastSeq: seq,
      };
    }),
  clearDrawAnimation: () => set({ drawAnimation: null }),
  setWallSourceContext: (ctx) =>
    set((prev) => {
      const cur = prev.wallSourceContext;
      if (!cur && !ctx) return prev;
      if (
        cur &&
        ctx &&
        cur.landscape === ctx.landscape &&
        cur.rect.x === ctx.rect.x &&
        cur.rect.y === ctx.rect.y &&
        cur.rect.width === ctx.rect.width &&
        cur.rect.height === ctx.rect.height
      ) {
        return prev;
      }
      return { wallSourceContext: ctx };
    }),
  setDrawAnimationSlotRect: (rect) =>
    set((prev) => {
      const a = prev.drawAnimation;
      if (!a) return prev;
      // Strict-equality guard so re-rendering the matching HandTile
      // doesn't churn the slice (and the overlay's subscribers) when
      // the rect didn't actually move.
      const cur = a.slotRect;
      if (
        cur &&
        rect &&
        cur.x === rect.x &&
        cur.y === rect.y &&
        cur.width === rect.width &&
        cur.height === rect.height
      ) {
        return prev;
      }
      return { drawAnimation: { ...a, slotRect: rect } };
    }),
  setDrawAnimationPhase: (phase) =>
    set((prev) => {
      const a = prev.drawAnimation;
      if (!a || a.phase === phase) return prev;
      return { drawAnimation: { ...a, phase } };
    }),
  appendEvents: (events) =>
    set((prev) => {
      if (events.length === 0) return prev;
      const baseSeq = prev.log.length > 0 ? prev.log[prev.log.length - 1]!.seq + 1 : 0;
      const fresh = events.map((event, i) => ({ seq: baseSeq + i, event }));
      const log = [...prev.log, ...fresh];
      const trimmed = log.length > LOG_CAPACITY ? log.slice(-LOG_CAPACITY) : log;

      // Track the local seat's drawn tile from drew/discarded events so
      // Hand.tsx can glow it. `you` may be null (spectator / lobby) — in
      // that case nothing to update.
      let drawnTileId = prev.drawnTileId;
      let manualOrder = prev.manualOrder;
      if (typeof prev.you === 'number') {
        for (const event of events) {
          if (event.t === 'drew' && event.seat === prev.you) {
            drawnTileId = tileId(event.tile);
            // New tile in the hand — append to manual order so it slots in
            // at the end rather than disappearing.
            const id = tileId(event.tile);
            if (!manualOrder.includes(id)) manualOrder = [...manualOrder, id];
          } else if (event.t === 'discarded' && event.seat === prev.you) {
            drawnTileId = null;
            const id = tileId(event.tile);
            if (manualOrder.includes(id)) manualOrder = manualOrder.filter((x) => x !== id);
          } else if (event.t === 'handStarted') {
            // Fresh hand — old drawn-tile reference is stale and the
            // manual order reset to empty.
            drawnTileId = null;
            manualOrder = [];
          }
        }
      }

      const next: Partial<ClientGameStore> = { log: trimmed };
      if (drawnTileId !== prev.drawnTileId) next.drawnTileId = drawnTileId;
      if (manualOrder !== prev.manualOrder) next.manualOrder = manualOrder;
      return next;
    }),
  reset: () =>
    set({
      state: null,
      you: null,
      lobby: null,
      shuffling: false,
      log: [],
      drawnTileId: null,
      manualOrder: [],
      chats: [],
      claimMissedSeq: 0,
      claimAnnouncement: null,
      drawAnimation: null,
      drawAnimationLastSeq: 0,
      wallSourceContext: null,
    }),
}));

export function playerForSeat(lobby: LobbyState | null, seat: Seat | null): PublicPlayer | null {
  if (!lobby || seat === null) return null;
  return lobby.players.find((p) => p.seat === seat) ?? null;
}

export function isSeatHost(lobby: LobbyState | null, seat: Seat | null): boolean {
  if (!lobby || lobby.host === null) return false;
  const p = playerForSeat(lobby, seat);
  return p !== null && p.playerId === lobby.host;
}

export function nameForSeat(lobby: LobbyState | null, seat: Seat): string {
  return playerForSeat(lobby, seat)?.displayName ?? `Seat ${seat}`;
}

// Test-only hatch: expose the zustand store getter on `globalThis` so
// Playwright specs can read the engine state without us threading a
// data-testid through every consumer. Harmless in production — the
// store is already in memory, this is a getter — but only used by
// `apps/client/e2e/*.spec.ts` test code.
declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_GET_STATE__: (() => ClientGameStore) | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_GET_STATE__ = () => useGame.getState();
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GUIDE,
  endTour,
  finishWelcome,
  GUIDE_KEY,
  type Guide,
  loadGuide,
  saveGuide,
  setRunView,
  setTheme,
  setView,
  showAgain,
} from "./guide";
import { placeCard } from "./GuideScreens";

const SECRET = "SECRET-SAVED-TEXT";

// What a first start gets: the plain view, the welcome screen, the dark theme and the board.
const START: Guide = { view: "plain", welcomed: false, tour: null, theme: "dark", runView: "board" };
const SETTLED: Guide = { ...START, welcomed: true, tour: "done" };

function logged(): string {
  const calls = [...vi.mocked(console.debug).mock.calls, ...vi.mocked(console.warn).mock.calls];
  return calls.map((args) => args.join(" ")).join("\n");
}

function warned(): string {
  return vi
    .mocked(console.warn)
    .mock.calls.map((args) => args.join(" "))
    .join("\n");
}

function memory(saved: Record<string, string> = {}) {
  return {
    getItem: vi.fn((key: string) => saved[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved[key] = value;
    }),
  };
}

const refused = () => new DOMException(`Access denied: ${SECRET}`, "SecurityError");

// Like a browser with site data blocked: even reading `localStorage` throws.
const unreachable = () => {
  throw refused();
};

function broken() {
  const error = refused();
  return {
    getItem: vi.fn((_key: string): string | null => {
      throw error;
    }),
    setItem: vi.fn((_key: string, _value: string) => {
      throw error;
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadGuide", () => {
  it("starts with the plain view, the welcome screen, dark and the board when nothing is saved", () => {
    expect(loadGuide(() => memory())).toEqual(START);
    expect(DEFAULT_GUIDE).toEqual(START);
    expect(warned()).toBe("");
  });

  it("reads back what was saved", () => {
    const saved: Guide = { view: "technical", welcomed: true, tour: "done", theme: "light", runView: "list" };
    const storage = memory({ [GUIDE_KEY]: JSON.stringify(saved) });

    expect(loadGuide(() => storage)).toEqual(saved);
    expect(storage.getItem).toHaveBeenCalledWith("agentforge.guide");
  });

  it("reads a save from before the theme and the run view, adding dark and the board", () => {
    const old = { view: "technical", welcomed: true, tour: "done" };

    expect(loadGuide(() => memory({ [GUIDE_KEY]: JSON.stringify(old) }))).toEqual({
      ...old,
      theme: "dark",
      runView: "board",
    });
    expect(warned()).toBe("");
  });

  it.each([
    ["text that is not JSON", `${SECRET}{`, "SyntaxError"],
    ["an unknown view", JSON.stringify({ view: SECRET, welcomed: true, tour: null }), "bad shape"],
    ["an unknown tour state", JSON.stringify({ view: "plain", welcomed: true, tour: SECRET }), "bad shape"],
    ["a welcome flag that is not true or false", JSON.stringify({ view: "plain", welcomed: SECRET, tour: null }), "bad shape"],
    ["an unknown theme", JSON.stringify({ ...SETTLED, theme: SECRET }), "bad shape"],
    ["an unknown run view", JSON.stringify({ ...SETTLED, runView: SECRET }), "bad shape"],
    ["a value that is not an object", JSON.stringify(SECRET), "bad shape"],
    ["null", "null", "bad shape"],
  ])("falls back to the start for %s, logging why but never the saved text", (_, text, why) => {
    expect(loadGuide(() => memory({ [GUIDE_KEY]: text }))).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain(`guide: could not read the saved choices: ${why}`);
    expect(logged()).not.toContain(SECRET);
  });

  it("falls back to the start when the storage refuses, logging the error's name only", () => {
    expect(loadGuide(() => broken())).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain("guide: could not read the saved choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });

  it("falls back to the start when the window has no storage", () => {
    expect(loadGuide(() => undefined)).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain("guide: could not read the saved choices: no storage");
  });

  it("falls back to the start when the storage cannot even be reached", () => {
    expect(loadGuide(unreachable)).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain("guide: could not read the saved choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });
});

describe("saveGuide", () => {
  it("writes the choices as JSON under its key", () => {
    const storage = memory();
    const guide: Guide = { ...SETTLED, view: "technical", tour: "wanted", theme: "light" };

    saveGuide(() => storage, guide);

    expect(storage.setItem).toHaveBeenCalledWith("agentforge.guide", JSON.stringify(guide));
    expect(loadGuide(() => storage)).toEqual(guide);
  });

  it("warns by name and carries on when the storage refuses", () => {
    expect(() => saveGuide(() => broken(), DEFAULT_GUIDE)).not.toThrow();
    expect(warned()).toContain("guide: could not save the choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });

  it("warns and carries on when the window has no storage", () => {
    expect(() => saveGuide(() => undefined, DEFAULT_GUIDE)).not.toThrow();
    expect(warned()).toContain("guide: could not save the choices: no storage");
  });

  it("warns by name and carries on when the storage cannot even be reached", () => {
    expect(() => saveGuide(unreachable, DEFAULT_GUIDE)).not.toThrow();
    expect(warned()).toContain("guide: could not save the choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });
});

describe("the guide's steps", () => {
  it("passes the welcome with the chosen view, wanting the tour or skipping it", () => {
    const light: Guide = { ...START, view: "technical", theme: "light", runView: "list" };
    expect(finishWelcome(light, true)).toEqual({ ...light, welcomed: true, tour: "wanted" });
    expect(finishWelcome(START, false)).toEqual({ ...START, welcomed: true, tour: "skipped" });
    expect(logged()).toContain("guide: welcome passed, view=technical, tour=wanted");
    expect(logged()).toContain("guide: welcome passed, view=plain, tour=skipped");
  });

  it("ends the tour as done when finished and as skipped when stopped early", () => {
    const touring: Guide = { ...SETTLED, tour: "wanted" };

    expect(endTour(touring, true)).toEqual({ ...touring, tour: "done" });
    expect(endTour(touring, false)).toEqual({ ...touring, tour: "skipped" });
    expect(logged()).toContain("guide: tour done");
    expect(logged()).toContain("guide: tour skipped");
  });

  it("switches the view and keeps the rest", () => {
    expect(setView(SETTLED, "technical")).toEqual({ ...SETTLED, view: "technical" });
    expect(logged()).toContain("guide: view=technical");
  });

  it("switches the theme and keeps the rest", () => {
    expect(setTheme(SETTLED, "light")).toEqual({ ...SETTLED, theme: "light" });
    expect(logged()).toContain("guide: theme=light");
  });

  it("switches how a run is shown and keeps the rest", () => {
    expect(setRunView(SETTLED, "list")).toEqual({ ...SETTLED, runView: "list" });
    expect(logged()).toContain("guide: run view=list");
  });

  it("shows the guide again from the welcome screen, keeping the view, theme and run view", () => {
    const guide: Guide = { view: "technical", welcomed: true, tour: "skipped", theme: "light", runView: "list" };

    expect(showAgain(guide)).toEqual({ ...guide, welcomed: false, tour: null });
    expect(logged()).toContain("guide: shown again");
  });
});

describe("placeCard", () => {
  const card = { width: 340, height: 170 };
  const wide = { width: 1000, height: 700 };
  const teamItem = { top: 60, left: 8, width: 232, height: 32 };

  it("sits right of a side-list item with its notch at the item's middle", () => {
    expect(placeCard(teamItem, card, wide, "right")).toEqual({
      side: "right",
      top: 48,
      left: 248,
      notch: 22,
    });
  });

  it("goes below the item when the window has no room on either side", () => {
    expect(placeCard(teamItem, card, { width: 500, height: 700 }, "right")).toEqual({
      side: "below",
      top: 100,
      left: 20,
      notch: 22,
    });
  });

  it("sits below the full-width status bar, pointing near its words", () => {
    const bar = { top: 0, left: 0, width: 1000, height: 36 };
    expect(placeCard(bar, card, wide, "below")).toEqual({
      side: "below",
      top: 44,
      left: 12,
      notch: 22,
    });
  });

  it("sits above the side-list footer, or below it when there is no room above", () => {
    const footer = { top: 620, left: 0, width: 248, height: 72 };
    expect(placeCard(footer, { width: 340, height: 150 }, wide, "above")).toEqual({
      side: "above",
      top: 462,
      left: 12,
      notch: 22,
    });
    const high = { top: 10, left: 0, width: 248, height: 40 };
    expect(placeCard(high, { width: 340, height: 150 }, wide, "above").side).toBe("below");
  });

  it("stays inside a window too small for any side", () => {
    const footer = { top: 120, left: 0, width: 248, height: 72 };
    const placed = placeCard(footer, { width: 340, height: 150 }, { width: 360, height: 200 }, "above");
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.top + 150).toBeLessThanOrEqual(200 - 8);
    expect(placed.left).toBeGreaterThanOrEqual(8);
  });

  it("keeps the notch within the card", () => {
    const low = { top: 680, left: 8, width: 232, height: 20 };
    const placed = placeCard(low, card, wide, "right");
    expect(placed.side).toBe("right");
    expect(placed.notch).toBeLessThanOrEqual(card.height - 24);
    expect(placed.notch).toBeGreaterThanOrEqual(12);
  });
});

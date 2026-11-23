import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GUIDE,
  endTour,
  finishWelcome,
  GUIDE_KEY,
  type Guide,
  loadGuide,
  saveGuide,
  setView,
  showAgain,
} from "./guide";

const SECRET = "SECRET-SAVED-TEXT";

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

function broken() {
  const refused = new DOMException(`Access denied: ${SECRET}`, "SecurityError");
  return {
    getItem: vi.fn((_key: string): string | null => {
      throw refused;
    }),
    setItem: vi.fn((_key: string, _value: string) => {
      throw refused;
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadGuide", () => {
  it("starts with the plain view and the welcome screen when nothing is saved", () => {
    expect(loadGuide(memory())).toEqual({ view: "plain", welcomed: false, tour: null });
    expect(DEFAULT_GUIDE).toEqual({ view: "plain", welcomed: false, tour: null });
    expect(warned()).toBe("");
  });

  it("reads back what was saved", () => {
    const saved: Guide = { view: "technical", welcomed: true, tour: "done" };
    const storage = memory({ [GUIDE_KEY]: JSON.stringify(saved) });

    expect(loadGuide(storage)).toEqual(saved);
    expect(storage.getItem).toHaveBeenCalledWith("agentforge.guide");
  });

  it.each([
    ["text that is not JSON", `${SECRET}{`, "SyntaxError"],
    ["an unknown view", JSON.stringify({ view: SECRET, welcomed: true, tour: null }), "bad shape"],
    ["an unknown tour state", JSON.stringify({ view: "plain", welcomed: true, tour: SECRET }), "bad shape"],
    ["a welcome flag that is not true or false", JSON.stringify({ view: "plain", welcomed: SECRET, tour: null }), "bad shape"],
    ["a value that is not an object", JSON.stringify(SECRET), "bad shape"],
    ["null", "null", "bad shape"],
  ])("falls back to the start for %s, logging why but never the saved text", (_, text, why) => {
    expect(loadGuide(memory({ [GUIDE_KEY]: text }))).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain(`guide: could not read the saved choices: ${why}`);
    expect(logged()).not.toContain(SECRET);
  });

  it("falls back to the start when the storage refuses, logging the error's name only", () => {
    expect(loadGuide(broken())).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain("guide: could not read the saved choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });

  it("falls back to the start when the window has no storage", () => {
    expect(loadGuide(undefined)).toEqual(DEFAULT_GUIDE);
    expect(warned()).toContain("guide: could not read the saved choices: no storage");
  });
});

describe("saveGuide", () => {
  it("writes the choices as JSON under its key", () => {
    const storage = memory();
    const guide: Guide = { view: "technical", welcomed: true, tour: "wanted" };

    saveGuide(storage, guide);

    expect(storage.setItem).toHaveBeenCalledWith("agentforge.guide", JSON.stringify(guide));
    expect(loadGuide(storage)).toEqual(guide);
  });

  it("warns by name and carries on when the storage refuses", () => {
    expect(() => saveGuide(broken(), DEFAULT_GUIDE)).not.toThrow();
    expect(warned()).toContain("guide: could not save the choices: SecurityError");
    expect(logged()).not.toContain(SECRET);
  });

  it("warns and carries on when the window has no storage", () => {
    expect(() => saveGuide(undefined, DEFAULT_GUIDE)).not.toThrow();
    expect(warned()).toContain("guide: could not save the choices: no storage");
  });
});

describe("the guide's steps", () => {
  it("passes the welcome with the chosen view, wanting the tour or skipping it", () => {
    expect(finishWelcome("technical", true)).toEqual({
      view: "technical",
      welcomed: true,
      tour: "wanted",
    });
    expect(finishWelcome("plain", false)).toEqual({ view: "plain", welcomed: true, tour: "skipped" });
    expect(logged()).toContain("guide: welcome passed, view=technical, tour=wanted");
    expect(logged()).toContain("guide: welcome passed, view=plain, tour=skipped");
  });

  it("ends the tour as done when finished and as skipped when stopped early", () => {
    const touring: Guide = { view: "plain", welcomed: true, tour: "wanted" };

    expect(endTour(touring, true)).toEqual({ ...touring, tour: "done" });
    expect(endTour(touring, false)).toEqual({ ...touring, tour: "skipped" });
    expect(logged()).toContain("guide: tour done");
    expect(logged()).toContain("guide: tour skipped");
  });

  it("switches the view and keeps the rest", () => {
    const guide: Guide = { view: "plain", welcomed: true, tour: "done" };

    expect(setView(guide, "technical")).toEqual({ ...guide, view: "technical" });
    expect(logged()).toContain("guide: view=technical");
  });

  it("shows the guide again from the welcome screen, keeping the view", () => {
    const guide: Guide = { view: "technical", welcomed: true, tour: "skipped" };

    expect(showAgain(guide)).toEqual({ view: "technical", welcomed: false, tour: null });
    expect(logged()).toContain("guide: shown again");
  });
});

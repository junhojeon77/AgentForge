// The welcome screen, the view and theme choices, the tour and how a run is shown, saved in this
// window's own storage.
import { log } from "./log";

export type View = "plain" | "technical";
export type Theme = "dark" | "light";
export type RunView = "board" | "list";
/** `tour` is "wanted" from the welcome's Take the tour until the tour ends. */
export type Guide = {
  view: View;
  welcomed: boolean;
  tour: "wanted" | "done" | "skipped" | null;
  theme: Theme;
  runView: RunView;
};
export type GuideStorage = Pick<Storage, "getItem" | "setItem">;

export const GUIDE_KEY = "agentforge.guide";
export const DEFAULT_GUIDE: Guide = {
  view: "plain",
  welcomed: false,
  tour: null,
  theme: "dark",
  runView: "board",
};

const VIEWS: unknown[] = ["plain", "technical"];
const TOURS: unknown[] = ["wanted", "done", "skipped", null];
// undefined: a save from before slice 9, which gets the defaults rather than a new welcome.
const THEMES: unknown[] = ["dark", "light", undefined];
const RUN_VIEWS: unknown[] = ["board", "list", undefined];

function isGuide(value: unknown): value is Partial<Guide> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    VIEWS.includes(v.view) &&
    typeof v.welcomed === "boolean" &&
    TOURS.includes(v.tour) &&
    THEMES.includes(v.theme) &&
    RUN_VIEWS.includes(v.runView)
  );
}

// The saved text and an error's message can quote what was stored, so only the name is logged.
const why = (error: unknown) => (error instanceof Error ? error.name : "unknown error");

// A getter, since merely reading `localStorage` throws when site data is blocked.
type GetStorage = () => GuideStorage | undefined;

/** The saved choices, or the start (plain view, welcome shown) if they cannot be read. */
export function loadGuide(getStorage: GetStorage): Guide {
  try {
    const storage = getStorage();
    if (!storage) {
      log.warn("guide: could not read the saved choices: no storage");
      return DEFAULT_GUIDE;
    }
    const text = storage.getItem(GUIDE_KEY);
    if (text === null) return DEFAULT_GUIDE;
    const saved: unknown = JSON.parse(text);
    if (isGuide(saved)) return { ...DEFAULT_GUIDE, ...saved };
    log.warn("guide: could not read the saved choices: bad shape");
  } catch (error) {
    log.warn(`guide: could not read the saved choices: ${why(error)}`);
  }
  return DEFAULT_GUIDE;
}

export function saveGuide(getStorage: GetStorage, guide: Guide): void {
  try {
    const storage = getStorage();
    if (!storage) {
      log.warn("guide: could not save the choices: no storage");
      return;
    }
    storage.setItem(GUIDE_KEY, JSON.stringify(guide));
  } catch (error) {
    log.warn(`guide: could not save the choices: ${why(error)}`);
  }
}

export function finishWelcome(guide: Guide, takeTour: boolean): Guide {
  const tour = takeTour ? "wanted" : "skipped";
  log.debug(`guide: welcome passed, view=${guide.view}, tour=${tour}`);
  return { ...guide, welcomed: true, tour };
}

export function endTour(guide: Guide, finished: boolean): Guide {
  const tour = finished ? "done" : "skipped";
  log.debug(`guide: tour ${tour}`);
  return { ...guide, tour };
}

export function setView(guide: Guide, view: View): Guide {
  log.debug(`guide: view=${view}`);
  return { ...guide, view };
}

export function setTheme(guide: Guide, theme: Theme): Guide {
  log.debug(`guide: theme=${theme}`);
  return { ...guide, theme };
}

export function setRunView(guide: Guide, runView: RunView): Guide {
  log.debug(`guide: run view=${runView}`);
  return { ...guide, runView };
}

/** Back to the welcome screen, which offers the tour again; the other choices are kept. */
export function showAgain(guide: Guide): Guide {
  log.debug("guide: shown again");
  return { ...guide, welcomed: false, tour: null };
}

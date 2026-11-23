// The welcome screen, the view choice and the tour, saved in this window's own storage.
import { log } from "./log";

export type View = "plain" | "technical";
/** `tour` is "wanted" from the welcome's Take the tour until the tour ends. */
export type Guide = { view: View; welcomed: boolean; tour: "wanted" | "done" | "skipped" | null };
export type GuideStorage = Pick<Storage, "getItem" | "setItem">;

export const GUIDE_KEY = "agentforge.guide";
export const DEFAULT_GUIDE: Guide = { view: "plain", welcomed: false, tour: null };

const VIEWS: unknown[] = ["plain", "technical"];
const TOURS: unknown[] = ["wanted", "done", "skipped", null];

function isGuide(value: unknown): value is Guide {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return VIEWS.includes(v.view) && typeof v.welcomed === "boolean" && TOURS.includes(v.tour);
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
    if (isGuide(saved)) return saved;
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

export function finishWelcome(view: View, takeTour: boolean): Guide {
  const guide: Guide = { view, welcomed: true, tour: takeTour ? "wanted" : "skipped" };
  log.debug(`guide: welcome passed, view=${view}, tour=${guide.tour}`);
  return guide;
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

/** Back to the welcome screen, which offers the tour again; the view is kept. */
export function showAgain(guide: Guide): Guide {
  log.debug("guide: shown again");
  return { view: guide.view, welcomed: false, tour: null };
}

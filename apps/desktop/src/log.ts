// Console lines for debugging the app. Log ids, statuses, paths and reasons only: never the
// token, response bodies, details, diffs or agent output.
const PREFIX = "agentforge.desktop:";

export const log = {
  debug: (message: string) => console.debug(PREFIX, message),
  warn: (message: string) => console.warn(PREFIX, message),
};

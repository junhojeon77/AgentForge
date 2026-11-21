import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import { log } from "../log";

// `serve` writes %APPDATA%\AgentForge\api-token (api.py `default_token_path`). BaseDirectory.Data
// is %APPDATA% itself on Windows; AppData would add this app's own identifier folder.
const TOKEN_FILE = "AgentForge/api-token";

/** The token the running server wrote, or null when there is none to read. */
export async function readToken(): Promise<string | null> {
  try {
    return (await readTextFile(TOKEN_FILE, { baseDir: BaseDirectory.Data })).trim() || null;
  } catch {
    // Usually the server has never started; the plugin's message is not logged, only the path.
    log.debug("token file %APPDATA%\\AgentForge\\api-token could not be read");
    return null;
  }
}

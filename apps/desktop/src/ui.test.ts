import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./ui";

const SECRET = "SECRET-DIFF-LINE";

function logged(): string {
  const calls = [...vi.mocked(console.debug).mock.calls, ...vi.mocked(console.warn).mock.calls];
  return calls.map((args) => args.join(" ")).join("\n");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("copyText", () => {
  it("writes the text to the clipboard and says so", async () => {
    const writeText = vi.fn(async (_text: string) => {});

    await expect(copyText(SECRET, "diff", { writeText })).resolves.toBe("Copied.");
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it("says why a copy failed and logs the error's name, never the text", async () => {
    const refused = new DOMException("Write permission denied.", "NotAllowedError");
    const writeText = vi.fn(async (_text: string) => {
      throw refused;
    });

    await expect(copyText(SECRET, "diff", { writeText })).resolves.toBe(
      "Could not copy: Write permission denied.",
    );
    expect(logged()).toContain("copy diff failed: NotAllowedError");
    expect(logged()).not.toContain(SECRET);
  });

  it("fails in words when there is no clipboard at all", async () => {
    await expect(copyText(SECRET, "run id", undefined)).resolves.toMatch(/^Could not copy: /);
    expect(logged()).toContain("copy run id failed: TypeError");
  });
});

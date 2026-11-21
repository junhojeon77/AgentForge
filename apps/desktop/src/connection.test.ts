import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import { connectionState, logState } from "./connection";

afterEach(() => vi.restoreAllMocks());

describe("connectionState", () => {
  it.each([
    ["pending", null, "connecting"],
    ["success", null, "connected"],
    ["error", new ApiError("no-token"), "no-token"],
    ["error", new ApiError("offline"), "offline"],
    ["error", new ApiError("unauthorized", 401), "unauthorized"],
    ["error", new ApiError("http", 500, "boom"), "failed"],
    ["error", new Error("bad json"), "failed"],
  ] as const)("%s with %o is %s", (status, error, expected) => {
    expect(connectionState(status, error)).toBe(expected);
  });
});

describe("logState", () => {
  it("logs a lost connection as a warning and a connection as progress", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    logState("offline");
    logState("connected");

    expect(warn).toHaveBeenCalledWith("agentforge.desktop:", "connection: offline");
    expect(debug).toHaveBeenCalledWith("agentforge.desktop:", "connection: connected");
  });
});

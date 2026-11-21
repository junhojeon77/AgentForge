import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, type Client } from "./api/client";
import { log } from "./log";

export type ConnectionState =
  | "connecting"
  | "no-token"
  | "offline"
  | "unauthorized"
  | "failed"
  | "connected";

export interface RunList {
  active: string | null;
  unfinished: string[];
  runs: string[];
}

export const POLL_MS = 2000;

export function connectionState(
  status: "pending" | "error" | "success",
  error: unknown,
): ConnectionState {
  if (status === "pending") return "connecting";
  if (status === "success") return "connected";
  if (error instanceof ApiError && error.kind !== "http") return error.kind;
  return "failed";
}

export function logState(state: ConnectionState): void {
  const message = `connection: ${state}`;
  if (state === "connected" || state === "connecting") log.debug(message);
  else log.warn(message);
}

/** Polls `GET /runs`: it shows whether the server answers and which run is active. */
export function useConnection(client: Client) {
  const query = useQuery({
    queryKey: ["runs"],
    queryFn: () => client.request<RunList>("/runs"),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const state = connectionState(query.status, query.error);
  useEffect(() => logState(state), [state]);
  const error = query.error instanceof ApiError ? query.error : undefined;
  return { state, error, runs: query.data, refetch: query.refetch };
}

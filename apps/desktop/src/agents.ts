import { type Client, jsonBody } from "./api/client";

export const REASONING = ["low", "medium", "high", "xhigh", "max"] as const;

/** The server's AgentConfig (domain.py). */
export interface Agent {
  id: string;
  role: string;
  model: string | null; // null: the default model
  reasoning: (typeof REASONING)[number];
  persona: string;
}

export const PERSONA_LIMIT = 10_000;

/** A name as a person types it, made into an agent id: the server allows only a-z 0-9 - _. */
export function toId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function agentPath(id: string): string {
  return `/agents/${encodeURIComponent(id)}`;
}

type Sender = Pick<Client, "send">;

export async function saveAgent(client: Sender, agent: Agent): Promise<void> {
  await client.send(agentPath(agent.id), jsonBody(agent, "PUT"));
}

export async function removeAgent(client: Sender, id: string): Promise<void> {
  await client.send(agentPath(id), { method: "DELETE" });
}

export interface Observations {
  questions: string[];
  toolContexts: string[];
  commands: { name: string; args: unknown }[];
  responses: { text: string; status: string }[];
  sent: { room: string; text: string }[];
  result?: unknown;
  pendingBeforeAck?: boolean;
  pendingAfterAck?: boolean;
}
export const observed: Observations = {
  questions: [],
  toolContexts: [],
  commands: [],
  responses: [],
  sent: [],
};

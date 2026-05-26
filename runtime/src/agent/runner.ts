export type AgentRunInput = {
  sessionKey: string;
  inboundId: number;
  text: string;
  metadata: Record<string, unknown>;
  cwd?: string;
};

export type AgentRunner = {
  run(input: AgentRunInput): Promise<string>;
};

export class EchoAgentRunner implements AgentRunner {
  run(input: AgentRunInput): Promise<string> {
    return Promise.resolve(`stub agent received in ${input.sessionKey}: ${input.text}`);
  }
}

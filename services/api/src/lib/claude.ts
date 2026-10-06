import Anthropic from '@anthropic-ai/sdk';

// Client Claude condiviso. Chiavi e modelli solo da variabili d'ambiente.

export const claudeModels = {
  /** spiegazioni del coach */
  coach: process.env.CLAUDE_MODEL_COACH ?? 'claude-opus-5-5',
  /** compiti semplici e voluminosi: tagging della knowledge base, note di profilo */
  cheap: process.env.CLAUDE_MODEL_CHEAP ?? 'claude-haiku-4-5',
};

/** Effort del coach (Claude Opus 5.5 ha default "medium": lo si fissa esplicitamente). */
export const coachEffort = (process.env.CLAUDE_COACH_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;

export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Il modello supporta `output_config.effort` e i fallback lato server? (Haiku 4.5 no) */
export function isFrontierModel(model: string): boolean {
  return /claude-(opus-5|sonnet-5|fable-5)/.test(model);
}

import type { SessionEntry } from '@earendil-works/pi-coding-agent';

const PROVIDER = 'openai-codex';
const CREDITS_PER_MILLION_TOKENS = 1_000_000;
const SERVICE_TIER_DIAGNOSTIC = 'codex-service-tier';

type ServiceTier = 'default' | 'priority';

interface RateCard {
  input: number;
  cachedInput: number;
  output: number;
}

interface UsageLike {
  input?: unknown;
  cacheRead?: unknown;
  output?: unknown;
}

interface DiagnosticLike {
  type?: unknown;
  details?: unknown;
}

interface AssistantMessageLike {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  usage?: UsageLike;
  diagnostics?: DiagnosticLike[];
}

export interface SessionModelCreditUsage {
  model: string;
  inputCredits: number;
  cachedInputCredits: number;
  outputCredits: number;
  credits: number;
  responses: number;
  priorityResponses: number;
  priced: boolean;
}

export interface SessionCreditUsage {
  totalCredits: number;
  responseCount: number;
  unsupportedResponseCount: number;
  models: SessionModelCreditUsage[];
}

const RATE_CARDS: Readonly<Record<string, RateCard>> = {
  'gpt-5.6-sol': { input: 125, cachedInput: 12.5, output: 750 },
  'gpt-5.6-terra': { input: 50, cachedInput: 5, output: 300 },
  'gpt-5.6-luna': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.5': { input: 125, cachedInput: 12.5, output: 750 },
  'gpt-5.5-cyber': { input: 312.5, cachedInput: 31.25, output: 1875 },
  'gpt-5.4': { input: 62.5, cachedInput: 6.25, output: 375 },
  'gpt-5.4-mini': { input: 18.75, cachedInput: 1.875, output: 113 },
  'gpt-5.3-codex': { input: 43.75, cachedInput: 4.375, output: 350 },
  'gpt-5.2': { input: 43.75, cachedInput: 4.375, output: 350 },
};

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function getDiagnosticServiceTier(
  diagnostics: DiagnosticLike[] | undefined
): ServiceTier {
  if (!diagnostics) return 'default';

  for (const diagnostic of [...diagnostics].reverse()) {
    if (diagnostic.type !== SERVICE_TIER_DIAGNOSTIC) continue;
    if (!diagnostic.details || typeof diagnostic.details !== 'object') {
      continue;
    }

    const details = diagnostic.details as {
      serviceTier?: unknown;
      source?: unknown;
    };
    if (details.source !== undefined && details.source !== 'requested') {
      continue;
    }
    if (details.serviceTier === 'priority') return 'priority';
    if (details.serviceTier === 'default') return 'default';
  }

  return 'default';
}

function priorityMultiplier(model: string): number {
  if (/^gpt-5\.6(?:-|$)/.test(model)) return 2.5;
  if (/^gpt-5\.5(?:-|$)/.test(model)) return 2.5;
  if (/^gpt-5\.4(?:-|$)/.test(model)) return 2;
  return 1;
}

function estimateResponseCredits(
  model: string,
  usage: UsageLike,
  serviceTier: ServiceTier
): Pick<
  SessionModelCreditUsage,
  'inputCredits' | 'cachedInputCredits' | 'outputCredits' | 'credits'
> {
  const rateCard = RATE_CARDS[model];
  if (!rateCard) {
    return {
      inputCredits: 0,
      cachedInputCredits: 0,
      outputCredits: 0,
      credits: 0,
    };
  }

  const multiplier = serviceTier === 'priority' ? priorityMultiplier(model) : 1;
  const inputCredits =
    (finiteNonNegative(usage.input) * rateCard.input * multiplier) /
    CREDITS_PER_MILLION_TOKENS;
  const cachedInputCredits =
    (finiteNonNegative(usage.cacheRead) * rateCard.cachedInput * multiplier) /
    CREDITS_PER_MILLION_TOKENS;
  const outputCredits =
    (finiteNonNegative(usage.output) * rateCard.output * multiplier) /
    CREDITS_PER_MILLION_TOKENS;

  return {
    inputCredits,
    cachedInputCredits,
    outputCredits,
    credits: inputCredits + cachedInputCredits + outputCredits,
  };
}

export function estimateSessionCredits(
  entries: readonly SessionEntry[]
): SessionCreditUsage {
  const models = new Map<string, SessionModelCreditUsage>();
  let responseCount = 0;
  let unsupportedResponseCount = 0;

  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = entry.message as AssistantMessageLike;
    if (message.role !== 'assistant' || message.provider !== PROVIDER) {
      continue;
    }

    responseCount += 1;
    if (typeof message.model !== 'string') {
      unsupportedResponseCount += 1;
      continue;
    }

    const rateCard = RATE_CARDS[message.model];
    const serviceTier = getDiagnosticServiceTier(message.diagnostics);
    const credits = estimateResponseCredits(
      message.model,
      message.usage ?? {},
      serviceTier
    );
    const current = models.get(message.model) ?? {
      model: message.model,
      inputCredits: 0,
      cachedInputCredits: 0,
      outputCredits: 0,
      credits: 0,
      responses: 0,
      priorityResponses: 0,
      priced: rateCard !== undefined,
    };
    current.inputCredits += credits.inputCredits;
    current.cachedInputCredits += credits.cachedInputCredits;
    current.outputCredits += credits.outputCredits;
    current.credits += credits.credits;
    current.responses += 1;
    if (serviceTier === 'priority') current.priorityResponses += 1;
    if (!rateCard) unsupportedResponseCount += 1;
    models.set(message.model, current);
  }

  return {
    totalCredits: [...models.values()].reduce(
      (total, model) => total + model.credits,
      0
    ),
    responseCount,
    unsupportedResponseCount,
    models: [...models.values()].sort(
      (a, b) => b.credits - a.credits || a.model.localeCompare(b.model)
    ),
  };
}

export function formatSessionCreditSummary(
  usage: SessionCreditUsage,
  formatCredits: (value: number) => string
): string {
  const topModel = usage.models.find((model) => model.priced);
  const top = topModel
    ? ` · top ${topModel.model} ${formatCredits(topModel.credits)}`
    : '';
  const unsupported =
    usage.unsupportedResponseCount > 0
      ? ` · ${usage.unsupportedResponseCount} unpriced`
      : '';
  const responseLabel = `${usage.responseCount} response${usage.responseCount === 1 ? '' : 's'}`;
  return (
    `Session: ${formatCredits(usage.totalCredits)} credits est. · ${responseLabel}` +
    top +
    unsupported
  );
}

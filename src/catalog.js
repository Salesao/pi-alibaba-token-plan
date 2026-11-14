// Model metadata. The plan's own /models answer carries ids only, so limits and
// thinking settings come from the pi.dev catalogs of the Qwen Token Plan
// providers, then from a small verified table for models those catalogs lag on.
// Catalog entries describe a different domain: their baseUrl is never used.

export const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Verified differences of this endpoint; catalogs add thinking format per model.
export const BASE_COMPAT = {
	supportsDeveloperRole: false,
	supportsStore: false,
	maxTokensField: "max_completion_tokens",
};

// Personal catalogs first: the Team catalog is a superset that covers lags.
export const CATALOG_URLS = [
	"https://pi.dev/api/models/providers/qwen-token-plan-individual?types=chat",
	"https://pi.dev/api/models/providers/qwen-token-plan?types=chat",
	"https://pi.dev/api/models/providers/qwen-token-plan-individual-cn?types=chat",
	"https://pi.dev/api/models/providers/qwen-token-plan-cn?types=chat",
];

const REQUEST_TIMEOUT_MS = 6000;

// /models also lists image, video and audio models, which cannot be used for chat.
const CHAT_FAMILY_ID = /^(qwen|glm|deepseek|kimi|minimax)/i;
const NON_CHAT_ID = /(^wan|image|audio|tts|asr|realtime|video|embed|rerank|ocr)/i;

// Models the plan serves but the catalogs do not describe yet. Specs come from
// https://docs.modelstudio.console.alibabacloud.com/en/model-studio/<model-id>.
export const VERIFIED_OVERRIDES = {
	// Preview until 2026-11-25. Alias: qwen4.0-max-preview. Thinking on by default (xhigh).
	"qwen4-max-preview": {
		name: "Qwen4 Max Preview",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_000_000,
		// Shared budget for thinking and the final answer.
		maxTokens: 393_216,
		thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null },
		compat: { thinkingFormat: "qwen", supportsReasoningEffort: true, supportsStrictMode: true },
	},
};

export function isChatCandidate(id) {
	return id === "auto" || (CHAT_FAMILY_ID.test(id) && !NON_CHAT_ID.test(id));
}

export function toModelConfig(raw) {
	if (!raw || typeof raw.id !== "string" || typeof raw.contextWindow !== "number" || typeof raw.maxTokens !== "number") {
		return undefined;
	}
	const input = Array.isArray(raw.input) ? raw.input.filter((kind) => kind === "text" || kind === "image") : ["text"];
	const model = {
		id: raw.id,
		name: typeof raw.name === "string" ? raw.name : raw.id,
		reasoning: raw.reasoning === true,
		input: input.length > 0 ? input : ["text"],
		cost: ZERO_COST, // subscription credits, not per-token prices
		contextWindow: raw.contextWindow,
		maxTokens: raw.maxTokens,
		compat: { ...BASE_COMPAT, ...raw.compat },
	};
	if (raw.thinkingLevelMap) model.thinkingLevelMap = raw.thinkingLevelMap;
	if (raw.inputLimits) model.inputLimits = raw.inputLimits;
	return model;
}

export function verifiedOverride(id) {
	const patch = VERIFIED_OVERRIDES[id];
	if (!patch) return undefined;
	return toModelConfig({
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		contextWindow: 131072,
		maxTokens: 16384,
		...patch,
		compat: { ...BASE_COMPAT, ...patch.compat },
	});
}

/** Conservative entry for a model that is live but not described anywhere yet. */
export function unverifiedModel(id) {
	return toModelConfig({
		id,
		name: id === "auto" ? "Auto (plan router)" : `${id} (unverified)`,
		reasoning: false,
		input: ["text"],
		contextWindow: 131072,
		maxTokens: 16384,
	});
}

/** Catalog metadata by model id. Never throws: an outage falls back to what we already know. */
export async function fetchCatalogModels({ signal, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
	const catalogModels = new Map();
	const responses = await Promise.all(
		CATALOG_URLS.map(async (url) => {
			try {
				const response = await fetchImpl(url, {
					headers: { accept: "application/json" },
					signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
				});
				if (!response.ok) return [];
				const body = await response.json();
				return Array.isArray(body) ? body : Array.isArray(body?.models) ? body.models : Object.values(body ?? {});
			} catch {
				return [];
			}
		}),
	);
	for (const entries of responses) {
		for (const raw of entries) {
			if (!raw || (raw.type !== undefined && raw.type !== "chat")) continue;
			const model = toModelConfig(raw);
			if (model && !catalogModels.has(model.id)) catalogModels.set(model.id, model);
		}
	}
	return catalogModels;
}

export function buildModels({ liveIds, catalogModels, previousModels, baseUrl, providerId }) {
	const previousById = new Map((previousModels ?? []).map((model) => [model.id, model]));
	const models = [];
	for (const id of new Set(liveIds)) {
		const known = catalogModels.get(id) ?? verifiedOverride(id) ?? previousById.get(id);
		const model = known ?? (isChatCandidate(id) ? unverifiedModel(id) : undefined);
		if (!model) continue;
		models.push({
			...toModelConfig(model),
			type: "chat",
			api: "openai-completions",
			provider: providerId,
			baseUrl,
		});
	}
	return models.sort((left, right) => left.id.localeCompare(right.id));
}
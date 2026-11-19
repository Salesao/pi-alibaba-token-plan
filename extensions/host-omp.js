/**
 * Alibaba Model Studio Token Plan provider for OMP.
 *
 * OMP uses a different extension contract than Pi: providers register as
 * `registerProvider(id, config)` with string API ids, `oauth` for /login and
 * `fetchDynamicModels` for the live catalog. The wire API, endpoints and model
 * table are shared with the Pi host (src/).
 *
 * Region: keys are region-specific. Login stores the region in the OAuth
 * credential; discovery has no credential context, so it uses the region env
 * var when set and otherwise probes both endpoints with the key.
 */
import { API_KEY_ENV } from "../src/auth.js";
import { buildModels, fetchCatalogModels, toOmpModelConfig } from "../src/catalog.js";
import { fetchLiveIds } from "../src/models.js";
import { DEFAULT_REGION, REGIONS, REGION_ENV, baseUrlFor, resolveRegion } from "../src/regions.js";

const PROVIDER_ID = "alibaba-openai";
const REQUEST_TIMEOUT_MS = 6000;
const DISCOVERY_TIMEOUT_MS = 14000;

function regionFromEnv() {
	const raw = process.env[REGION_ENV];
	return typeof raw === "string" && Object.hasOwn(REGIONS, raw) ? raw : undefined;
}

async function selectRegion(callbacks) {
	const options = Object.entries(REGIONS).map(([id, { label }]) => ({ id, label }));
	if (typeof callbacks.onSelect === "function") {
		return resolveRegion(await callbacks.onSelect({ message: "Where was the Token Plan purchased?", options }));
	}
	const menu = options.map((option, index) => `${index + 1}) ${option.label}`).join("\n");
	const answer = String(
		await callbacks.onPrompt({
			message: `Where was the Token Plan purchased?\n${menu}\nEnter 1 or 2 [1]:`,
		}),
	)
		.trim()
		.toLowerCase();
	if (answer === "" || /^(1|sg|singapore|international)/.test(answer)) return "sg";
	if (/^(2|cn|china|beijing)/.test(answer)) return "cn";
	throw new Error(`Unknown region "${answer}". Pick 1 for Singapore or 2 for China.`);
}

function validateKey({ baseUrl, apiKey, signal, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
	return fetchImpl(`${baseUrl}/models`, {
		headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
		signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)),
	});
}

/** Login stores the region with the key; OMP hands the credential object back to getApiKey/modifyModels. */
async function login(callbacks, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
	const region = await selectRegion(callbacks);
	const key = String(await callbacks.onPrompt({ message: "Enter the Token Plan API key", secret: true })).trim();
	if (!key) throw new Error("API key is empty");

	const response = await validateKey({
		baseUrl: baseUrlFor(region),
		apiKey: key,
		signal: callbacks.signal,
		fetchImpl: callbacks.fetch ?? fetchImpl,
		timeoutMs,
	});
	if (response.status === 401) {
		throw new Error(
			"This key belongs to a different region. Pick the region where the Token Plan was purchased.",
		);
	}
	if (!response.ok) throw new Error(`Token Plan key check failed with HTTP ${response.status}`);

	return {
		refresh: key,
		access: key,
		expires: Number.MAX_SAFE_INTEGER,
		alibabaRegion: region,
	};
}

async function discover({ apiKey, fetchImpl = fetch, signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) }) {
	if (!apiKey) return [];

	const candidates = regionFromEnv() ? [regionFromEnv()] : [DEFAULT_REGION, ...Object.keys(REGIONS).filter((id) => id !== DEFAULT_REGION)];
	let region;
	let liveIds;
	let lastError;
	for (const candidate of candidates) {
		try {
			liveIds = await fetchLiveIds({ baseUrl: baseUrlFor(candidate), apiKey, signal, fetchImpl });
			region = candidate;
			break;
		} catch (error) {
			lastError = error;
		}
	}
	if (!region) throw lastError;

	const catalogModels = await fetchCatalogModels({ signal, fetchImpl });
	return buildModels({
		liveIds,
		catalogModels,
		previousModels: [],
		baseUrl: baseUrlFor(region),
		providerId: PROVIDER_ID,
	}).map(toOmpModelConfig);
}

export default function registerOmp(pi, { fetchImpl = fetch } = {}) {
	const config = {
		baseUrl: baseUrlFor(resolveRegion(regionFromEnv())),
		api: "openai-completions",
		models: [],
		oauth: {
			name: "Alibaba Token Plan",
			login: (callbacks) => login(callbacks, { fetchImpl }),
			refreshToken: async (credentials) => credentials,
			getApiKey: (credentials) => credentials.access,
			modifyModels: (models, credentials) => {
				const baseUrl = baseUrlFor(credentials?.alibabaRegion);
				return models.map((model) => (model.provider === PROVIDER_ID ? { ...model, baseUrl } : model));
			},
		},
		fetchDynamicModels: (apiKey) => discover({ apiKey, fetchImpl }),
	};
	// OMP resolves a configured apiKey by env-var name, then sends the literal
	// name when the env var is unset. Only hand it a real secret; otherwise the
	// stored /login credential is the key source.
	const envKey = process.env[API_KEY_ENV];
	if (envKey) config.apiKey = envKey;
	pi.registerProvider(PROVIDER_ID, config);
}

export { PROVIDER_ID };
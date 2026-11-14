/**
 * Alibaba Model Studio Token Plan provider for Pi.
 *
 * The plan's /models answer carries ids only, so limits and thinking settings
 * come from the pi.dev catalogs plus a verified table (see src/catalog.js).
 * Pi owns catalog persistence: createProvider restores context.stored and
 * publishes what fetchModels returns, so this package writes no cache of its own.
 *
 * Login: /login alibaba-openai → region → key. Keys are region-specific.
 */
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { homedir } from "node:os";
import { join } from "node:path";
import { API_KEY_ENV, createApiKeyAuth } from "../src/auth.js";
import { REFRESH_INTERVAL_MS, isFresh, loadModels, readLegacyCache } from "../src/models.js";
import { DEFAULT_REGION, REGION_ENV, baseUrlFor, resolveRegion } from "../src/regions.js";

const PROVIDER_ID = "alibaba-openai";

export default function register(pi, { fetchImpl = fetch, agentDir = join(homedir(), ".pi", "agent") } = {}) {
	async function fetchModels(context) {
		const region = resolveRegion(context.credential?.env?.[REGION_ENV] ?? process.env[REGION_ENV]);
		const apiKey = context.credential?.key ?? process.env[API_KEY_ENV];
		if (!apiKey) throw new Error(`No Token Plan API key. Run /login ${PROVIDER_ID}`);
		return loadModels({
			baseUrl: baseUrlFor(region),
			apiKey,
			providerId: PROVIDER_ID,
			signal: context.signal,
			fetchImpl,
			previousModels: context.stored?.models,
			legacyModels: readLegacyCache({ agentDir }),
		});
	}

	const provider = createProvider({
		id: PROVIDER_ID,
		name: "Alibaba Token Plan",
		baseUrl: baseUrlFor(DEFAULT_REGION),
		auth: { apiKey: createApiKeyAuth({ fetchImpl }) },
		models: [],
		fetchModels,
		api: openAICompletionsApi(),
	});

	// Freshness policy: within the interval, ask pi for a restore-only pass so a
	// startup does not refetch. `force` (pi update --models) always goes to the network.
	const refresh = provider.refreshModels;
	provider.refreshModels = (context) =>
		refresh(isFresh(context.stored) && !context.force ? { ...context, allowNetwork: false } : context);

	pi.registerProvider(provider);
}

export { PROVIDER_ID, REFRESH_INTERVAL_MS };
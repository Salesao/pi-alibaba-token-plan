import { REGIONS, REGION_ENV, baseUrlFor, resolveRegion } from "./regions.js";

export const API_KEY_ENV = "ALIBABA_API_KEY";

const REQUEST_TIMEOUT_MS = 6000;

/**
 * Api-key auth for the Token Plan. The plan sells region-specific keys, so the
 * region is chosen at login and stored with the credential; request auth then
 * carries the matching baseUrl.
 */
export function createApiKeyAuth({ fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
	async function readKeyAndRegion({ ctx, credential }) {
		const storedKey = credential?.type === "api_key" ? credential.key : undefined;
		const key = storedKey ?? (await ctx.env(API_KEY_ENV));
		if (!key) return undefined;
		const region = resolveRegion(credential?.env?.[REGION_ENV] ?? (await ctx.env(REGION_ENV)));
		return { key, region, source: storedKey ? "stored credential" : API_KEY_ENV };
	}

	return {
		name: "Alibaba Token Plan API key",

		async login(interaction) {
			const region = resolveRegion(
				await interaction.prompt({
					type: "select",
					message: "Where was the Token Plan purchased?",
					options: Object.entries(REGIONS).map(([id, { label }]) => ({ id, label })),
				}),
			);
			const key = (
				await interaction.prompt({ type: "secret", message: "Enter the Token Plan API key" })
			).trim();
			if (!key) throw new Error("API key is empty");

			const response = await fetchImpl(`${baseUrlFor(region)}/models`, {
				headers: { authorization: `Bearer ${key}`, accept: "application/json" },
				signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(timeoutMs)]),
			});
			if (response.status === 401) {
				throw new Error(
					"This key belongs to a different region. Pick the region where the Token Plan was purchased.",
				);
			}
			if (!response.ok) throw new Error(`Token Plan key check failed with HTTP ${response.status}`);

			return { type: "api_key", key, env: { [REGION_ENV]: region } };
		},

		async check(input) {
			const resolved = await readKeyAndRegion(input);
			return resolved ? { type: "api_key", source: resolved.source } : undefined;
		},

		async resolve(input) {
			const resolved = await readKeyAndRegion(input);
			if (!resolved) return undefined;
			return {
				auth: { apiKey: resolved.key, baseUrl: baseUrlFor(resolved.region) },
				// The SDK rebuilds the discovery credential from key + env only, so the
				// region has to travel here as well or catalog refresh loses it.
				env: { [REGION_ENV]: resolved.region },
				source: resolved.source,
			};
		},
	};
}
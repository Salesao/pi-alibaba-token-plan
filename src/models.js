import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildModels, fetchCatalogModels, toModelConfig } from "./catalog.js";

export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 6000;

/** The plan's own catalog: ids only, no limits. An empty answer must not wipe what we know. */
export async function fetchLiveIds({ baseUrl, apiKey, signal, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
	const response = await fetchImpl(`${baseUrl}/models`, {
		headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
		signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
	});
	if (!response.ok) throw new Error(`Token Plan GET /models failed with HTTP ${response.status}`);
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error("Token Plan GET /models returned an unexpected response (not JSON)");
	}
	const ids = Array.isArray(body?.data)
		? body.data.map((entry) => entry?.id).filter((id) => typeof id === "string")
		: [];
	if (ids.length === 0) throw new Error("Token Plan GET /models returned no models");
	return ids;
}

export function isFresh(stored, now = Date.now()) {
	return typeof stored?.checkedAt === "number" && now - stored.checkedAt < REFRESH_INTERVAL_MS;
}

/** One-time migration: the snapshot the hand-installed extension kept inside its own folder. */
export function readLegacyCache({ agentDir }) {
	try {
		const parsed = JSON.parse(
			readFileSync(join(agentDir, "extensions", "alibaba-token-plan", "models-cache.json"), "utf8"),
		);
		if (!Array.isArray(parsed?.models)) return undefined;
		const models = parsed.models.map(toModelConfig).filter(Boolean);
		return models.length > 0 ? models : undefined;
	} catch {
		return undefined;
	}
}

export async function loadModels({
	baseUrl,
	apiKey,
	providerId,
	signal,
	fetchImpl = fetch,
	previousModels,
	legacyModels,
}) {
	const liveIds = await fetchLiveIds({ baseUrl, apiKey, signal, fetchImpl });
	const catalogModels = await fetchCatalogModels({ signal, fetchImpl });
	return buildModels({
		liveIds,
		catalogModels,
		previousModels: previousModels?.length ? previousModels : (legacyModels ?? []),
		baseUrl,
		providerId,
	});
}
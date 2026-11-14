import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REFRESH_INTERVAL_MS, fetchLiveIds, isFresh, loadModels, readLegacyCache } from "../src/models.js";

const SG_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const PROVIDER = "alibaba-openai";
const signal = new AbortController().signal;

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const deadCatalogs = async () => {
	throw new Error("catalog down");
};

function legacyDir(contents) {
	const dir = mkdtempSync(join(tmpdir(), "alp-legacy-"));
	if (contents !== undefined) {
		mkdirSync(join(dir, "extensions", "alibaba-token-plan"), { recursive: true });
		writeFileSync(join(dir, "extensions", "alibaba-token-plan", "models-cache.json"), contents);
	}
	return dir;
}

test("fetchLiveIds returns the ids the plan serves", async () => {
	const fetchImpl = async () => jsonResponse({ data: [{ id: "qwen4-max-preview" }, { id: "glm-5.3" }] });

	assert.deepEqual(await fetchLiveIds({ baseUrl: SG_URL, apiKey: "k", signal, fetchImpl }), [
		"qwen4-max-preview",
		"glm-5.3",
	]);
});

test("fetchLiveIds refuses an empty list so the known catalog survives", async () => {
	const fetchImpl = async () => jsonResponse({ data: [] });

	await assert.rejects(() => fetchLiveIds({ baseUrl: SG_URL, apiKey: "k", signal, fetchImpl }), /no models/i);
});

test("fetchLiveIds reports the HTTP status", async () => {
	const fetchImpl = async () => ({ ok: false, status: 401 });

	await assert.rejects(() => fetchLiveIds({ baseUrl: SG_URL, apiKey: "k", signal, fetchImpl }), /401/);
});

test("fetchLiveIds reports an HTML error page as an unexpected response", async () => {
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		headers: { get: () => "text/html" },
		json: async () => {
			throw new SyntaxError("Unexpected token '<'");
		},
	});

	await assert.rejects(
		() => fetchLiveIds({ baseUrl: SG_URL, apiKey: "k", signal, fetchImpl }),
		/unexpected response/i,
	);
});

test("isFresh honors the refresh interval", () => {
	const now = 1_800_000_000_000;
	assert.equal(REFRESH_INTERVAL_MS, 900000);
	assert.equal(isFresh({ checkedAt: now - 1000 }, now), true);
	assert.equal(isFresh({ checkedAt: now - REFRESH_INTERVAL_MS - 1 }, now), false);
	assert.equal(isFresh(undefined, now), false);
	assert.equal(isFresh({}, now), false);
});

test("loadModels enriches live ids even when every catalog is down", async () => {
	const fetchImpl = async (url) => {
		if (String(url).endsWith("/models")) {
			return jsonResponse({ data: [{ id: "qwen4-max-preview" }, { id: "qwen-image-3.0-pro" }] });
		}
		return deadCatalogs();
	};

	const models = await loadModels({
		baseUrl: SG_URL,
		apiKey: "k",
		providerId: PROVIDER,
		signal,
		fetchImpl,
	});

	assert.equal(models.length, 1);
	assert.equal(models[0].id, "qwen4-max-preview");
	assert.equal(models[0].contextWindow, 1000000);
	assert.equal(models[0].maxTokens, 393216);
	assert.equal(models[0].baseUrl, SG_URL);
});

test("loadModels propagates a failed live fetch instead of returning nothing", async () => {
	const fetchImpl = async () => ({ ok: false, status: 503 });

	await assert.rejects(() =>
		loadModels({ baseUrl: SG_URL, apiKey: "k", providerId: PROVIDER, signal, fetchImpl }),
	);
});

test("loadModels falls back to the legacy snapshot for models the catalogs lack", async () => {
	const fetchImpl = async (url) =>
		String(url).endsWith("/models") ? jsonResponse({ data: [{ id: "qwen9-chat" }] }) : deadCatalogs();

	const models = await loadModels({
		baseUrl: SG_URL,
		apiKey: "k",
		providerId: PROVIDER,
		signal,
		fetchImpl,
		legacyModels: [{ id: "qwen9-chat", name: "Qwen9", reasoning: true, input: ["text"], contextWindow: 500000, maxTokens: 8192 }],
	});

	assert.equal(models[0].contextWindow, 500000);
});

test("readLegacyCache reads the previous extension snapshot", () => {
	const dir = legacyDir(
		JSON.stringify({
			checkedAt: 1,
			models: [
				{ id: "qwen9-chat", name: "Qwen9", reasoning: true, input: ["text"], contextWindow: 500000, maxTokens: 8192 },
				{ id: "broken", name: "Broken" },
			],
		}),
	);

	const models = readLegacyCache({ agentDir: dir });

	assert.deepEqual(
		models.map((m) => m.id),
		["qwen9-chat"],
	);
});

test("readLegacyCache tolerates a missing or broken snapshot", () => {
	assert.equal(readLegacyCache({ agentDir: legacyDir() }), undefined);
	assert.equal(readLegacyCache({ agentDir: legacyDir("{ not json") }), undefined);
});
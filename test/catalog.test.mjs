import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BASE_COMPAT,
	CATALOG_URLS,
	ZERO_COST,
	buildModels,
	fetchCatalogModels,
	isChatCandidate,
	toModelConfig,
} from "../src/catalog.js";

const SG_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const FOREIGN_URL = "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1";
const PROVIDER = "alibaba-openai";
const signal = new AbortController().signal;

const build = (overrides = {}) =>
	buildModels({
		liveIds: [],
		catalogModels: new Map(),
		previousModels: [],
		baseUrl: SG_URL,
		providerId: PROVIDER,
		...overrides,
	});

const catalogEntry = (id, fields = {}) => ({
	id,
	name: `Catalog ${id}`,
	reasoning: true,
	input: ["text"],
	contextWindow: 200000,
	maxTokens: 8192,
	...fields,
});

test("isChatCandidate accepts chat families and the plan router", () => {
	for (const id of ["qwen4-max-preview", "glm-5.3", "deepseek-v4-pro", "kimi-k2.6", "MiniMax-M2.5", "auto"]) {
		assert.equal(isChatCandidate(id), true, id);
	}
});

test("isChatCandidate rejects image, audio, video and embedding models", () => {
	for (const id of ["qwen-image-3.0-pro", "qwen-audio-3.0-tts-plus", "wan2.7-image-pro", "text-embedding-v4"]) {
		assert.equal(isChatCandidate(id), false, id);
	}
});

test("buildModels applies the verified qwen4 preview limits when no catalog knows it", () => {
	const [model] = build({ liveIds: ["qwen4-max-preview"] });

	assert.equal(model.name, "Qwen4 Max Preview");
	assert.equal(model.contextWindow, 1000000);
	assert.equal(model.maxTokens, 393216);
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.deepEqual(model.thinkingLevelMap, {
		off: null,
		minimal: null,
		low: "low",
		medium: "medium",
		high: null,
		xhigh: "xhigh",
		max: null,
	});
	assert.equal(model.compat.thinkingFormat, "qwen");
	assert.equal(model.compat.supportsReasoningEffort, true);
	assert.equal(model.compat.supportsStrictMode, true);
});

test("buildModels applies the verified qwen4 max limits when no catalog knows it", () => {
	const [model] = build({ liveIds: ["qwen4-max"] });

	assert.equal(model.name, "Qwen4 Max");
	assert.equal(model.contextWindow, 1000000);
	assert.equal(model.maxTokens, 262144);
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.deepEqual(model.thinkingLevelMap, {
		off: null,
		minimal: null,
		low: "low",
		medium: null,
		high: "high",
		xhigh: "xhigh",
		max: null,
	});
	assert.equal(model.compat.thinkingFormat, "qwen");
	assert.equal(model.compat.supportsReasoningEffort, true);
	assert.equal(model.compat.supportsStrictMode, true);
});

test("buildModels stamps provider, api, type and the region endpoint on every model", () => {
	const models = build({
		liveIds: ["qwen4-max-preview", "glm-5.3"],
		catalogModels: new Map([["glm-5.3", catalogEntry("glm-5.3", { baseUrl: FOREIGN_URL })]]),
	});

	for (const model of models) {
		assert.equal(model.provider, PROVIDER);
		assert.equal(model.api, "openai-completions");
		assert.equal(model.type, "chat");
		assert.equal(model.baseUrl, SG_URL);
	}
});

test("a catalog entry wins over the verified override", () => {
	const [model] = build({
		liveIds: ["qwen4-max-preview"],
		catalogModels: new Map([["qwen4-max-preview", catalogEntry("qwen4-max-preview", { maxTokens: 111 })]]),
	});

	assert.equal(model.maxTokens, 111);
});

test("the previous snapshot wins over the conservative fallback", () => {
	const [model] = build({
		liveIds: ["qwen9-chat"],
		previousModels: [catalogEntry("qwen9-chat", { contextWindow: 500000 })],
	});

	assert.equal(model.contextWindow, 500000);
});

test("an unknown chat model gets the conservative fallback", () => {
	const [model] = build({ liveIds: ["qwen9-chat"] });

	assert.equal(model.contextWindow, 131072);
	assert.equal(model.maxTokens, 16384);
	assert.equal(model.reasoning, false);
	assert.match(model.name, /unverified/);
});

test("buildModels drops non-chat ids, sorts by id and collapses duplicates", () => {
	const models = build({ liveIds: ["qwen9-chat", "qwen-image-3.0-pro", "glm-5.3", "qwen9-chat"] });

	assert.deepEqual(
		models.map((m) => m.id),
		["glm-5.3", "qwen9-chat"],
	);
});

test("every model keeps the endpoint compatibility flags and zero subscription cost", () => {
	const models = build({ liveIds: ["qwen4-max-preview", "qwen9-chat"] });

	for (const model of models) {
		for (const [key, value] of Object.entries(BASE_COMPAT)) {
			assert.equal(model.compat[key], value, key);
		}
		assert.deepEqual(model.cost, ZERO_COST);
	}
	assert.deepEqual(ZERO_COST, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("toModelConfig rejects entries without the limits it must carry", () => {
	assert.equal(toModelConfig({ id: "x", name: "X" }), undefined);
	assert.equal(toModelConfig(catalogEntry("x")).id, "x");
});

test("fetchCatalogModels keeps the catalogs that answered and ignores the rest", async () => {
	const fetchImpl = async (url) => {
		if (String(url).includes("individual")) {
			return { ok: true, status: 200, json: async () => [catalogEntry("glm-5.3")] };
		}
		return { ok: false, status: 500 };
	};

	const models = await fetchCatalogModels({ signal, fetchImpl });

	assert.equal(models.get("glm-5.3").contextWindow, 200000);
	assert.equal(CATALOG_URLS.length, 4);
});

test("fetchCatalogModels survives every catalog being unreachable", async () => {
	const fetchImpl = async () => {
		throw new Error("network down");
	};

	const models = await fetchCatalogModels({ signal, fetchImpl });

	assert.equal(models.size, 0);
});

test("fetchCatalogModels skips non-chat and incomplete entries", async () => {
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		json: async () => [
			{ ...catalogEntry("qwen-image-3.0-pro"), type: "image" },
			{ id: "broken", name: "Broken" },
			catalogEntry("glm-5.3"),
		],
	});

	const models = await fetchCatalogModels({ signal, fetchImpl });

	assert.deepEqual([...models.keys()], ["glm-5.3"]);
});
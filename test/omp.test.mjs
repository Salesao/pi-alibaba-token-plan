import assert from "node:assert/strict";
import { test } from "node:test";
import { toOmpThinking } from "../src/catalog.js";
import register from "../extensions/index.js";
import { REGION_ENV, baseUrlFor } from "../src/regions.js";

const PROVIDER = "alibaba-openai";
const SG_URL = baseUrlFor("sg");
const CN_URL = baseUrlFor("cn");

function fakeOmpPi() {
	const providers = [];
	return {
		providers,
		// OMP-only markers; Pi has none of them.
		pi: {},
		zod: {},
		arktype: {},
		registerProvider: (name, config) => providers.push({ name, config }),
	};
}

/** SG rejects the key, Beijing serves it; catalogs are down. */
function chineseKeyFetch() {
	const calls = [];
	const impl = async (url) => {
		calls.push(String(url));
		if (String(url) === `${CN_URL}/models`) {
			return { ok: true, status: 200, json: async () => ({ data: [{ id: "qwen4-max-preview" }] }) };
		}
		if (String(url) === `${SG_URL}/models`) return { ok: false, status: 401, json: async () => ({}) };
		throw new Error("catalog down");
	};
	impl.calls = calls;
	return impl;
}

function callbacks(answers, fetchImpl) {
	return {
		fetch: fetchImpl,
		signal: new AbortController().signal,
		onPrompt: async ({ message }) => {
			const key = message.includes("purchased") ? "region" : "key";
			if (!(key in answers)) throw new Error(`unexpected prompt: ${message}`);
			return answers[key];
		},
	};
}

const withRegionEnv = async (value, fn) => {
	const previous = process.env[REGION_ENV];
	if (value === undefined) delete process.env[REGION_ENV];
	else process.env[REGION_ENV] = value;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env[REGION_ENV];
		else process.env[REGION_ENV] = previous;
	}
};

test("OMP host gets registerProvider(name, config) instead of a native provider", async () => {
	const pi = fakeOmpPi();
	await register(pi);

	assert.equal(pi.providers.length, 1);
	const { name, config } = pi.providers[0];
	assert.equal(name, PROVIDER);
	assert.equal(config.api, "openai-completions");
	assert.equal(config.apiKey, process.env.ALIBABA_API_KEY);
	assert.equal(config.baseUrl, SG_URL);
	assert.equal(typeof config.oauth.login, "function");
	assert.equal(typeof config.oauth.getApiKey, "function");
	assert.equal(typeof config.fetchDynamicModels, "function");
});

test("OMP login stores the chosen region in the credential", async () => {
	const pi = fakeOmpPi();
	const fetchImpl = chineseKeyFetch();
	await register(pi, { fetchImpl });
	const { config } = pi.providers[0];

	const credentials = await config.oauth.login(callbacks({ region: "2", key: "sk-cn" }, fetchImpl));

	assert.equal(credentials.access, "sk-cn");
	assert.equal(credentials.alibabaRegion, "cn");
	assert.ok(fetchImpl.calls.includes(`${CN_URL}/models`));
});

test("OMP login rejects a key from the other region", async () => {
	const pi = fakeOmpPi();
	const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
	await register(pi, { fetchImpl });
	const { config } = pi.providers[0];

	await assert.rejects(
		() => config.oauth.login(callbacks({ region: "2", key: "sk-sg" }, fetchImpl)),
		/different region/,
	);
});

test("OMP discovery probes the other region when the default rejects the key", async () => {
	const pi = fakeOmpPi();
	const fetchImpl = chineseKeyFetch();
	await register(pi, { fetchImpl });
	const { config } = pi.providers[0];

	const models = await withRegionEnv(undefined, () => config.fetchDynamicModels("sk-cn"));

	assert.deepEqual(
		models.map((model) => model.id),
		["qwen4-max-preview"],
	);
	assert.equal(models[0].baseUrl, CN_URL);
	assert.ok(fetchImpl.calls.includes(`${SG_URL}/models`));
	assert.ok(fetchImpl.calls.includes(`${CN_URL}/models`));
});

test("OMP discovery honours the region env var without probing", async () => {
	const pi = fakeOmpPi();
	const fetchImpl = chineseKeyFetch();
	await register(pi, { fetchImpl });
	const { config } = pi.providers[0];

	const models = await withRegionEnv("cn", () => config.fetchDynamicModels("sk-cn"));

	assert.equal(models[0].baseUrl, CN_URL);
	assert.ok(!fetchImpl.calls.includes(`${SG_URL}/models`), fetchImpl.calls.join(", "));
});

test("OMP discovery without a key returns no models", async () => {
	const pi = fakeOmpPi();
	await register(pi);
	assert.deepEqual(await pi.providers[0].config.fetchDynamicModels(undefined), []);
});

test("OMP thinking metadata keeps only supported efforts", () => {
	assert.deepEqual(
		toOmpThinking({ off: null, minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null }),
		{ mode: "effort", efforts: ["low", "medium", "xhigh"], effortMap: { low: "low", medium: "medium", xhigh: "xhigh" } },
	);
	assert.equal(toOmpThinking(undefined), undefined);
});

test("OMP model projection rewrites baseUrl to the credential region", async () => {
	const pi = fakeOmpPi();
	await register(pi);
	const { config } = pi.providers[0];
	const models = [
		{ provider: PROVIDER, id: "qwen4-max", baseUrl: SG_URL },
		{ provider: "other", id: "x", baseUrl: "https://other.example" },
	];

	const projected = config.oauth.modifyModels(models, { alibabaRegion: "cn" });

	assert.equal(projected[0].baseUrl, CN_URL);
	assert.equal(projected[1].baseUrl, "https://other.example");
});
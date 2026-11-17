import assert from "node:assert/strict";
import { createModels } from "@earendil-works/pi-ai";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import register from "../extensions/index.js";
import { REFRESH_INTERVAL_MS } from "../src/models.js";
import { REGION_ENV, baseUrlFor } from "../src/regions.js";

const PROVIDER = "alibaba-openai";
const CN_URL = baseUrlFor("cn");

const storedModel = {
	type: "chat",
	id: "qwen9-chat",
	name: "Qwen9",
	api: "openai-completions",
	provider: PROVIDER,
	baseUrl: baseUrlFor("sg"),
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 8192,
};

function fakePi() {
	const providers = [];
	return { providers, registerProvider: (provider) => providers.push(provider) };
}

function fakeFetch() {
	const calls = [];
	const impl = async (url) => {
		calls.push(String(url));
		if (String(url).endsWith("/models")) {
			return { ok: true, status: 200, json: async () => ({ data: [{ id: "qwen4-max-preview" }] }) };
		}
		throw new Error("catalog down");
	};
	impl.calls = calls;
	return impl;
}

function fakeContext(overrides = {}) {
	const publications = [];
	return {
		publications,
		allowNetwork: true,
		signal: new AbortController().signal,
		publish: async (publication) => {
			publications.push(publication);
			publication.update?.();
			return true;
		},
		...overrides,
	};
}

const setup = (fetchImpl = fakeFetch()) => {
	const pi = fakePi();
	register(pi, { fetchImpl, agentDir: mkdtempSync(join(tmpdir(), "alp-agent-")) });
	return { provider: pi.providers[0], pi, fetchImpl };
};

test("register adds one native provider with login support", () => {
	const { pi, provider } = setup();

	assert.equal(pi.providers.length, 1);
	assert.equal(provider.id, PROVIDER);
	assert.equal(provider.name, "Alibaba Token Plan");
	assert.equal(typeof provider.auth.apiKey.login, "function");
	assert.deepEqual(provider.getModels(), []);
});

test("refreshModels restores the stored catalog without touching the network", async () => {
	const { provider, fetchImpl } = setup();
	const context = fakeContext({
		allowNetwork: false,
		stored: { models: [storedModel], checkedAt: Date.now() },
	});

	await provider.refreshModels(context);

	assert.deepEqual(
		provider.getModels().map((m) => m.id),
		["qwen9-chat"],
	);
	assert.equal(fetchImpl.calls.length, 0);
	assert.equal(context.publications.length, 1);
	assert.equal(typeof context.publications[0].update, "function");
});

test("a fresh snapshot is not refetched on a restore-only pass", async () => {
	const { provider, fetchImpl } = setup();

	await provider.refreshModels(
		fakeContext({ allowNetwork: false, stored: { models: [storedModel], checkedAt: Date.now() } }),
	);

	assert.equal(fetchImpl.calls.length, 0);
});

test("a login refetches a fresh snapshot on the refresh pi runs right after it", async () => {
	const { provider, fetchImpl } = setup();
	const interaction = {
		signal: new AbortController().signal,
		prompt: async ({ type }) => ({ select: "sg", secret: "sk-test" })[type],
	};
	await provider.auth.apiKey.login(interaction);

	await provider.refreshModels(
		fakeContext({
			credential: { type: "api_key", key: "sk-test" },
			stored: { models: [storedModel], checkedAt: Date.now() },
		}),
	);

	assert.equal(provider.getModels()[0].id, "qwen4-max-preview");
	assert.ok(fetchImpl.calls.length >= 2, "login verification and the catalog refresh both hit the network");
});

test("a stale snapshot is refetched against the credential region and persisted", async () => {
	const { provider, fetchImpl } = setup();
	const context = fakeContext({
		stored: { models: [storedModel], checkedAt: Date.now() - REFRESH_INTERVAL_MS - 1 },
		credential: { type: "api_key", key: "k", env: { [REGION_ENV]: "cn" } },
	});

	await provider.refreshModels(context);

	assert.ok(fetchImpl.calls.includes(`${CN_URL}/models`), fetchImpl.calls.join(", "));
	const persisted = context.publications.at(-1).persist;
	assert.ok(persisted.models.length > 0);
	assert.equal(typeof persisted.checkedAt, "number");
	assert.equal(provider.getModels()[0].baseUrl, CN_URL);
});

test("force refetches even a fresh snapshot", async () => {
	const { provider, fetchImpl } = setup();

	await provider.refreshModels(
		fakeContext({
			force: true,
			stored: { models: [storedModel], checkedAt: Date.now() },
			credential: { type: "api_key", key: "k" },
		}),
	);

	assert.ok(fetchImpl.calls.length > 0);
});

test("refresh without any key fails with a login hint", async () => {
	const { provider } = setup();
	const previous = process.env.ALIBABA_API_KEY;
	delete process.env.ALIBABA_API_KEY;
	try {
		await assert.rejects(() => provider.refreshModels(fakeContext()), /\/login/);
	} finally {
		if (previous !== undefined) process.env.ALIBABA_API_KEY = previous;
	}
});

// A login changes the credential, so Pi's own post-login refresh must reach the
// network even when the stored catalog is still inside the freshness window.
test("the SDK's post-login refresh bypasses a fresh snapshot", async () => {
	const fetchImpl = fakeFetch();
	const pi = fakePi();
	register(pi, { fetchImpl, agentDir: mkdtempSync(join(tmpdir(), "alp-agent-")) });

	let credential = { type: "api_key", key: "sk-sg", env: { [REGION_ENV]: "sg" } };
	const models = createModels({
		credentials: {
			read: async () => credential,
			list: async () => [{ providerId: PROVIDER, type: "api_key" }],
			modify: async (_id, fn) => {
				credential = await fn(credential);
				return credential;
			},
			delete: async () => {},
		},
		modelsStore: {
			read: async () => ({ models: [storedModel], checkedAt: Date.now() }),
			write: async () => {},
			delete: async () => {},
		},
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	models.setProvider(pi.providers[0]);

	await models.login(PROVIDER, "api_key", {
		signal: new AbortController().signal,
		prompt: async ({ type }) => ({ select: "sg", secret: "sk-test" })[type],
	});
	const before = fetchImpl.calls.length;
	const result = await models.refresh({ allowNetwork: true, providers: [PROVIDER] });

	assert.equal(result.errors.size, 0, [...result.errors.values()].join("; "));
	assert.ok(fetchImpl.calls.length > before, "the refresh after a login must hit the network");
	assert.equal(models.getModel(PROVIDER, "qwen4-max-preview").id, "qwen4-max-preview");
});

// The SDK rebuilds the discovery credential from resolve()'s result, keeping only
// key and env — auth.baseUrl is dropped. A Beijing credential must therefore reach
// fetchModels through env, or discovery silently goes to Singapore and gets 401.
test("a stored Beijing credential refreshes against Beijing through the real SDK", async () => {
	const fetchImpl = fakeFetch();
	const pi = fakePi();
	register(pi, { fetchImpl, agentDir: mkdtempSync(join(tmpdir(), "alp-agent-")) });

	const stored = { type: "api_key", key: "sk-cn", env: { [REGION_ENV]: "cn" } };
	const models = createModels({
		credentials: {
			read: async () => stored,
			list: async () => [{ providerId: PROVIDER, type: "api_key" }],
			modify: async (_id, fn) => fn(stored),
			delete: async () => {},
		},
		modelsStore: {
			read: async () => undefined,
			write: async () => {},
			delete: async () => {},
		},
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	models.setProvider(pi.providers[0]);

	const regionEnv = process.env[REGION_ENV];
	delete process.env[REGION_ENV];
	try {
		const result = await models.refresh({ allowNetwork: true, providers: [PROVIDER] });
		assert.equal(result.errors.size, 0, [...result.errors.values()].join("; "));
	} finally {
		if (regionEnv !== undefined) process.env[REGION_ENV] = regionEnv;
	}

	assert.ok(fetchImpl.calls.includes(`${CN_URL}/models`), fetchImpl.calls.join(", "));
	assert.equal(models.getModel(PROVIDER, "qwen4-max-preview").baseUrl, CN_URL);
});
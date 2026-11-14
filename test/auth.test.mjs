import assert from "node:assert/strict";
import { test } from "node:test";
import { API_KEY_ENV, createApiKeyAuth } from "../src/auth.js";
import { REGION_ENV, baseUrlFor } from "../src/regions.js";

// Fake login interaction: answers are queued per prompt type, so a test states
// exactly what the person types and what the flow asks for.
function fakeInteraction(answers, { failOn } = {}) {
	const prompts = [];
	const events = [];
	const controller = new AbortController();
	return {
		prompts,
		events,
		signal: controller.signal,
		async prompt(prompt) {
			prompts.push(prompt);
			if (failOn === prompts.length) throw new Error("cancelled");
			const answer = answers[prompt.type];
			if (answer === undefined) throw new Error(`no answer for ${prompt.type}`);
			return answer;
		},
		notify(event) {
			events.push(event);
		},
	};
}

function fakeFetch(response) {
	const calls = [];
	const impl = async (url, options) => {
		calls.push({ url: String(url), options });
		return response;
	};
	impl.calls = calls;
	return impl;
}

const ok = { ok: true, status: 200 };
const envContext = (values = {}) => ({ env: async (name) => values[name] });
const signal = new AbortController().signal;

test("login asks for the region, then the key, and trims the pasted key", async () => {
	const interaction = fakeInteraction({ select: "cn", secret: " sk-test " });
	const fetchImpl = fakeFetch(ok);
	const auth = createApiKeyAuth({ fetchImpl });

	const credential = await auth.login(interaction);

	assert.deepEqual(credential, { type: "api_key", key: "sk-test", env: { [REGION_ENV]: "cn" } });
	assert.deepEqual(
		interaction.prompts.map((p) => p.type),
		["select", "secret"],
	);
	assert.deepEqual(
		interaction.prompts[0].options.map((o) => o.id).sort(),
		["cn", "sg"],
	);
});

test("login verifies the key against the selected region endpoint", async () => {
	const interaction = fakeInteraction({ select: "cn", secret: "sk-test" });
	const fetchImpl = fakeFetch(ok);
	await createApiKeyAuth({ fetchImpl }).login(interaction);

	assert.equal(fetchImpl.calls.length, 1);
	assert.equal(fetchImpl.calls[0].url, `${baseUrlFor("cn")}/models`);
	assert.equal(fetchImpl.calls[0].options.headers.authorization, "Bearer sk-test");
});

test("login rejects a key from another region without saving it", async () => {
	const interaction = fakeInteraction({ select: "sg", secret: "sk-cn-key" });
	const fetchImpl = fakeFetch({ ok: false, status: 401 });

	await assert.rejects(() => createApiKeyAuth({ fetchImpl }).login(interaction), /region/i);
	assert.equal(interaction.prompts.length, 2);
});

test("login reports an unexpected server status", async () => {
	const interaction = fakeInteraction({ select: "sg", secret: "sk-test" });
	const fetchImpl = fakeFetch({ ok: false, status: 500 });

	await assert.rejects(() => createApiKeyAuth({ fetchImpl }).login(interaction), /500/);
});

test("login rejects an empty key before any request", async () => {
	const interaction = fakeInteraction({ select: "sg", secret: "   " });
	const fetchImpl = fakeFetch(ok);

	await assert.rejects(() => createApiKeyAuth({ fetchImpl }).login(interaction), /empty/i);
	assert.equal(fetchImpl.calls.length, 0);
});

test("login propagates cancellation at the region step", async () => {
	const interaction = fakeInteraction({ select: "sg", secret: "sk-test" }, { failOn: 1 });
	const fetchImpl = fakeFetch(ok);

	await assert.rejects(() => createApiKeyAuth({ fetchImpl }).login(interaction), /cancelled/);
	assert.equal(fetchImpl.calls.length, 0);
});

test("login propagates cancellation at the key step", async () => {
	const interaction = fakeInteraction({ select: "sg", secret: "sk-test" }, { failOn: 2 });
	const fetchImpl = fakeFetch(ok);

	await assert.rejects(() => createApiKeyAuth({ fetchImpl }).login(interaction), /cancelled/);
	assert.equal(fetchImpl.calls.length, 0);
});

test("resolve uses the stored key and its region", async () => {
	const auth = createApiKeyAuth({ fetchImpl: fakeFetch(ok) });
	const result = await auth.resolve({
		ctx: envContext(),
		credential: { type: "api_key", key: "k", env: { [REGION_ENV]: "cn" } },
		signal,
	});

	assert.equal(result.auth.apiKey, "k");
	assert.equal(result.auth.baseUrl, baseUrlFor("cn"));
	assert.equal(result.source, "stored credential");
});

test("resolve falls back to the environment key and Singapore", async () => {
	const auth = createApiKeyAuth({ fetchImpl: fakeFetch(ok) });
	const result = await auth.resolve({ ctx: envContext({ [API_KEY_ENV]: "env-key" }), signal });

	assert.equal(result.auth.apiKey, "env-key");
	assert.equal(result.auth.baseUrl, baseUrlFor("sg"));
	assert.equal(result.source, API_KEY_ENV);
});

test("resolve takes the region from the environment when the credential has none", async () => {
	const auth = createApiKeyAuth({ fetchImpl: fakeFetch(ok) });
	const result = await auth.resolve({
		ctx: envContext({ [REGION_ENV]: "cn" }),
		credential: { type: "api_key", key: "k" },
		signal,
	});

	assert.equal(result.auth.baseUrl, baseUrlFor("cn"));
});

test("resolve survives a corrupted region in the stored credential", async () => {
	const auth = createApiKeyAuth({ fetchImpl: fakeFetch(ok) });
	const result = await auth.resolve({
		ctx: envContext(),
		credential: { type: "api_key", key: "k", env: { [REGION_ENV]: "mars" } },
		signal,
	});

	assert.equal(result.auth.baseUrl, baseUrlFor("sg"));
});

test("resolve reports an unconfigured provider", async () => {
	const auth = createApiKeyAuth({ fetchImpl: fakeFetch(ok) });
	assert.equal(await auth.resolve({ ctx: envContext(), signal }), undefined);
});

test("check reports availability without touching the network", async () => {
	const fetchImpl = fakeFetch(ok);
	const auth = createApiKeyAuth({ fetchImpl });

	assert.equal(await auth.check({ ctx: envContext(), signal }), undefined);
	const configured = await auth.check({
		ctx: envContext(),
		credential: { type: "api_key", key: "k" },
		signal,
	});
	assert.equal(configured.type, "api_key");
	assert.equal(fetchImpl.calls.length, 0);
});
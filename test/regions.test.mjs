import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REGION, REGIONS, REGION_ENV, baseUrlFor, resolveRegion } from "../src/regions.js";

const SG_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const CN_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

test("resolveRegion keeps a known region", () => {
	assert.equal(resolveRegion("cn"), "cn");
	assert.equal(resolveRegion("sg"), "sg");
});

test("resolveRegion falls back to Singapore for anything else", () => {
	assert.equal(DEFAULT_REGION, "sg");
	assert.equal(resolveRegion(undefined), "sg");
	assert.equal(resolveRegion(""), "sg");
	assert.equal(resolveRegion("us"), "sg");
	assert.equal(resolveRegion(null), "sg");
});

test("baseUrlFor returns the documented Token Plan endpoint per region", () => {
	assert.equal(baseUrlFor("sg"), SG_URL);
	assert.equal(baseUrlFor("cn"), CN_URL);
	assert.equal(baseUrlFor("nope"), SG_URL);
});

test("every region has a label and the region env name is stable", () => {
	assert.equal(REGION_ENV, "ALIBABA_TOKEN_PLAN_REGION");
	for (const region of Object.values(REGIONS)) {
		assert.ok(region.label.length > 0);
	}
	assert.deepEqual(Object.keys(REGIONS).sort(), ["cn", "sg"]);
});
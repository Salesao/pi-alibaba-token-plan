import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const HOST_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"];

test("manifest declares the extension entry point", () => {
	assert.ok(Array.isArray(pkg.pi?.extensions));
	assert.ok(pkg.pi.extensions.length > 0);
});

test("manifest is discoverable in the package gallery", () => {
	assert.ok(pkg.keywords.includes("pi-package"));
});

test("host packages are peer dependencies, never bundled dependencies", () => {
	for (const name of HOST_PACKAGES) {
		assert.equal(pkg.dependencies?.[name], undefined);
		assert.equal(pkg.peerDependencies?.[name], "*");
	}
});

test("test script runs the node test runner", () => {
	assert.match(pkg.scripts.test, /node --test/);
});
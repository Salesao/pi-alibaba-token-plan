import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { test } from "node:test";

// Pi resolves a fixed list of host specifiers for extensions (VIRTUAL_MODULES in
// the coding-agent extension loader). Anything else must resolve from the
// package's own node_modules — which a git-installed package does not have.
// A subpath outside this list therefore loads locally and breaks after install.
const HOST_SPECIFIERS = new Set([
	"typebox",
	"typebox/compile",
	"typebox/value",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-ai/compat",
	"@earendil-works/pi-ai/models",
	"@earendil-works/pi-ai/oauth",
	"@earendil-works/pi-ai/providers/all",
	"@earendil-works/pi-coding-agent",
]);

const modules = readdirSync(new URL("../extensions", import.meta.url))
	.filter((name) => name.endsWith(".js"))
	.map((name) => ({ name, source: readFileSync(new URL(`../extensions/${name}`, import.meta.url), "utf8") }));

test("every extension module imports only host specifiers, relative files or node builtins", () => {
	assert.ok(modules.length > 0);
	for (const { name, source } of modules) {
		const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
		assert.ok(specifiers.length > 0, name);
		for (const specifier of specifiers) {
			const allowed =
				HOST_SPECIFIERS.has(specifier) ||
				specifier.startsWith(".") ||
				specifier.startsWith("node:") ||
				builtinModules.includes(specifier);
			assert.ok(allowed, `${name}: unresolvable after a git install: ${specifier}`);
		}
	}
});

test("the OMP module never imports host-local Pi specifiers", () => {
	const omp = modules.find((entry) => entry.name === "host-omp.js");
	assert.ok(omp);
	assert.doesNotMatch(omp.source, /@earendil-works\//);
});
/**
 * Host dispatcher for the Alibaba Token Plan provider.
 *
 * Pi and OMP resolve extension host modules differently: Pi maps
 * `@earendil-works/pi-ai` (createProvider), while OMP maps the same specifier
 * to its own bundle that has no `createProvider` and uses
 * `registerProvider(id, config)`. The static import graph therefore has to
 * differ per host, so each implementation lives in its own module and is
 * imported only for the host that runs it.
 *
 * Host markers: OMP exposes `pi.pi`, `pi.zod` and `pi.arktype`; Pi exposes
 * none of them.
 */
import { REFRESH_INTERVAL_MS } from "../src/models.js";

const PROVIDER_ID = "alibaba-openai";

function isOmpHost(pi) {
	return Boolean(pi && (pi.pi !== undefined || pi.zod !== undefined || pi.arktype !== undefined));
}

export default async function register(pi, options) {
	if (isOmpHost(pi)) {
		const { default: registerOmp } = await import("./host-omp.js");
		return registerOmp(pi, options);
	}
	const { default: registerPi } = await import("./host-pi.js");
	return registerPi(pi, options);
}

export { PROVIDER_ID, REFRESH_INTERVAL_MS };
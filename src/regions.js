// Token Plan endpoints. Keys are region-specific: a key from one region is
// rejected with 401 by the other, so the region travels with the credential.
// Source: Model Studio docs, "Base URL overview" (international and China sites).
export const REGIONS = {
	sg: {
		label: "Singapore (International)",
		baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
	},
	cn: {
		label: "China (Beijing)",
		baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
	},
};

export const DEFAULT_REGION = "sg";

export const REGION_ENV = "ALIBABA_TOKEN_PLAN_REGION";

export function resolveRegion(value) {
	return typeof value === "string" && Object.hasOwn(REGIONS, value) ? value : DEFAULT_REGION;
}

export function baseUrlFor(region) {
	return REGIONS[resolveRegion(region)].baseUrl;
}
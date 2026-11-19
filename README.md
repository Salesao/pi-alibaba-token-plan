# pi-alibaba-token-plan

Alibaba Model Studio **Token Plan** as a Pi or OMP (`omp`) provider: sign in with `/login`, pick the
region your plan was bought in, and get the plan's own model list with correct context limits and
thinking.

Works with both Token Plan endpoints — Singapore (International) and China (Beijing). Keys are
region-specific, so the region is stored with the key.

## Install

Pi:

```bash
pi install npm:pi-alibaba-token-plan
# or straight from the repository
pi install git:github.com/Salesao/pi-alibaba-token-plan
```

OMP:

```bash
omp plugin install pi-alibaba-token-plan
# or straight from the repository
omp plugin install git:github.com/Salesao/pi-alibaba-token-plan
```

The same package declares one extension entry; it detects the host and uses the host's provider API
(`createProvider` on Pi, `registerProvider(id, config)` on OMP).

## Where the key comes from

The Token Plan lives in the Alibaba Cloud Model Studio console —
[modelstudio.console.alibabacloud.com](https://modelstudio.console.alibabacloud.com/).
Open the subscription page for your region and copy its dedicated API key:

| Region | Console page |
|---|---|
| Singapore (International) | [Token Plan Personal](https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/token-plan/personal) |
| China (Beijing) | [Token Plan](https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan) |

The same console lists the models your plan serves. A pay-as-you-go DashScope key does not work here.

## Sign in

```text
/login alibaba-openai
```

1. Pick **Singapore (International)** or **China (Beijing)** — the region shown in your Token Plan console.
2. Paste the Token Plan API key (a dedicated key, not a pay-as-you-go DashScope key).

The key is verified against the selected region before it is saved. A key from the other region is
rejected with a clear message and nothing is stored. Credentials live in `~/.pi/agent/auth.json`
on Pi and `~/.omp/agent/auth.json` on OMP.

Prefer environment variables? Both are read when no credential is stored:

```bash
export ALIBABA_API_KEY=sk-sp-your-key-here
export ALIBABA_TOKEN_PLAN_REGION=sg   # sg (default) or cn
```

## Use

```bash
pi --model alibaba-openai/qwen4-max-preview:xhigh
omp --model alibaba-openai/qwen4-max-preview:xhigh
```

Thinking levels for `qwen4-max` are `low`, `high` and `xhigh` — only the values Alibaba documents,
and thinking cannot be turned off. The model has a 1M context and a 262,144-token output budget.
`qwen4-max-preview` has a 1M context and a 393,216-token output budget shared by thinking and the
answer; its levels are `low`, `medium` and `xhigh` — ask for `:xhigh`, not `:high`. It is a
**preview**: Alibaba retires it after 2026-11-25.

## How the model list works

- The model ids come from your plan's own `GET /models`, so new models appear without a package update.
- That answer carries ids only. Context limits, thinking levels and input types come from the public
  pi.dev catalogs of the Qwen Token Plan providers, then from a small verified table inside this
  package for models those catalogs lag on.
- Pi stores the resulting catalog in `~/.pi/agent/models-store.json`, which is what offline starts and
  `pi -p` use. The list is refreshed on interactive startup, at most once every 15 minutes.
- OMP keeps the catalog in its model cache (24-hour TTL). Run `omp models refresh` to force a fetch;
  on OMP the region is not available to discovery, so a China key is detected by probing the other
  endpoint once (`ALIBABA_TOKEN_PLAN_REGION=cn` skips the probe).
- A login always refetches it immediately, inside that window or not: `/login` (interactive) and
  `pi auth login` both run a network refresh right after the credential is saved.
- OMP's `/login alibaba-openai` asks for the region as a numbered choice (OMP has no select prompt),
  then verifies the key against that region exactly like Pi.
- **First run:** the login itself fetches the catalog. Until that fetch completes there is nothing
  stored, so `pi --list-models` and `pi -p` show no models for this provider. (`pi update --models`
  only refreshes Pi's built-in catalogs, not provider extensions.)
- A failed or empty answer never wipes the catalog you already have.

Only chat models are listed. The plan's image, video and audio models are filtered out.
Costs are reported as zero because the plan is a subscription, not per-token billing.

## Development

```bash
npm install   # installs the host SDK peer dependencies for the tests
npm test
```

Try it without installing: `pi -ne -e ./extensions/index.js --list-models alibaba`
(`-ne` disables extension discovery, so a hand-installed copy cannot clash over the provider id).
On OMP: `omp --no-session -e ./extensions/index.js --model alibaba-openai/qwen4-max-preview "hi"`.

## License

MIT
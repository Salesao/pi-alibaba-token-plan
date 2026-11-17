# pi-alibaba-token-plan

Alibaba Model Studio **Token Plan** as a Pi provider: sign in with `/login`, pick the region your
plan was bought in, and get the plan's own model list with correct context limits and thinking.

Works with both Token Plan endpoints — Singapore (International) and China (Beijing). Keys are
region-specific, so the region is stored with the key.

## Install

```bash
pi install npm:pi-alibaba-token-plan
# or straight from the repository
pi install git:github.com/Salesao/pi-alibaba-token-plan
```

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
rejected with a clear message and nothing is stored. Credentials live in `~/.pi/agent/auth.json`.

Prefer environment variables? Both are read when no credential is stored:

```bash
export ALIBABA_API_KEY=sk-sp-your-key-here
export ALIBABA_TOKEN_PLAN_REGION=sg   # sg (default) or cn
```

## Use

```bash
pi --model alibaba-openai/qwen4-max-preview:xhigh
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
- **First run:** start `pi` interactively once. Until that first catalog fetch there is nothing stored,
  so `pi --list-models` and `pi -p` show no models for this provider. (`pi update --models` only
  refreshes Pi's built-in catalogs, not provider extensions.)
- A failed or empty answer never wipes the catalog you already have.

Only chat models are listed. The plan's image, video and audio models are filtered out.
Costs are reported as zero because the plan is a subscription, not per-token billing.

## Development

```bash
npm install   # installs the host SDK peer dependencies for the tests
npm test
```

Try it without installing: `pi -ne -e ./pi-alibaba-token-plan --list-models alibaba`
(`-ne` disables extension discovery, so a hand-installed copy cannot clash over the provider id).

## License

MIT
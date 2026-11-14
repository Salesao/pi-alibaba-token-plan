# pi-alibaba-token-plan — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вынести провайдер Alibaba Model Studio Token Plan в самостоятельный публикуемый pi-пакет с входом по ключу через `/login` и выбором региона.

**Architecture:** Native `Provider` из `@earendil-works/pi-ai` через `createProvider`: собственный `ApiKeyAuth` (выбор региона + ключ + проверка при входе), `fetchModels` тянет живые id из плана и обогащает их метаданными каталогов pi.dev и собственной таблицей override. Персист каталога и офлайн-восстановление делает pi (`context.stored` / `publish`), своего файла кэша нет. Стриминг — встроенный `openai-completions`.

**Tech Stack:** Node ≥18, plain ESM JS без сборки, `node --test`, `@earendil-works/pi-ai` (peer), pi ≥1.4.

**Spec:** `docs/superpowers/specs/2026-11-14-pi-alibaba-token-plan-design.ru.md` (в новом репозитории; до переезда — `/Users/salesao/Desktop/worksApp/orca-pod/docs/superpowers/specs/2026-11-14-pi-alibaba-token-plan-design.ru.md`)

## Global Constraints

- Каталог проекта: `/Users/salesao/Desktop/worksApp/pi-alibaba-token-plan`. Репозиторий: `Salesao/pi-alibaba-token-plan`, открытый, MIT.
- Provider id: `alibaba-openai`. Display name: `Alibaba Token Plan`. API: `openai-completions`.
- Регионы: `sg` → `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`; `cn` → `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`. Регион по умолчанию `sg`.
- Env: ключ `ALIBABA_API_KEY`, регион `ALIBABA_TOKEN_PLAN_REGION`.
- TTL снимка: `15 * 60 * 1000` мс. Таймаут любого запроса: `6000` мс.
- Каталоги метаданных (только чтение, без ключа): `https://pi.dev/api/models/providers/qwen-token-plan-individual?types=chat`, `…/qwen-token-plan?types=chat`, `…/qwen-token-plan-individual-cn?types=chat`, `…/qwen-token-plan-cn?types=chat`. Запросы к моделям всегда идут на домен региона, никогда на домен каталога.
- `qwen4-max-preview`: `contextWindow: 1000000`, `maxTokens: 393216`, `reasoning: true`, `input: ["text","image"]`, `thinkingLevelMap: { off:null, minimal:null, low:"low", medium:"medium", high:null, xhigh:"xhigh", max:null }`, `compat.thinkingFormat: "qwen"`, `compat.supportsReasoningEffort: true`, `compat.supportsStrictMode: true`.
- `BASE_COMPAT`: `{ supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_completion_tokens" }`. `cost`: все нули (подписка).
- Хостовые пакеты (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`) — только в `peerDependencies` с `"*"`, никогда в `dependencies`.
- Пакет не пишет внутрь своей установочной папки. Ключ, заголовки authorization и тела ответов провайдера не логируются.
- Пустой или неудачный ответ `/models` не стирает известный список моделей.
- Тесты: `node --test test/*.test.mjs`, сеть только через внедряемый `fetchImpl`.

## Review Focus

- Вставленный ключ с пробелом или переносом строки на конце → ключ обрезается, вход проходит; иначе человек получает 401 без объяснения.
- Ответ `/models` не JSON (страница ошибки прокси, HTML) → понятная ошибка, прежний список моделей цел.
- Каталог метаданных недоступен или отвечает медленно → работаем на своей таблице и прошлом снимке, вход и список моделей не падают.
- Отмена входа на любом шаге (выбор региона, ввод ключа, проверка) → ничего не сохранено, ошибки в лог не летят.
- В сохранённой записи регион неизвестен или пуст → переход на Singapore, модели доступны; иначе человек теряет доступ из-за одной испорченной записи.

---

### Task 1: Каркас проекта и регионы

**Files:**
- Create: `package.json`, `.gitignore`, `LICENSE`, `src/regions.js`
- Create: `docs/superpowers/specs/2026-11-14-pi-alibaba-token-plan-design.ru.md`, `docs/superpowers/plans/2026-11-14-pi-alibaba-token-plan.md` (перенос из orca-pod, D13)
- Test: `test/regions.test.mjs`, `test/package.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces: `REGIONS` (`{ sg: { label, baseUrl }, cn: { label, baseUrl } }`), `DEFAULT_REGION = "sg"`, `REGION_ENV = "ALIBABA_TOKEN_PLAN_REGION"`, `resolveRegion(value: unknown): "sg" | "cn"`, `baseUrlFor(region: string): string`.

- [ ] **Step 1: Написать падающие тесты регионов и манифеста**

`test/regions.test.mjs`: `resolveRegion("cn") === "cn"`; `resolveRegion("sg") === "sg"`; `resolveRegion(undefined)`, `resolveRegion("")`, `resolveRegion("us")`, `resolveRegion(null)` → `"sg"`; `baseUrlFor("cn")` и `baseUrlFor("sg")` равны точным URL из Global Constraints; `baseUrlFor("nope")` равен URL Singapore; каждый регион имеет непустой `label`.

`test/package.test.mjs`: `pi.extensions` — непустой массив; `keywords` содержит `pi-package`; ни один хостовый пакет не упомянут в `dependencies`; оба хостовых пакета в `peerDependencies` равны `"*"`; `scripts.test` содержит `node --test`. Проверку существования файла расширения добавить в Task 5 (тогда он появляется).

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `cd /Users/salesao/Desktop/worksApp/pi-alibaba-token-plan && npm test`
Expected: FAIL — `Cannot find module '../src/regions.js'` и отсутствие `package.json`.

- [ ] **Step 3: Создать каркас, `src/regions.js` и перенести документы**

`package.json`: `name: "pi-alibaba-token-plan"`, `version: "0.1.0"`, `type: "module"`, `license: "MIT"`, `author: "Salesao"`, `engines.node: ">=18"`, `scripts.test: "node --test test/*.test.mjs"`, `keywords: ["pi-package","pi","pi-coding-agent","extension","provider","alibaba","qwen","token-plan"]`, `pi.extensions: ["./extensions/index.js"]`, `files: ["extensions","src","LICENSE","README*.md"]`, `peerDependencies: { "@earendil-works/pi-ai": "*", "@earendil-works/pi-coding-agent": "*" }`, `repository`/`homepage`/`bugs` на `github.com/Salesao/pi-alibaba-token-plan`. Без `dependencies`.
`.gitignore`: `node_modules/`, `*.tgz`, `.pi/`. `LICENSE`: MIT, как в `~/Desktop/worksApp/pi-task/LICENSE`.
`src/regions.js`: значения из Global Constraints; `resolveRegion` возвращает ключ `REGIONS`, если он есть, иначе `DEFAULT_REGION`; `baseUrlFor` = `REGIONS[resolveRegion(region)].baseUrl`.

Перенос документов (D13 — первым коммитом):

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp /Users/salesao/Desktop/worksApp/orca-pod/docs/superpowers/specs/2026-11-14-pi-alibaba-token-plan-design.ru.md docs/superpowers/specs/
cp /Users/salesao/Desktop/worksApp/orca-pod/docs/superpowers/plans/2026-11-14-pi-alibaba-token-plan.md docs/superpowers/plans/
rm /Users/salesao/Desktop/worksApp/orca-pod/docs/superpowers/specs/2026-11-14-pi-alibaba-token-plan-design.ru.md /Users/salesao/Desktop/worksApp/orca-pod/docs/superpowers/plans/2026-11-14-pi-alibaba-token-plan.md
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Закоммитить**

```bash
git init && git add package.json .gitignore LICENSE src/regions.js test/regions.test.mjs test/package.test.mjs docs
git commit -m "feat: scaffold package, region endpoints and design docs"
```

---

### Task 2: Вход по ключу с выбором региона

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.mjs`

**Interfaces:**
- Consumes: `REGIONS`, `DEFAULT_REGION`, `REGION_ENV`, `resolveRegion`, `baseUrlFor` (Task 1).
- Produces: `API_KEY_ENV = "ALIBABA_API_KEY"`, `createApiKeyAuth({ fetchImpl = fetch, timeoutMs = 6000 } = {}): ApiKeyAuth` с полями `name`, `login(interaction)`, `resolve({ ctx, credential, signal })`, `check({ ctx, credential, signal })`. `login` возвращает `{ type: "api_key", key, env: { [REGION_ENV]: "sg" | "cn" } }`. `resolve` возвращает `{ auth: { apiKey, baseUrl }, source }` либо `undefined`.

- [ ] **Step 1: Написать падающие тесты входа**

`test/auth.test.mjs`, фейковый `interaction` (`prompt` отдаёт заготовленные ответы по типу промпта, `notify` собирает события) и фейковый `fetchImpl`:
- `login` спрашивает `select` с двумя опциями `sg`/`cn`, затем `secret`; при ответах `"cn"` и `" sk-test "` и ответе `/models` 200 возвращает `{ type:"api_key", key:"sk-test", env:{ ALIBABA_TOKEN_PLAN_REGION:"cn" } }` — ключ обрезан (Review Focus 1).
- запрос проверки ушёл на `baseUrlFor("cn") + "/models"` с заголовком `authorization: Bearer sk-test`.
- 401 → `rejects` с сообщением, содержащим `region`, и `prompt` не вызывался повторно; credential не возвращён.
- 500 → `rejects` с сообщением, содержащим `500`.
- пустой ключ (`"   "`) → `rejects`, `fetchImpl` не вызывался.
- отмена: `prompt` реджектит на первом шаге и на втором → `login` реджектит тем же сигналом, `fetchImpl` не вызывался (Review Focus 4).
- `resolve` с credential `{ key:"k", env:{ ALIBABA_TOKEN_PLAN_REGION:"cn" } }` → `auth.baseUrl === baseUrlFor("cn")`, `auth.apiKey === "k"`, `source === "stored credential"`.
- `resolve` без credential, `ctx.env("ALIBABA_API_KEY") === "env-key"` → `auth.apiKey === "env-key"`, `baseUrl === baseUrlFor("sg")`, `source === "ALIBABA_API_KEY"`.
- `resolve` с credential без `env` и `ctx.env(REGION_ENV) === "cn"` → `baseUrlFor("cn")`.
- `resolve` с испорченным регионом `"mars"` → `baseUrlFor("sg")` (Review Focus 5).
- `resolve` без ключа нигде → `undefined`; `check` без ключа → `undefined`, с ключом → `{ type:"api_key" }`, и `check` не вызывает `fetchImpl`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/auth.test.mjs`
Expected: FAIL — `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Реализовать `src/auth.js`**

`createApiKeyAuth` собирает объект `ApiKeyAuth`. `login`: `interaction.prompt({ type:"select", message:"Where was the Token Plan purchased?", options: [из REGIONS: {id, label}] })` → `interaction.prompt({ type:"secret", message:"Enter the Token Plan API key" })` → `key.trim()`; пустой → `throw new Error("API key is empty")`; проверочный `GET ${baseUrlFor(region)}/models` с `authorization`, `accept: application/json` и `AbortSignal.any([interaction.signal, AbortSignal.timeout(timeoutMs)])`; 401 → `throw new Error("This key belongs to a different region…")`, иной `!ok` → ошибка со статусом; иначе credential. Тело ответа не читается и не логируется. `resolve`/`check` берут ключ и регион в порядке из Global Constraints, сеть не трогают.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Закоммитить**

```bash
git add src/auth.js test/auth.test.mjs
git commit -m "feat: api-key login with region selection and verification"
```

---

### Task 3: Метаданные моделей

**Files:**
- Create: `src/catalog.js`
- Test: `test/catalog.test.mjs`

**Interfaces:**
- Consumes: ничего из предыдущих задач, кроме значений Global Constraints.
- Produces: `ZERO_COST`, `BASE_COMPAT`, `CATALOG_URLS`, `VERIFIED_OVERRIDES`, `isChatCandidate(id): boolean`, `toModelConfig(raw): object | undefined`, `unverifiedModel(id): object`, `verifiedOverride(id): object | undefined`, `fetchCatalogModels({ signal, fetchImpl = fetch, timeoutMs = 6000 }): Promise<Map<string, object>>`, `buildModels({ liveIds, catalogModels, previousModels, baseUrl, providerId }): object[]`.

- [ ] **Step 1: Написать падающие тесты метаданных**

`test/catalog.test.mjs`:
- `isChatCandidate`: `true` для `qwen4-max-preview`, `glm-5.3`, `deepseek-v4-pro`, `kimi-k2.6`, `MiniMax-M2.5`, `auto`; `false` для `qwen-image-3.0-pro`, `qwen-audio-3.0-tts-plus`, `wan2.7-image-pro`, `text-embedding-v4`.
- `buildModels` c `liveIds: ["qwen4-max-preview"]` и пустым каталогом → одна модель с точными значениями qwen4 из Global Constraints, `name: "Qwen4 Max Preview"`.
- `buildModels` ставит каждой модели `provider: providerId`, `api: "openai-completions"`, `type: "chat"` и `baseUrl`, равный переданному `baseUrl` — **включая модель, пришедшую из каталога с чужим `baseUrl`** (`https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`).
- каталог важнее override: запись каталога для `qwen4-max-preview` с `maxTokens: 111` даёт `111`.
- прошлый снимок важнее заглушки: неизвестный `qwen9-chat` есть в `previousModels` с `contextWindow: 500000` → берётся он; иначе заглушка `131072`/`16384`, `reasoning: false`, `name` содержит `unverified`.
- не-чатовые id из `liveIds` отброшены; результат отсортирован по `id`; дубликаты `liveIds` схлопнуты.
- `compat` любой модели содержит все три поля `BASE_COMPAT`; `cost` — все нули.
- `fetchCatalogModels`: первый каталог 200, второй 500 → Map содержит модели первого; все каталоги реджектят → пустой Map, без исключения; запись с `type: "image"` пропущена; запись без `contextWindow` пропущена (Review Focus 3).

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/catalog.test.mjs`
Expected: FAIL — `Cannot find module '../src/catalog.js'`.

- [ ] **Step 3: Реализовать `src/catalog.js`**

Перенести из `~/.pi/agent/extensions/alibaba-token-plan/index.ts` фильтры семейств (`/^(qwen|glm|deepseek|kimi|minimax)/i` минус `/(^wan|image|audio|tts|asr|realtime|video|embed|rerank|ocr)/i`), `toModelConfig`, `unverifiedModel`, `verifiedOverride`, `VERIFIED_OVERRIDES` и порядок источников `каталог → override → прошлый снимок → заглушка`. Добавить `CATALOG_URLS` (четыре адреса из Global Constraints, personal перед team), штамповку `provider`/`api`/`type`/`baseUrl` в `buildModels` и `timeoutMs` в `fetchCatalogModels`. Каталоги опрашивать одновременно (`Promise.all` с индивидуальным `catch`), чтобы четыре адреса не замедляли обновление против двух.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Закоммитить**

```bash
git add src/catalog.js test/catalog.test.mjs
git commit -m "feat: model metadata from catalogs with verified overrides"
```

---

### Task 4: Живой список моделей и перенос прежнего снимка

**Files:**
- Create: `src/models.js`
- Test: `test/models.test.mjs`

**Interfaces:**
- Consumes: `fetchCatalogModels`, `buildModels` (Task 3); `baseUrlFor` (Task 1).
- Produces: `REFRESH_INTERVAL_MS = 900000`, `REQUEST_TIMEOUT_MS = 6000`, `fetchLiveIds({ baseUrl, apiKey, signal, fetchImpl }): Promise<string[]>`, `isFresh(stored, now = Date.now()): boolean`, `readLegacyCache({ agentDir }): object[] | undefined`, `loadModels({ baseUrl, apiKey, providerId, signal, fetchImpl, previousModels, legacyModels }): Promise<object[]>`.

- [ ] **Step 1: Написать падающие тесты списка**

`test/models.test.mjs`:
- `fetchLiveIds` возвращает id из `{ data: [{ id }] }`; ответ `{ data: [] }` → `rejects`; ответ 401 → `rejects` со статусом; ответ с `content-type: text/html` и телом `<html>…` → `rejects`, а не `SyntaxError` наружу (Review Focus 2).
- `isFresh({ checkedAt: now - 1000 }, now) === true`; `isFresh({ checkedAt: now - REFRESH_INTERVAL_MS - 1 }, now) === false`; `isFresh(undefined, now) === false`; `isFresh({}, now) === false`.
- `loadModels` с живыми `["qwen4-max-preview","qwen-image-3.0-pro"]` и недоступными каталогами → одна модель qwen4 с лимитами из Global Constraints.
- `loadModels` при падении `fetchLiveIds` реджектит и не возвращает пустой массив.
- `readLegacyCache` читает `models` из временного `agentDir/extensions/alibaba-token-plan/models-cache.json`; отсутствующий файл → `undefined`; битый JSON → `undefined`; запись без `contextWindow` отброшена.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/models.test.mjs`
Expected: FAIL — `Cannot find module '../src/models.js'`.

- [ ] **Step 3: Реализовать `src/models.js`**

`fetchLiveIds`: `GET ${baseUrl}/models`, `authorization`/`accept`, таймаут `REQUEST_TIMEOUT_MS` через `AbortSignal.any`; `!ok` → ошибка со статусом; разбор JSON в `try/catch` → ошибка «unexpected response»; пустой список → ошибка. `loadModels`: живые id → `fetchCatalogModels` → `buildModels` с `previousModels: previousModels?.length ? previousModels : legacyModels ?? []`. `readLegacyCache` только читает, ничего не пишет и не удаляет.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Закоммитить**

```bash
git add src/models.js test/models.test.mjs
git commit -m "feat: live model list with one-time legacy snapshot migration"
```

---

### Task 5: Регистрация провайдера в pi

**Files:**
- Create: `extensions/index.js`
- Modify: `test/package.test.mjs` (добавить проверку существования файлов из `pi.extensions`)
- Test: `test/extension.test.mjs`

**Interfaces:**
- Consumes: `createApiKeyAuth` (Task 2), `loadModels`/`isFresh`/`readLegacyCache`/`REFRESH_INTERVAL_MS` (Task 4), `resolveRegion`/`baseUrlFor`/`REGION_ENV`/`DEFAULT_REGION` (Task 1).
- Produces: `export default function register(pi)` — регистрирует один native-провайдер `alibaba-openai`.

- [ ] **Step 1: Написать падающие тесты регистрации**

`test/extension.test.mjs`: фейковый `pi` собирает вызовы `registerProvider`; вызов `register(pi)` даёт один провайдер с `id === "alibaba-openai"`, `name === "Alibaba Token Plan"`, `auth.apiKey.login` — функция, `getModels()` — пустой массив до первого refresh.
- `provider.refreshModels({ stored: { models: [модель с provider "alibaba-openai"], checkedAt: Date.now() }, allowNetwork: false, signal, publish })` → `publish` вызван с `update`, после чего `getModels()` содержит восстановленную модель; сеть не вызывалась.
- свежий снимок (`checkedAt: Date.now()`) и `allowNetwork: true` → `fetchImpl` не вызывался (TTL соблюдён).
- устаревший снимок (`checkedAt: Date.now() - REFRESH_INTERVAL_MS - 1`), `allowNetwork: true`, credential `{ key:"k", env:{ ALIBABA_TOKEN_PLAN_REGION:"cn" } }` → запрос ушёл на пекинский URL, `publish` вызван с `persist.models` и `persist.checkedAt`.
- `force: true` со свежим снимком → запрос всё равно ушёл.
- внедрение `fetchImpl`/`agentDir`: `register(pi, { fetchImpl, agentDir })` — второй необязательный параметр только для тестов, по умолчанию реальные `fetch` и `~/.pi/agent`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/extension.test.mjs`
Expected: FAIL — `Cannot find module '../extensions/index.js'`.

- [ ] **Step 3: Реализовать `extensions/index.js`**

Импорты: `createProvider` из `@earendil-works/pi-ai`, `openAICompletionsApi` из `@earendil-works/pi-ai/api/openai-completions.lazy` (без `.js`, проверено), остальное из `../src/*.js`.
`createProvider({ id: "alibaba-openai", name: "Alibaba Token Plan", baseUrl: baseUrlFor(DEFAULT_REGION), auth: { apiKey: createApiKeyAuth({ fetchImpl }) }, models: [], fetchModels, api: openAICompletionsApi() })`.
`fetchModels(context)`: регион = `resolveRegion(context.credential?.env?.[REGION_ENV] ?? process.env[REGION_ENV])`; `baseUrl = baseUrlFor(region)` (**не** `context.baseUrl` — он всегда Singapore); ключ = `context.credential?.key ?? process.env[API_KEY_ENV]`, без ключа → `throw new Error("No Token Plan API key. Run /login alibaba-openai")`; `loadModels({ baseUrl, apiKey, providerId: "alibaba-openai", signal: context.signal, fetchImpl, previousModels: context.stored?.models, legacyModels: readLegacyCache({ agentDir }) })`.
TTL-обёртка: сохранить `const base = provider.refreshModels`, заменить на `(context) => base(isFresh(context.stored) && !context.force ? { ...context, allowNetwork: false } : context)` — pi сам восстанавливает снимок и персистит результат.
`pi.registerProvider(provider)`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Проверить регистрацию и живой ответ в настоящем pi, без установки**

Run: `cd /Users/salesao/Desktop/worksApp && pi -ne -e ./pi-alibaba-token-plan --list-models alibaba`
Expected: строки `alibaba-openai` с `qwen4-max-preview 1M 393.2K yes`. `-ne` отключает обнаружение расширений, поэтому прежнее ручное подключение не конфликтует по id.
Run: `pi -ne -e ./pi-alibaba-token-plan -p --no-session --model alibaba-openai/qwen4-max-preview:xhigh "What is 17*23? Reply with just the number."`
Expected: `391`. Это та живая проверка, после которой Task 6 имеет право удалить прежнее подключение (D4).

- [ ] **Step 6: Закоммитить**

```bash
git add extensions/index.js test/extension.test.mjs test/package.test.mjs
git commit -m "feat: register native provider with pi-owned catalog persistence"
```

---

### Task 6: Документация, переезд документов и живая проверка

**Files:**
- Create: `README.md`, `README.ru.md`
- Delete: `~/.pi/agent/extensions/alibaba-token-plan/` (после успешной проверки, без резервной копии — D4)

**Interfaces:**
- Consumes: рабочий пакет из Task 5.
- Produces: установленный локально пакет и удалённое прежнее расширение.

- [ ] **Step 1: Написать README на двух языках**

Оба файла: что это, установка `pi install git:github.com/Salesao/pi-alibaba-token-plan`, вход `/login alibaba-openai` (выбор Singapore или China (Beijing), ключ из консоли Token Plan), альтернатива через `ALIBABA_API_KEY` и `ALIBABA_TOKEN_PLAN_REGION`, список моделей берётся из подписки, `pi update --models` обновляет его принудительно, thinking-уровни `low|medium|xhigh` (`:xhigh`), предупреждение про превью `qwen4-max-preview` до 2026-11-25, раздел «как это работает» (живой список + справочник лимитов + своя таблица), MIT. Ключ и токены в примерах — только заглушки.

- [ ] **Step 2: Установить пакет локально и проверить вживую**

Предусловие: живая проверка из Task 5 Step 5 прошла (D4 — удаление только после неё).
Run: `pi install /Users/salesao/Desktop/worksApp/pi-alibaba-token-plan`
Затем удалить прежнее ручное расширение: `rm -rf ~/.pi/agent/extensions/alibaba-token-plan` (D4 — без копии; ключ в `auth.json` не трогать).
Run: `pi --list-models alibaba` → models есть, `qwen4-max-preview 1M 393.2K yes`.
Run: `pi -p --no-session --model alibaba-openai/qwen4-max-preview:xhigh "What is 17*23? Reply with just the number."` → `391`.
Run: `pi -p --no-session --mode json --model alibaba-openai/qwen4-max-preview:xhigh "In one short sentence: why is the sky blue?"` → в ассистентском сообщении есть блок `thinking` и `usage.reasoning > 0`.
Expected: все четыре проверки прошли. Если любая провалилась — прежнее расширение уже удалено, поэтому чинить пакет, а не откатывать (D4).

- [ ] **Step 3: Проверить вход через `/login` вживую**

Run: интерактивный `pi`, `/login alibaba-openai`, выбрать Singapore, вставить действующий ключ, убедиться, что вход прошёл; затем `/login alibaba-openai` с намеренно неверным ключом → сообщение про регион/ключ, запись в `auth.json` не изменилась.
Expected: рабочий ключ сохранён, неверный отклонён.

- [ ] **Step 4: Закоммитить**

```bash
git add README.md README.ru.md
git commit -m "docs: bilingual readme with install and login guide"
```

---

### Task 7: Публикация на GitHub и установка по ссылке

**Files:**
- Modify: `package.json` (только если проверка манифеста потребует правок)

**Interfaces:**
- Consumes: проверенный пакет из Task 6.
- Produces: открытый репозиторий `Salesao/pi-alibaba-token-plan` и установка из него.

- [ ] **Step 1: Создать репозиторий и запушить**

```bash
cd /Users/salesao/Desktop/worksApp/pi-alibaba-token-plan
gh repo create Salesao/pi-alibaba-token-plan --public --source=. --remote=origin --description "Alibaba Model Studio Token Plan provider for Pi: /login with region selection and live model catalog" --push
```

- [ ] **Step 2: Убрать локальную установку и поставить по ссылке**

Run: `pi remove /Users/salesao/Desktop/worksApp/pi-alibaba-token-plan`
Run: `pi install git:github.com/Salesao/pi-alibaba-token-plan`
Expected: в `~/.pi/agent/settings.json` в `packages` появилась git-запись, локальной нет.

- [ ] **Step 3: Проверить установленный из git пакет**

Run: `pi --list-models alibaba` → модели на месте.
Run: `pi -p --no-session --model alibaba-openai/qwen4-max-preview:xhigh "Reply with exactly: OK"` → `OK`.
Run: `pi update --extensions` → без ошибок.
Expected: всё прошло; прежний `defaultProvider: alibaba-openai` и `defaultModel` работают без правки настроек.

- [ ] **Step 4: Закоммитить финальное состояние, если были правки**

```bash
git status --porcelain
git add -A && git commit -m "chore: finalize published package" && git push
```
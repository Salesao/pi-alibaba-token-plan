# pi-alibaba-token-plan — дизайн

Дата: 2026-11-14
Статус: на утверждении (после блица, раунд 1)
Язык решений: пользователь — Salesao; остальное — предложения исполнителя

## Реестр решений

| ID | Решение | Раздел | Статус |
|----|---------|--------|--------|
| D1 | Масштаб: провайдер для любого Token Plan, не только Singapore (вариант B) | Подходы | user-approved |
| D2 | Публикация: открытый репозиторий на GitHub, пуш сразу; npm вне этого захода | Публикация | user-approved (блиц 1) |
| D3 | Ключ проверяется при входе; неподходящий не сохраняется | Auth | user-approved (блиц 2) |
| D4 | Прежнее локальное расширение удаляется совсем, без резервной копии | Миграция | user-approved (блиц 3) |
| D5 | Метаданные: каталоги pi.dev + собственная таблица override | Модели | user-approved (блиц 4) |
| D6 | Форма проекта: копия раскладки `pi-task`, plain JS, MIT, README + README.ru | Форма проекта | author-proposed |
| D7 | Provider id остаётся `alibaba-openai` | Провайдер | author-proposed |
| D8 | Регион по умолчанию — Singapore, env-fallback `ALIBABA_API_KEY` | Auth | author-proposed |
| D9 |Native-форма провайдера; каталог персистит pi, свой файл кэша удаляется | Провайдер, Модели | author-proposed |
| D10 | Старый снимок моделей читается один раз при отсутствии pi-шного | Миграция | author-proposed |
| D11 | Установка пакета по git-ссылке, не по локальному пути | Публикация | author-proposed |
| D12 | Каталог проекта `~/Desktop/worksApp/pi-alibaba-token-plan`, репо `Salesao/pi-alibaba-token-plan` | Форма проекта | author-proposed |
| D13 | Этот документ переезжает в новый репозиторий первым коммитом | Форма проекта | author-proposed |

## Зачем

Сейчас провайдер Alibaba Model Studio Token Plan живёт одним файлом, вложенным руками в
`~/.pi/agent/extensions/alibaba-token-plan/index.ts`. Его нельзя ни обновить, ни отдать другому
человеку: любое изменение — правка локального файла, а кэш лежит внутри папки расширения.

Нужен самостоятельный репозиторий-пакет: ставится через `pi install`, обновляется через
`pi update --extensions`, подключается через `/login`, и подходит любому владельцу Token Plan —
не только Singapore-плана, как сейчас.

## Цели

- Отдельный проект `pi-alibaba-token-plan`, установка `pi install git:github.com/Salesao/pi-alibaba-token-plan`.
- `/login` → выбор региона → вставка ключа → ключ в `~/.pi/agent/auth.json`.
- Живой список моделей плана + корректные лимиты и thinking (включая `qwen4-max-preview`).
- Офлайн-старт и `pi -p` работают без сети.
- Существующая настройка Salesao не ломается: `defaultProvider: alibaba-openai` и история сессий остаются валидными.

## Не-цели

- OAuth: у Token Plan только API-ключ, аккаунт-логина не существует.
- Pay-as-you-go эндпоинты DashScope, Coding Plan, image/audio/video модели.
- Свой стриминг: протокол — обычный OpenAI Chat Completions, используем встроенный.
- Публикация в npm: в блице выбран только GitHub (D2). Вернуться к npm можно отдельным решением.

## Анти-цели (провал, даже если формально работает)

- Пакет пишет внутрь своей установочной папки.
- Ключ или ответы провайдера попадают в логи.
- Пустой или неудачный ответ `/models` стирает известный список моделей.
- Переезд ломает текущий default-модель или требует ручной правки `settings.json`.

## Проверенные факты (recon)

- `/login` **уже работает** и сейчас: pi достраивает API-key логин любому провайдеру с
  `apiKey: "$ENV"`. Проверено вживую: `/login alibaba` → «Alibaba Token Plan [API key] ✓ env:
  ALIBABA_API_KEY» → «Enter API key». Отдельная работа нужна не для самого факта логина, а для
  выбора региона.
- Token Plan имеет ровно два эндпоинта (docs «Base URL overview», intl и CN сайты):
  - Singapore: `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
  - China (Beijing): `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- «API Keys are region-specific»: ключ не того региона даёт 401. Значит регион — часть credential,
  а не глобальная настройка.
- `GET /models` возвращает только `id` (проверено живым ключом: 21 модель, из них 14 чатовых).
  Ни лимитов, ни thinking там нет — метаданные приходится брать извне.
- Каталоги pi.dev (`qwen-token-plan`, `-individual`, `-cn`, `-individual-cn`) описывают **другой
  домен** (`token-plan.maas.qwencloudapi.com` / `qianwenaiapi.com`). Используем их только как
  справочник лимитов; запросы всегда идут на aliyuncs.com.
- В каталогах pi.dev нет `qwen4-max-preview`, поэтому нужен локальный override: 1M контекст,
  393 216 выход (общий с thinking), thinking по умолчанию, `low|medium|xhigh`.
- У native-провайдера pi **сам хранит каталог**: `refreshModels(context)` получает
  `context.stored` и публикует через `context.publish({ persist, update })` в
  `~/.pi/agent/models-store.json`. Свой файл кэша не нужен.
- `pi -p` вызывает refresh с `allowNetwork: false` — список обязан браться из сохранённого каталога.

## Подходы

- **A. Упаковать как есть.** Один регион, legacy-форма, свой файл кэша. Быстро, но пакет полезен
  только владельцам Singapore-плана. Отклонён пользователем.
- **B. Native-провайдер с выбором региона при логине.** `ApiKeyAuth.login` спрашивает регион и ключ,
  `resolve()` возвращает `baseUrl` под сохранённый регион; каталог персистит pi. Выбран (D1).
- **B'. Legacy + два id** (`alibaba-openai` и `alibaba-openai-cn`). Проще, но удваивает список
  моделей, требует двух логинов и двух записей в auth.json. Отклонён: per-credential `baseUrl`
  в native-форме решает то же самое чище.
- **Только `models.json`.** Не умеет ни живое обнаружение моделей, ни логин. Отклонён.

## Публикация (D2, D11, D12)

Проект создаётся в `~/Desktop/worksApp/pi-alibaba-token-plan`, публикуется как открытый репозиторий
`Salesao/pi-alibaba-token-plan` (`gh repo create`, пуш сразу после живой проверки). Установка —
`pi install git:github.com/Salesao/pi-alibaba-token-plan`, обновления — `pi update --extensions`.
npm в этот заход не публикуется.

## Форма проекта (D6, D12, D13)

Копия раскладки `pi-task`: plain JS без сборки, `extensions/index.js` + `src/*.js`, тесты
`node --test test/*.test.mjs`, MIT, `README.md` + `README.ru.md`, `keywords: ["pi-package"]`,
`pi.extensions: ["./extensions/index.js"]`. Хостовые пакеты — в `peerDependencies` (`"*"`),
не в `dependencies`. Импорт из `@earendil-works/…` (текущие имена). Этот документ переезжает
в новый репозиторий первым коммитом.

## Провайдер (D7, D9)

`pi.registerProvider(provider)` — native `Provider` из `@earendil-works/pi-ai`:
id `alibaba-openai` (совместимость), name «Alibaba Token Plan», `api: openai-completions`.

## Auth (D3, D8)

`auth.apiKey`:
- `login`: `select` региона (Singapore / China (Beijing)) → `secret` ключ → проверочный
  `GET /models`; 401 → понятная ошибка «ключ от другого региона», без сохранения →
  credential `{ type: "api_key", key, env: { ALIBABA_TOKEN_PLAN_REGION: "sg" | "cn" } }`.
- `resolve`: ключ = `credential.key ?? $ALIBABA_API_KEY`; регион = `credential.env ?? $ALIBABA_TOKEN_PLAN_REGION ?? "sg"`;
  возвращает `{ auth: { apiKey, baseUrl } }`.
- `check`: наличие ключа, без сетевых вызовов.

## Модели (D5, D9)

`refreshModels`: восстановить `context.stored`; если сеть разрешена и снимок старше
15 минут — `GET {baseUrl}/models` (таймаут 6 с, `context.signal`), обогатить метаданными из
каталогов pi.dev, затем `VERIFIED_OVERRIDES`, затем прошлый снимок; незнакомые чатовые id —
консервативная заглушка. Публикация через `publish({ persist, update })`. Пустой ответ — ошибка,
список не стирается. Фильтры семейств (`qwen|glm|deepseek|kimi|minimax`, минус image/audio/video/…),
`cost: 0` (подписка), `BASE_COMPAT` (`max_completion_tokens`, без developer role и store) — как сейчас.

## Миграция (D4, D10)

Старый `extensions/alibaba-token-plan/models-cache.json` читается один раз, если pi-шного снимка
ещё нет; после первой успешной публикации не используется. Локальное расширение
`~/.pi/agent/extensions/alibaba-token-plan/` **удаляется совсем** после живой проверки пакета —
без резервной копии (решение пользователя в блице; в раунде 1 заменено предложение оставить копию).
Ключ в `auth.json` не трогается: id провайдера прежний, повторный вход не требуется.

## Что остаётся исполнителю

Формулировки промптов логина, разбивка `src/` на модули, состав тестов (минимум: выбор региона,
resolve по регионам, обогащение метаданными, override qwen4, фильтр не-чатовых, пустой ответ,
офлайн-восстановление, отмена логина, отказ сохранения при 401), тексты README.

## Журнал блица

Раунд 1: спрошены 1 Публикация, 2 Ключ, 3 Резерв, 4 Лимиты. Изменено 3 Резерв — прежнее ручное
подключение удаляется совсем, без резервной копии; закреплены публикация в открытый GitHub-репозиторий
без npm, проверка ключа при входе и справочник лимитов вместе с собственной таблицей.
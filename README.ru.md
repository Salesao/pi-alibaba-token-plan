# pi-alibaba-token-plan

Подписка **Alibaba Model Studio Token Plan** как провайдер Pi или OMP (`omp`): вход через `/login`,
выбор региона покупки и список моделей самой подписки с правильными лимитами контекста и thinking.

Поддержаны оба адреса Token Plan — Сингапур (международный) и Китай (Пекин). Ключи привязаны к
региону, поэтому регион хранится вместе с ключом.

## Установка

Pi:

```bash
pi install npm:pi-alibaba-token-plan
# или прямо из репозитория
pi install git:github.com/Salesao/pi-alibaba-token-plan
```

OMP:

```bash
omp plugin install pi-alibaba-token-plan
# или прямо из репозитория
omp plugin install git:github.com/Salesao/pi-alibaba-token-plan
```

Пакет объявляет одну точку расширения; она определяет хост и использует его API провайдеров
(`createProvider` в Pi, `registerProvider(id, config)` в OMP).

## Откуда берётся ключ

Подписка Token Plan живёт в консоли Alibaba Cloud Model Studio —
[modelstudio.console.alibabacloud.com](https://modelstudio.console.alibabacloud.com/).
Откройте страницу подписки своего региона и скопируйте её специальный API-ключ:

| Регион | Страница консоли |
|---|---|
| Сингапур (международный) | [Token Plan Personal](https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/token-plan/personal) |
| Китай (Пекин) | [Token Plan](https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan) |

В той же консоли видно, какие модели доступны вашей подписке. Обычный pay-as-you-go ключ DashScope здесь не работает.

## Вход

```text
/login alibaba-openai
```

1. Выберите **Singapore (International)** или **China (Beijing)** — тот регион, что указан в консоли Token Plan.
2. Вставьте ключ Token Plan (специальный ключ подписки, не pay-as-you-go ключ DashScope).

Ключ проверяется на выбранном регионе до сохранения. Ключ другого региона отклоняется с понятным
сообщением, и ничего не записывается. Ключи хранятся в `~/.pi/agent/auth.json` в Pi и
`~/.omp/agent/auth.json` в OMP.

Предпочитаете переменные окружения? Обе читаются, если сохранённого ключа нет:

```bash
export ALIBABA_API_KEY=sk-sp-ваш-ключ
export ALIBABA_TOKEN_PLAN_REGION=sg   # sg (по умолчанию) или cn
```

## Использование

```bash
pi --model alibaba-openai/qwen4-max-preview:xhigh
omp --model alibaba-openai/qwen4-max-preview:xhigh
```

Уровни thinking у `qwen4-max` — `low`, `high` и `xhigh`: только значения, которые документирует
Alibaba; выключить thinking нельзя. Контекст модели — 1M, бюджет вывода — 262 144 токена.
У `qwen4-max-preview` контекст 1M и бюджет вывода 393 216 токенов, общий для thinking и ответа;
уровни — `low`, `medium` и `xhigh`: просите `:xhigh`, а не `:high`. Это **превью**: Alibaba
отключает модель после 25.11.2026.

## Как устроен список моделей

- Id моделей приходят из `GET /models` самой подписки, поэтому новые модели появляются без обновления пакета.
- В этом ответе только id. Лимиты контекста, уровни thinking и типы входа берутся из открытых
  каталогов pi.dev для провайдеров Qwen Token Plan, а для моделей, которых там ещё нет, — из
  небольшой проверенной таблицы внутри пакета.
- Полученный каталог pi хранит в `~/.pi/agent/models-store.json` — именно его используют офлайн-запуски
  и `pi -p`. Список обновляется при интерактивном запуске, не чаще раза в 15 минут.
- OMP хранит каталог в своём кеше моделей (TTL 24 часа). Принудительное обновление — `omp models refresh`.
  В OMP регион недоступен при обнаружении моделей, поэтому ключ из Китая определяется одним пробным
  запросом к другому эндпоинту (`ALIBABA_TOKEN_PLAN_REGION=cn` отключает пробу).
- Логин обновляет его сразу, независимо от окна: `/login` (интерактивно) и `pi auth login`
  запускают сетевой refresh сразу после сохранения ключа.
- В OMP `/login alibaba-openai` спрашивает регион номером варианта (в OMP нет select-подсказки),
  а затем проверяет ключ на этом регионе так же, как Pi.
- **Первый запуск:** каталог загружается самим логином. До этой загрузки хранить нечего,
  поэтому `pi --list-models` и `pi -p` не показывают моделей этого провайдера. (`pi update --models`
  обновляет только встроенные каталоги pi, не провайдеры-расширения.)
- Неудачный или пустой ответ никогда не стирает уже имеющийся каталог.

В списке только чатовые модели. Модели картинок, видео и звука из подписки отфильтрованы.
Стоимость показывается нулевой: подписка, а не оплата за токены.

## Разработка

```bash
npm install   # ставит хостовые SDK-зависимости для тестов
npm test
```

Попробовать без установки: `pi -ne -e ./extensions/index.js --list-models alibaba`
(`-ne` отключает обнаружение расширений, поэтому вручную вложенная копия не конфликтует по id провайдера).
В OMP: `omp --no-session -e ./extensions/index.js --model alibaba-openai/qwen4-max-preview "hi"`.

## Лицензия

MIT
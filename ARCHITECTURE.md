# Архітектура

Хоррор-вікторина «Відріжу по цю риску!» — гра для компанії: великий екран (ТВ)
+ телефони гравців, зв'язок через Socket.IO у реальному часі.

```
┌─────────────┐        websocket         ┌──────────────────┐        websocket        ┌─────────────┐
│  Телефон 1  │ ───────────────────────▶ │                  │ ◀────────────────────── │   Дисплей   │
│  Телефон 2  │ ───────────────────────▶ │  Socket.IO :3001 │ ──────────────────────▶ │  (ТВ/екран) │
│   ...  (8)  │                          │   in-memory Map  │                         │  відео/звук │
└─────────────┘                          └──────────────────┘                         └─────────────┘
      React (client/)                      Node + Express (server/)                      React (client/)
```

Один React-бандл (`client/src/App.js`) працює у двох ролях, які визначаються
`isMobile()` (ширина ≤ 768px або мобільний user-agent):

| Роль | Що робить |
|------|-----------|
| **Дисплей** (`createRoom`, `socket.isDisplay`) | Показує код кімнати, програє **весь звук і відео**, керує переходами фаз через події `*Done` |
| **Гравець** (`joinRoom`) | Вводить код, відповідає на питання, грає в міні-ігри. **Повністю без звуку.** Перший, хто зайшов, — `isAdmin` |
| **Сервер** | Тримає весь стан у пам'яті, рахує бали й життя, читає питання з JSON, вирішує міні-ігри. Рестарт = всі кімнати втрачені |

**Звук.** Усі `<audio>`-елементи в `App.js` рендеряться лише коли `!isMobile()`
(тобто на дисплеї). Плюс явні перевірки `if (isMobile()) return` у обробниках
`answerBeep` та звуку результату раунду. Відео з озвучкою (`IntroScene`,
`TrueFalseMinigame` display-режим, `TrueFalseAftermath`, фонові відео) рендеряться
теж лише на дисплеї. На телефоні — тиша.

---

## Сервер (`server/`)

Розбитий на модулі з чіткою відповідальністю. Ніяких глобальних змінних —
`io` передається через фабрики.

| Файл | Відповідальність |
|------|------------------|
| `server.js` | Тільки bootstrap: express, http, io, статика, `listen` |
| `config.js` | Усі константи й env (порт, таймери, `TOTAL_ROUNDS`, `LIVES_PER_PLAYER`, `GAME_STATE`) |
| `rooms.js` | `rooms` Map, фабрика кімнати, `addPlayer`, серіалізація гравця для дроту, очищення таймерів |
| `questions.js` | Колоди питань: `roundN.json` → фільтр за складністю → перемішана колода (crypto) → одне питання за гру |
| `phases.js` | **Машина фаз** — фабрика `(io) => { ... }`. Уся ігрова логіка тут |
| `handlers.js` | Прив'язка Socket.IO-подій. Тільки валідація сокета + виклик `phases` |
| `minigames/index.js` | **Реєстр міні-ігор**: `selectForRound(roundIndex)` вирішує, яка міні-гра після якого раунду |
| `minigames/trueFalse.js` | Правила «Правда/Брехня»: хто змагається і хто втрачає життя (чисті функції) |

### Машина фаз

**9 раундів вікторини**, потім **фінальна битва**.

```
WAITING
  │  startIntro (адмін) → showIntro → IntroScene → rulesmovie (дисплей)
  │  introEnded / startGame → phases.startGame()
  ▼
QUESTION_ANNOUNCE  emit "questionAnnounce"
  │  раунди 1-2: власне відео-інтро (introround1/2.mp4)
  │  раунди 3-9: напис «РАУНД N» (компонент RoundIntro) ~3.2с
  │  дисплей: "questionAnnounceDone" → emitQuestionPlay()
  ▼
QUESTION_PLAY  emit "questionPlay" (текст + аудіо + відео)
  │  раунд 1: фіксований таймер 6с → startAnswerPhase()
  │  раунди 2-9: "questionPlayDone" → startAnswerPhase()
  ▼
ANSWER_PHASE  emit "answerPhase" + таймер 15с
  │  усі відповіли АБО таймаут → checkAnswers() → emitScores()
  ▼
SCORES  emit "scores"; armMinigame() створює контест, якщо ≥2 гравці помилились
  │  дисплей: "scoresDone" → handleScoresDone():
  │     • міні-гра очікує   → startMinigame()  → "trueFalseStart"
  │     • міні-гра зіграна  → чекаємо "trueFalseResultsSceneDone" → знімаємо життя
  │     • міні-гри немає    → advanceRound()
  ▼
… цикл × 9 раундів
  ▼
FINAL_BATTLE  emit "finalBattle" (заглушка: напис «ФІНАЛЬНА БИТВА»)
  │  дисплей: "finalBattleDone" АБО серверний fallback-таймер → finishGame()
  ▼
FINISHED  emit "gameFinished"
```

### Міні-ігри після кожного раунду

Після **будь-якого** раунду `emitScores()` → `armMinigame()`:
`minigames.selectForRound(roundIndex)` повертає **список кандидатів** у порядку
пріоритету; `phases.js` запускає першу, чий `buildContest()` поверне контест
(тобто чия умова спрацювала). Якщо жодна — міні-гри цього раунду немає.

**3 міні-ігри, ротація по раундах** (`minigames/index.js` `ROTATION`):

| Раунд | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|-------|---|---|---|---|---|---|---|---|---|
| Основна | Правда/Брехня | Матем-Раш | КНП | Правда/Брехня | Матем-Раш | КНП | … | … | … |

Матем-Раш додається як **фолбек** до кожного раунду (спрацьовує від «≥1 помилки»),
тому міні-гра завжди буде, якщо хоч хтось помилився.

| Міні-гра | Модуль | Тригер | Хто грає | Втрата життя |
|----------|--------|--------|----------|--------------|
| **Правда/Брехня** | `trueFalse.js` | ≥2 помилились | тільки ті, хто помилився | всі з мін. балом (нічия → кілька) |
| **Матем-Раш** | `mathRush.js` | ≥1 помилився | **усі** | один — найнижчий бал (тайбрейк: темп → точність → час → id) |
| **Камінь-Ножиці-Папір** | `rps.js` | ≥2 помилились | тільки ті, хто помилився | один — хто вилетів **останнім** |

**Матем-Раш** (server-authoritative): сервер генерує спільний пул рівнянь
(`+`/`-`, 4 варіанти, один правильний), валідує кожну відповідь, веде бали й
годинник. Гравці, що помилились у питанні, отримують шанс урятуватись — якщо
хтось із них не найгірший у Матем-Раші, життя втрачає справжній аутсайдер.
Числа й таймінги налаштовуються env: `MATH_RUSH_MIN`, `MATH_RUSH_MAX`,
`MATH_RUSH_PLAY_MS` (вікно гри, 30с), `MATH_RUSH_PREP_MS` (час на читання
інструкції + 3-2-1, зараз **11с** — цифра показується лише останні 3с).

**Камінь-Ножиці-Папір** (server-authoritative): вибори приховані до розкриття,
таймаут → випадковий вибір. Розкриття раунду (`resolveRoundOutcome`):
1 різний вибір або всі 3 → нічия, переграємо; 2 різних → далі йдуть тільки ті,
хто обрав виграшний варіант. Проміжні вибулі **життя не втрачають** — тільки
останній вибулий (той раунд, що залишив 1 гравця). Нічия останнього раунду →
тайбрейк: хто не обрав (авто) → хто обрав пізніше → більший id. env:
`RPS_CHOICE_MS` (вибір за раунд), `RPS_REVEAL_MS`, `RPS_PREP_MS` (інструкція + 3-2-1, зараз **11с**).

> Інструкція кожної нової міні-гри показується на екрані під час `PREP_MS`;
> велика цифра відліку з'являється лише коли лишається ≤ 3 с. Щоб змінити час на
> читання — `MATH_RUSH_PREP_MS` / `RPS_PREP_MS` (мс) або константа `PREP_MS` у модулі.

**Інтерфейс модуля міні-гри** (усі поля крім `ID`/`TOTAL_DURATION_MS`/`buildContest`/`resolveLosers` — опційні):

```
ID, TOTAL_DURATION_MS                        // серверний hard-stop
buildContest({players, correctIndex, roundIndex}) -> contest | null
onStart(mg, ctx)                             // підготувати стан
onSync(mg, serverNowTs, ctx)                 // спільний годинник прийшов — старт геймплею
onClientEvent(mg, playerId, name, data, ctx) // подія від гравця (minigameEvent)
resolveLosers(mg) -> playerId[]              // хто втрачає життя
buildResults(mg) -> {...}                    // додаткові поля у trueFalseResults
clientScored: true                           // (тільки Правда/Брехня) телефон рахує сам
```
`ctx` = `{ now, players, emitAll, emitPlayer, setTimer, scheduleResolve, resolveNow }`.

**Щоб додати ще одну:** файл у `server/minigames/` + рядок у `ROTATION`/`selectForRound`;
компонент у `client/src/components/` + рядок у `MINIGAME_COMPONENTS`
(`client/src/components/MinigameHost.jsx`).

### Події Socket.IO

| Подія | Напрям | Призначення |
|-------|--------|-------------|
| `createRoom` / `joinRoom` | → срв (з callback) | Створити / зайти в кімнату |
| `startIntro` / `startGame` / `introEnded` | адмін/дисплей → срв | Запуск гри |
| `skipRules` / `rulesStarted` | обидва боки | Керування відео правил |
| `questionAnnounceDone` / `questionPlayDone` / `scoresDone` | дисплей → срв | Рукостискання фаз (відео завершилось) |
| `answer` | телефон → срв | `{ answerIndex }` |
| `trueFalseSync` | дисплей ↔ срв | Спільний годинник для будь-якої міні-гри |
| `trueFalseScore` | телефон → срв | Фінальний бал (тільки Правда/Брехня) |
| `minigameEvent` | телефон → срв | `{ name, data }` — дії в server-authoritative міні-грах (`mathRush:answer`, `rps:choose`) |
| `trueFalseResultsSceneDone` | дисплей → срв | Сцена підсумку завершилась → зняти життя |
| `finalBattleDone` | дисплей → срв | Заглушка фінальної битви завершилась → `gameFinished` |
| `trueFalseStart` `trueFalseResults` | срв → усі | Старт / підсумок міні-гри (payload має `minigameId`) |
| `mathRush:go` `mathRush:question` `mathRush:scores` | срв → (усі / гравцю) | Геймплей Матем-Раш |
| `rps:go` `rps:round` `rps:locked` `rps:progress` `rps:reveal` | срв → (усі / гравцю) | Геймплей КНП |
| `showIntro` `questionAnnounce` `questionPlay` `answerPhase` `scores` `playersUpdate` `finalBattle` `gameFinished` `answerBeep` | срв → усі | Стан гри |

> Канал старту/підсумку міні-гри поки що зветься `trueFalseStart` / `trueFalseResults`
> (історично) — payload містить `minigameId`, за яким `MinigameHost` вибирає компонент.

---

## Клієнт (`client/src/`)

| Файл | Роль |
|------|------|
| `App.js` | Уся клієнтська логіка: сокети, роутинг екранів, рендер усіх фаз, оркестрація відео/аудіо, debug-режими |
| `game/constants.js` | `GAME_PHASE` — дзеркало `server/config.js` `GAME_STATE`; `TOTAL_ROUNDS` |
| `components/MinigameHost.jsx` | **Одна точка вибору** компонента міні-гри за `minigameId` |
| `components/RoundIntro.jsx` | Напис «РАУНД N» / «ФІНАЛЬНА БИТВА» (заглушка замість відео) |
| `components/TrueFalseMinigame.jsx` | «Правда/Брехня» (режими `mobile` / `display`), клієнт рахує сам |
| `components/TrueFalseAftermath.jsx` | Сцена після «Правда/Брехня»: `aftermg.mp4` + таблиця + анімація втрати життя |
| `components/MathRushMinigame.jsx` | «Матем-Раш»: рівняння + 4 кнопки, лайв-таблиця, екран підсумку |
| `components/RockPaperScissorsMinigame.jsx` | «Камінь-Ножиці-Папір»: вибір, розкриття, елімінація, екран підсумку |
| `components/IntroScene.jsx` | Кінематографічне інтро по кожному гравцю |
| `components/TypewriterSubtitles.jsx` | Друкований текст питання |
| `components/HorrorTimer.jsx` | Таймер фази відповіді |
| `components/FireTitle.jsx` | Вогняний текст коду кімнати |

Екран підсумку «Матем-Раш» / «КНП» рендериться всередині самого компонента
(і на дисплеї, і на телефоні). «Правда/Брехня» має окремий `TrueFalseAftermath`.

> `App.js` (~1600 рядків) і `App.css` (~3200 рядків) — наступний кандидат на
> розбиття (окремі контейнери екранів + хук `useGameSocket`). Свідомо відкладено,
> щоб не зачепити тонку логіку таймінгів відео перед тестуванням.

### Debug-параметри (query, зберігаються в localStorage; авто-налаштування лише на localhost)

| Параметр | Ефект |
|----------|-------|
| `?roundDebug=1` | Сцена раунду 1 після правил, 8 фейкових гравців |
| `?scoresDebug=1` / `?roundDebug=scores` | Одразу екран балів після раунду 1 |
| `?minigameDebug=1` | «Правда/Брехня» відкривається одразу на телефоні |
| `?aftermathDebug=1` | Сцена підсумку «Правда/Брехня» (для підгону стилів) |
| `?mgPreview=mathRush` / `?mgPreview=rps` | Екран підсумку міні-гри з макетними даними (для стилів, дисплей) |

---

## Як запустити

```bash
# 1. Сервер
cd server && npm install && npm start          # http://localhost:3001

# 2. Клієнт (новий термінал)
cd client && npm install && npm start          # http://localhost:3000

# Телефони в тій самій мережі:
cd client && HOST=0.0.0.0 npm start
# відкрити http://<IP-ПК>:3000 на телефоні
# якщо сервер не на :3001 — REACT_APP_SERVER_URL=http://<IP-ПК>:3001
```

Продакшн: `cd client && npm run build`, тоді `server.js` віддає `client/build`
статикою на тому самому порту.

**Тести** (Node вбудований test runner, без залежностей):

```bash
cd server && npm test         # логіка міні-ігор: 29 тестів
```

---

## Що видалено в цьому рефакторі

- `server/gameStates.js` → `server/config.js`
- `server/rounds/index.js` → `server/questions.js`; `server/rounds/roundConfig.js` (не використовувався) — видалено
- `client/src/components/MainScene.{jsx,css}` — фаза `MAIN_SCENE` ніколи не показувалась
- `client/src/components/BombTimer.{jsx,css}`, `FlipCalendarTimer.{jsx,css}` — не імпортувались
- `client/src/App.test.js` — дефолтний тест CRA, що завжди падав
- `client/src/logo.svg` — не використовувався
- `server/node_modules` прибрано з git (додано кореневий `.gitignore`)
- `express.static("public")` (мертвий шлях) → `client/build`

## Наступні кроки для фінальної битви

`FINAL_BATTLE` зараз — заглушка (напис + автоперехід через ~6с). Щоб зробити
справжню:

1. Сервер: у `phases.js` → `startFinalBattle(room)` замінити заглушку на реальну
   логіку (напр. окрема механіка між гравцями, у яких лишились життя).
2. Клієнт: у `App.js` рендер `GAME_PHASE.FINAL_BATTLE` — замінити `<RoundIntro>` на
   відео + UI битви; забрати авто-`finalBattleDone`, натомість завершувати за
   реальною подією.
3. Відео: покласти файл у `client/public/assets/questions/video/` і підключити.

## Відомі місця для роботи далі

- Аудіо-озвучка є лише для раунду 1; раунди 2-9 — порожньо/частково.
- `round10.json` більше не використовується (раундів 9). Можна видалити або
  перенести питання в інші раунди.
- Немає персистентності: краш сервера в середині гри = гра втрачена.
- `App.js` / `App.css` варто розбити на модулі.
- Коди кімнат 0000-9999 — маленький простір, вгадувані (тепер хоча б `crypto`).

import { useEffect, useMemo, useRef, useState } from "react";
import "./TrueFalseMinigame.css";

const TOTAL_PLAY_SECONDS = 30;
const FREEZE_SECONDS = 3;
const COUNTDOWN_START_AT_VIDEO_SEC = 12; // 3-2-1 стартує на 12-й секунді відео

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
};

const STORAGE_KEY = "truefalse_recent";
const RECENT_GAMES_COUNT = 5;
const QUESTIONS_PER_GAME = 12;

const getRecentIndices = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-RECENT_GAMES_COUNT) : [];
  } catch {
    return [];
  }
};

const saveUsedIndices = (indices) => {
  try {
    const recent = getRecentIndices();
    recent.push(indices);
    const trimmed = recent.slice(-RECENT_GAMES_COUNT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
};

const pickQuestionsForGame = () => {
  const recent = getRecentIndices();
  const recentlyUsedSet = new Set(recent.flat());
  const allIndices = QUESTIONS.map((_, i) => i);
  const fresh = allIndices.filter((i) => !recentlyUsedSet.has(i));
  const recentArr = allIndices.filter((i) => recentlyUsedSet.has(i));
  const shuffledFresh = shuffle(fresh);
  const shuffledRecent = shuffle(recentArr);
  const pool = [...shuffledFresh, ...shuffledRecent];
  const count = Math.min(QUESTIONS_PER_GAME, pool.length);
  return shuffle(pool).slice(0, count).map((idx) => ({ ...QUESTIONS[idx], _idx: idx }));
};

const QUESTIONS = [
  { text: "Венера обертається у протилежний бік ніж Земля", isTrue: true },
  { text: "Всі птахи вміють літати", isTrue: false },
  { text: "Людина має 206 кісток", isTrue: true },
  { text: "Сонце — це зірка", isTrue: true },
  { text: "Банан росте на дереві", isTrue: false },
  { text: "Атом складається тільки з протонів і електронів", isTrue: false },
  { text: "У павуків 6 лап", isTrue: false },
  { text: "У медуз немає мозку", isTrue: true },
  { text: "Сатурн може плавати у воді", isTrue: true },
  { text: "У людини 5 органів чуття", isTrue: true },
  { text: "Акули — це ссавці", isTrue: false },
  { text: "Кити дихають легенями", isTrue: true },
  { text: "Найбільша пустеля — це Сахара", isTrue: false },
  { text: "У Марса є кільця", isTrue: true }, // (як у твоєму списку)
  { text: "ДНК є у всіх живих організмів", isTrue: true },
  { text: "Еверест росте щороку", isTrue: true },
  { text: "У космосі людина одразу вибухне без скафандра", isTrue: false },
  { text: "Блискавка ніколи не б'є двічі в одне місце", isTrue: false },
  { text: "У восьминога синя кров", isTrue: true },
  { text: "Лід важчий за воду", isTrue: false },
  { text: "У людському тілі є золото", isTrue: true },
  { text: "Сон — це стан повного відключення мозку", isTrue: false },
  { text: "Чорні діри засмоктують абсолютно все", isTrue: false },
  { text: "Дельфіни мають імена один для одного", isTrue: true },
  { text: "Бджоли можуть впізнавати обличчя", isTrue: true },
  { text: "Коти не відчувають солодкий смак", isTrue: true },
  { text: "Люди світяться в темряві", isTrue: true },
  { text: "Вуглець є основою всіх живих організмів", isTrue: true },
  { text: "У людському тілі більше води ніж у кокосі", isTrue: true },
  { text: "Слони бояться мишей", isTrue: false },
  { text: "У космосі є запах", isTrue: true },
  { text: "Акул не існувало до динозаврів", isTrue: false },
  { text: "Вогонь не має тіні", isTrue: false },
  { text: "У людини найсильніший м'яз — язик", isTrue: false },
  { text: "Банани радіоактивні", isTrue: true },
  { text: "Вода проводить електрику", isTrue: false },
  { text: "Усі планети Сонячної системи мають супутники", isTrue: false },
  { text: "Восьминіг має 3 серця", isTrue: true },
  { text: "Час залежить від швидкості руху", isTrue: true },
  { text: "Птахи — це нащадки динозаврів", isTrue: true },
  { text: "Волосся і нігті ростуть після смерті", isTrue: false },
  { text: "Риби не відчувають болю", isTrue: false },
  { text: "У Сонця є тверда поверхня", isTrue: false },
  { text: "У космосі можна замерзнути і згоріти одночасно", isTrue: true },
  { text: "Гори можуть рухатися", isTrue: true },
  { text: "Алмази зроблені з вуглецю", isTrue: true },
  { text: "Людський організм може виробляти електрику", isTrue: true },
  { text: "У всіх ссавців є шерсть", isTrue: true },
  { text: "Крокодили можуть плакати", isTrue: true },
  { text: "Кров у комах червона", isTrue: false },
  { text: "Папір не можна скласти більше ніж 7 разів", isTrue: false },
  { text: "Віруси — це живі організми", isTrue: false },
  { text: "Вода може існувати у трьох станах одночасно", isTrue: true },
  { text: "У космосі старіння сповільнюється", isTrue: true },
  { text: "У людини є «другий мозок» у кишечнику", isTrue: true },
  { text: "Дерева можуть спілкуватися між собою", isTrue: true },
  { text: "У кішок є ключиці", isTrue: true },
  { text: "Мед ніколи не псується", isTrue: true },
  { text: "Земля — ідеально кругла", isTrue: false },
  { text: "Всі бактерії шкідливі", isTrue: false },
  { text: "Рослини можуть «чути»", isTrue: true },
  { text: "У океані більше золота ніж на суші", isTrue: true },
  { text: "У людей різний смак води", isTrue: true },
  { text: "У мозку немає больових рецепторів", isTrue: true },
  { text: "Курка жила без голови кілька днів", isTrue: true },
  { text: "Усі риби холоднокровні", isTrue: false },
  { text: "Магніти працюють тільки з металом", isTrue: false },
  { text: "Серце може продовжувати битися поза тілом", isTrue: true },
  { text: "У космосі немає гравітації", isTrue: false },
  { text: "Вода має смак", isTrue: false },
  { text: "Дельфіни сплять з одним відкритим оком", isTrue: true },
  { text: "У людей є більше ніж 600 м'язів", isTrue: true },
  { text: "Тигри мають смугасту шкіру, не тільки шерсть", isTrue: true },
  { text: "У космосі можна плакати нормально", isTrue: false },
  { text: "Вуглекислий газ важчий за кисень", isTrue: true },
  { text: "Людське тіло світиться через біохімічні реакції", isTrue: true },
  { text: "Усі птахи відкладають яйця", isTrue: true },
  { text: "Електрика рухається зі швидкістю світла", isTrue: false },
  { text: "Місяць має власне світло", isTrue: false },
  { text: "У людини дві легені однакового розміру", isTrue: false },
  { text: "Кисень не має запаху", isTrue: true },
  { text: "Людина не може одночасно ковтати і дихати", isTrue: true },
  { text: "У жирафа така ж кількість шийних хребців як у людини", isTrue: true },
  { text: "Мозок споживає більше енергії ніж м'язи у стані спокою", isTrue: true },
  { text: "У космосі метал може зварюватися сам по собі", isTrue: true },
  { text: "Крокодили не можуть висовувати язик", isTrue: true },
  { text: "У павуків завжди 8 очей", isTrue: false },
  { text: "Серце кита може важити понад 100 кг", isTrue: true },
  { text: "У людей є кістка в серці", isTrue: false },
  { text: "Землетруси можуть змінювати тривалість дня", isTrue: true },
  { text: "У космосі полум'я має форму кулі", isTrue: true },
  { text: "Деякі жаби можуть замерзати і виживати", isTrue: true },
  { text: "Усі метелики живуть лише один день", isTrue: false },
  { text: "Пісок у пустелі складається тільки з кварцу", isTrue: false },
  { text: "Людське око може розрізняти мільйони кольорів", isTrue: true },
  { text: "У космосі не можна відчути запах без скафандра", isTrue: true },
  { text: "Вода розширюється при замерзанні", isTrue: true },
  { text: "У всіх акул однакова кількість зубів", isTrue: false },
  { text: "Мурахи ніколи не сплять", isTrue: false },
  { text: "Камінь може плавати у воді", isTrue: true },
  { text: "Усі вулкани знаходяться тільки на суші", isTrue: false },
  { text: "Людина може чхнути зі швидкістю понад 100 км/год", isTrue: true },
  { text: "У космосі не можна почути вибух", isTrue: true },
  { text: "Деякі рослини можуть рухатися", isTrue: true },
  { text: "У людини одна нирка може повністю замінити дві", isTrue: true },
  { text: "Місяць віддаляється від Землі", isTrue: true },
  { text: "Усі змії отруйні", isTrue: false },
  { text: "Людське тіло може виробляти тепло без руху", isTrue: true },
  { text: "Деякі риби можуть ходити по суші", isTrue: true },
  { text: "Світло може поводитися як хвиля і як частинка", isTrue: true },
  { text: "У космосі вода може кипіти і замерзати одночасно", isTrue: true },
  { text: "У всіх птахів однакова температура тіла", isTrue: false },
  { text: "У космосі немає температури", isTrue: false },
  { text: "Деякі тварини можуть змінювати стать", isTrue: true },
  { text: "Людина може жити без шлунка", isTrue: true },
  { text: "Грім виникає через звук світла", isTrue: false },
  { text: "Деякі комахи можуть жити без голови деякий час", isTrue: true },
  { text: "У космосі предмети падають швидше ніж на Землі", isTrue: false },
  { text: "Людське тіло має власне магнітне поле", isTrue: true },
  { text: "Усі метали проводять електрику однаково добре", isTrue: false },
  { text: "Деякі бактерії можуть жити без кисню", isTrue: true },
  { text: "Людина може бачити ультрафіолет без приладів", isTrue: false },
  { text: "Усі ссавці народжуються живими", isTrue: false },
  { text: "У космосі тиск дорівнює нулю", isTrue: true },
  { text: "У людини є більше ніж 200 різних типів клітин", isTrue: true },
  { text: "Кити можуть затримувати дихання більше години", isTrue: true },
  { text: "Усі зірки однакового кольору", isTrue: false },
  { text: "Деякі гриби світяться у темряві", isTrue: true },
  { text: "Людське серце зупиняється під час чхання", isTrue: false },
  { text: "Усі океани солоні однаково", isTrue: false },
  { text: "У космосі немає вітру", isTrue: true },
  { text: "Деякі птахи можуть літати задом", isTrue: true },
  { text: "Людина може прожити без води більше місяця", isTrue: false },
  { text: "Усі рослини потребують сонячного світла", isTrue: false },
  { text: "У космосі можна бачити більше зірок ніж на Землі", isTrue: true },
  { text: "Деякі тварини можуть відновлювати втрачені органи", isTrue: true },
  { text: "Усі планети обертаються навколо своєї осі", isTrue: true },
  { text: "У космосі немає дня і ночі", isTrue: true },
  { text: "Людина може чути ультразвук", isTrue: false },
  { text: "Усі птахи мають крила", isTrue: true },
  { text: "Деякі рослини можуть їсти комах", isTrue: true },
  { text: "Усі риби дихають зябрами", isTrue: false },
  { text: "Людське тіло може накопичувати електричний заряд", isTrue: true },
  { text: "Деякі птахи можуть не приземлятися місяцями", isTrue: true },
  { text: "Усі ссавці мають однакову температуру тіла", isTrue: false },
  { text: "У космосі не існує ваги", isTrue: false },
  { text: "Деякі тварини бачать інфрачервоне світло", isTrue: true },
  { text: "Людина може жити без печінки", isTrue: false },
  { text: "Деякі комахи можуть виживати у вакуумі", isTrue: true },
  { text: "Усі планети круглі як ідеальна сфера", isTrue: false },
  { text: "Людський мозок активніший під час сну", isTrue: true },
  { text: "У космосі можна отримати сонячний опік", isTrue: true },
  { text: "Деякі бактерії можуть пережити космос", isTrue: true },
  { text: "Усі тварини мають серце", isTrue: false },
  { text: "Людина може бачити в повній темряві після адаптації", isTrue: false },
  { text: "У космосі не можна кип'ятити воду", isTrue: false },
  { text: "Деякі метали можуть плавитися в руці", isTrue: true },
  { text: "Усі зорі більші за Сонце", isTrue: false },
  { text: "У світі більше ніж 7000 мов", isTrue: true },
  { text: "Найдовше слово в англійській мові має понад 100 літер", isTrue: true },
  { text: "Усі країни мають столицю", isTrue: false },
  { text: "Найбільша країна у світі — Канада", isTrue: false },
  { text: "Є країни без жодної річки", isTrue: true },
  { text: "Найпопулярніша мова у світі — англійська", isTrue: false },
  { text: "Існують мови без письма", isTrue: true },
  { text: "Смайлики з’явилися раніше за інтернет", isTrue: false },
  { text: "Перші гроші були зроблені з металу", isTrue: false },
  { text: "Паперові гроші виникли в Китаї", isTrue: true },
  { text: "У деяких країнах досі немає банкоматів", isTrue: true },
  { text: "Цифра 0 існувала не завжди", isTrue: true },
  { text: "Римські цифри не мають символу для нуля", isTrue: true },
  { text: "Тиждень завжди починається з понеділка", isTrue: false },
  { text: "Світлофор завжди має три кольори", isTrue: false },
  { text: "У Японії є поїзди швидші за 300 км/год", isTrue: true },
  { text: "Перший автомобіль був електричним", isTrue: true },
  { text: "Усі літаки мають чорні коробки", isTrue: true },
  { text: "Чорна скринька літака насправді чорна", isTrue: false },
  { text: "У світі існують дороги з підігрівом", isTrue: true },
  { text: "Усі мости будують із бетону", isTrue: false },
  { text: "Найдовша дорога у світі проходить через кілька континентів", isTrue: true },
  { text: "Усі ліфти рухаються тільки вертикально", isTrue: false },
  { text: "Календар не завжди мав 12 місяців", isTrue: true },
  { text: "Існують країни без вихідних у неділю", isTrue: true },
  { text: "Усі країни використовують григоріанський календар", isTrue: false },
  { text: "У деяких культурах є більше ніж 7 днів у тижні", isTrue: false },
  { text: "Усі країни переходять на літній час", isTrue: false },
  { text: "Існують країни з кількома часовими поясами", isTrue: true },
  { text: "Китай має один часовий пояс", isTrue: true },
  { text: "Піца походить з Італії", isTrue: true },
  { text: "Суші завжди готують з сирої риби", isTrue: false },
  { text: "Шоколад колись використовували як гроші", isTrue: true },
  { text: "Кава росте на дереві", isTrue: true },
  { text: "Є морозиво зі смаком часнику", isTrue: true },
  { text: "Мед використовували ще в давнину як підсолоджувач", isTrue: true },
  { text: "Усі супи подають гарячими", isTrue: false },
  { text: "Існують чорні бургери", isTrue: true },
  { text: "Хліб з’явився раніше за металеві інструменти", isTrue: true },
  { text: "У шахах більше можливих партій ніж атомів у Всесвіті", isTrue: true },
  { text: "Усі карти світу однаково точні", isTrue: false },
  { text: "Глобус точніший за карту", isTrue: true },
  { text: "Є країни повністю оточені однією іншою країною", isTrue: true },
  { text: "Найменша країна світу — Ватикан", isTrue: true },
  { text: "Існують міста в двох країнах одночасно", isTrue: true },
  { text: "Усі столиці знаходяться в центрі країни", isTrue: false },
  { text: "Є країни без виходу до моря", isTrue: true },
  { text: "Усі прапори прямокутні", isTrue: false },
  { text: "Перший комп’ютер займав цілу кімнату", isTrue: true },
  { text: "Інтернет існував до 1990 року", isTrue: true },
  { text: "Wi-Fi означає Wireless Fidelity", isTrue: false },
  { text: "Перший телефон не мав кнопок", isTrue: true },
  { text: "Усі сайти починаються з www", isTrue: false },
  { text: "Пароль “123456” є одним з найпопулярніших", isTrue: true },
  { text: "QR-код з’явився раніше за смартфони", isTrue: true },
  { text: "Bluetooth названий на честь короля", isTrue: true },
  { text: "Усі файли можна відкрити на будь-якому комп’ютері", isTrue: false },
  { text: "Емодзі і смайлики — це одне і те ж", isTrue: false },
  { text: "У деяких мовах немає слова “дякую”", isTrue: true },
  { text: "Є мови без голосних букв", isTrue: false },
  { text: "Найпоширеніша літера в англійській — E", isTrue: true },
  { text: "У китайській мові немає алфавіту як у нас", isTrue: true },
  { text: "Є слова які не перекладаються дослівно", isTrue: true },
  { text: "Усі мови мають однакову граматику", isTrue: false },
  { text: "Паліндром — це слово яке читається однаково в обидві сторони", isTrue: true },
  { text: "У світі є мови з кліками як звуками", isTrue: true },
  { text: "Усі слова мають чітке походження", isTrue: false },
  { text: "Є мови без часів (минулого/майбутнього)", isTrue: true },
  { text: "Деякі країни мають більше ніж одну офіційну мову", isTrue: true },
  { text: "Усі країни мають гімн зі словами", isTrue: false },
  { text: "Є прапори з трьома однаковими кольорами", isTrue: true },
  { text: "Усі столиці більші за інші міста країни", isTrue: false },
  { text: "Існують країни без армії", isTrue: true },
  { text: "Усі країни використовують метричну систему", isTrue: false },
  { text: "Є міста з населенням понад 20 мільйонів", isTrue: true },
  { text: "Усі країни мають однакову валюту", isTrue: false },
  { text: "Деякі країни мають два прапори", isTrue: true },
  { text: "Усі країни мають президента", isTrue: false },
  { text: "Книги існували до друкарського верстата", isTrue: true },
  { text: "Перша друкована книга була Біблія", isTrue: true },
  { text: "Усі книги мають автора", isTrue: false },
  { text: "Є бібліотеки без жодної паперової книги", isTrue: true },
  { text: "Комікси вважаються літературою", isTrue: true },
  { text: "Усі фільми мають сценарій", isTrue: true },
  { text: "Перші фільми були без звуку", isTrue: true },
  { text: "Усі серіали мають однакову тривалість серій", isTrue: false },
  { text: "Є фільми довші за 10 годин", isTrue: true },
  { text: "Усі мультфільми створюються на комп’ютері", isTrue: false },
  { text: "Люди гірше запам’ятовують інформацію без емоцій", isTrue: true },
  { text: "Мультизадачність робить людину продуктивнішою", isTrue: false },
  { text: "Люди краще запам’ятовують початок і кінець списку", isTrue: true },
  { text: "0 є парним числом", isTrue: true },
  { text: "Будь-яке число ділиться саме на себе", isTrue: true },
  { text: "Нескінченність — це число", isTrue: false },
  { text: "1 не є простим числом", isTrue: true },
  { text: "Сума двох непарних чисел завжди парна", isTrue: true },
  { text: "Добуток двох від’ємних чисел від’ємний", isTrue: false },
  { text: "Дроби можуть бути більшими за 1", isTrue: true },
  { text: "Квадрат будь-якого числа завжди додатний", isTrue: true },
  { text: "Корінь з від’ємного числа — це реальне число", isTrue: false },
  { text: "У десятковій системі є 10 цифр", isTrue: true },

];

export default function TrueFalseMinigame({
  isActive,
  canAnswer = true,
  onFinish,
  roundIndex,
  uiMode = "mobile", // "mobile" | "display"
  showVideoBg,
  useVideoClock,
  onVideoStartedAt,
  syncData, // { startedAtTs, serverTime, receivedAt } — server-generated for sync
}) {
  const videoRef = useRef(null);
  const didVideoStartRef = useRef(false);
  const countdownStartedRef = useRef(false);
  const finishedRef = useRef(false);
  const freezeTimeoutRef = useRef(null);

  const resolvedShowVideoBg =
    typeof showVideoBg === "boolean"
      ? showVideoBg
      : uiMode === "display";
  // Sync by server timestamp + offset so all devices share the same reference.
  const resolvedUseVideoClock = false;

  // Fallback: if syncData doesn't arrive on mobile within 2.5s, use local time so the game can start.
  const [fallbackSyncData, setFallbackSyncData] = useState(null);
  useEffect(() => {
    if (uiMode !== "mobile" || !isActive || syncData) return;
    const id = window.setTimeout(() => {
      setFallbackSyncData({
        startedAtTs: Date.now(),
        serverTime: Date.now(),
        receivedAt: Date.now(),
      });
    }, 2500);
    return () => window.clearTimeout(id);
  }, [uiMode, isActive, syncData]);

  const resolvedSyncData = syncData ?? fallbackSyncData;

  const serverOffset = useMemo(() => {
    if (resolvedSyncData?.serverTime == null || resolvedSyncData?.receivedAt == null) return null;
    const st = Number(resolvedSyncData.serverTime);
    const ra = Number(resolvedSyncData.receivedAt);
    if (!Number.isFinite(st) || !Number.isFinite(ra)) return null;
    return st - ra; // client_clock + offset ≈ server_clock
  }, [resolvedSyncData?.serverTime, resolvedSyncData?.receivedAt]);

  const [countdownNumber, setCountdownNumber] = useState(null); // 3|2|1|null
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_PLAY_SECONDS);
  const [isFinished, setIsFinished] = useState(false);

  const [isFrozen, setIsFrozen] = useState(false);
  const [score, setScore] = useState(0);
  const [questionIdx, setQuestionIdx] = useState(0);

  const shuffledQuestions = useMemo(() => pickQuestionsForGame(), [roundIndex]);

  useEffect(() => {
    setCountdownNumber(null);
    setGameStarted(false);
    setTimeLeft(TOTAL_PLAY_SECONDS);
    setIsFrozen(false);
    setScore(0);
    setQuestionIdx(0);
    setFallbackSyncData(null);
    finishedRef.current = false;
    setIsFinished(false);
    countdownStartedRef.current = false;
    didVideoStartRef.current = false;

    const scheduleCountdownStep = (targetTs, fn) => {
      const ms = Math.max(0, targetTs - (Date.now() + serverOffset));
      return window.setTimeout(fn, ms);
    };

    if (resolvedUseVideoClock) {
      const v = videoRef.current;
      if (!v) return;

      try {
        v.currentTime = 0;
      } catch {}

      const startCountdownSequence = () => {
        if (countdownStartedRef.current) return;
        countdownStartedRef.current = true;
        setCountdownNumber(3);
        window.setTimeout(() => setCountdownNumber(2), 1000);
        window.setTimeout(() => setCountdownNumber(1), 2000);
        window.setTimeout(() => {
          setCountdownNumber(null);
          setGameStarted(true);
        }, 3000);
      };

      const onTimeUpdate = () => {
        if (!isActive) return;
        if (countdownStartedRef.current) return;
        if (v.currentTime >= COUNTDOWN_START_AT_VIDEO_SEC) {
          startCountdownSequence();
        }
      };

      v.addEventListener("timeupdate", onTimeUpdate);
      v.play().catch(() => {});

      return () => {
        v.removeEventListener("timeupdate", onTimeUpdate);
        try {
          if (freezeTimeoutRef.current) window.clearTimeout(freezeTimeoutRef.current);
        } catch {}
      };
    }

    // Schedule 3-2-1 and game start by server time so all devices stay in sync.
    if (isActive && resolvedSyncData && serverOffset != null) {
      const base = Number(resolvedSyncData.startedAtTs);
      if (!Number.isFinite(base)) return;
      const t0 = base + COUNTDOWN_START_AT_VIDEO_SEC * 1000;
      const ids = [
        scheduleCountdownStep(t0, () => {
          if (!isActive) return;
          if (countdownStartedRef.current) return;
          countdownStartedRef.current = true;
          setCountdownNumber(3);
        }),
        scheduleCountdownStep(t0 + 1000, () => {
          if (!isActive) return;
          setCountdownNumber(2);
        }),
        scheduleCountdownStep(t0 + 2000, () => {
          if (!isActive) return;
          setCountdownNumber(1);
        }),
        scheduleCountdownStep(t0 + 3000, () => {
          if (!isActive) return;
          setCountdownNumber(null);
          setGameStarted(true);
        }),
      ];
      return () => {
        ids.forEach((id) => window.clearTimeout(id));
        try {
          if (freezeTimeoutRef.current) window.clearTimeout(freezeTimeoutRef.current);
        } catch {}
      };
    }

    return () => {
      try {
        if (freezeTimeoutRef.current) window.clearTimeout(freezeTimeoutRef.current);
      } catch {}
    };
  }, [isActive, roundIndex, resolvedUseVideoClock, resolvedSyncData, serverOffset]);

  // Derive timeLeft from server time so all devices show the same value.
  const gameStartTs =
    resolvedSyncData?.startedAtTs != null && Number.isFinite(Number(resolvedSyncData.startedAtTs))
      ? Number(resolvedSyncData.startedAtTs) + COUNTDOWN_START_AT_VIDEO_SEC * 1000 + 3000
      : null; // +3s for 3-2-1 countdown

  useEffect(() => {
    if (!isActive || !gameStarted) return;
    if (gameStartTs == null || serverOffset == null) return;

    const tick = () => {
      const sn = Date.now() + serverOffset;
      const elapsed = (sn - gameStartTs) / 1000;
      const left = Math.max(0, Math.ceil(TOTAL_PLAY_SECONDS - elapsed));
      setTimeLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [isActive, gameStarted, gameStartTs, serverOffset]);

  const shuffledQuestionsRef = useRef(null);
  shuffledQuestionsRef.current = shuffledQuestions;

  useEffect(() => {
    if (!isActive) return;
    if (!gameStarted) return;
    if (timeLeft > 0) return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    const used = [];
    if (shuffledQuestionsRef.current?.length) {
      const len = shuffledQuestionsRef.current.length;
      for (let i = 0; i <= questionIdx; i++) {
        const idx = shuffledQuestionsRef.current[i % len]?._idx;
        if (typeof idx === "number") used.push(idx);
      }
    }
    if (used.length > 0) saveUsedIndices([...new Set(used)]);
    setIsFinished(true);
    onFinish?.(score);
  }, [isActive, gameStarted, timeLeft, onFinish, score, questionIdx]);

  const currentQ = shuffledQuestions[questionIdx % shuffledQuestions.length];

  const answer = (pickedIsTrue) => {
    if (!isActive) return;
    if (!canAnswer) return;
    if (!gameStarted) return;
    if (isFrozen) return;
    if (!currentQ) return;

    const correct = pickedIsTrue === currentQ.isTrue;
    if (correct) {
      setScore((s) => s + 1);
      setQuestionIdx((i) => i + 1);
      return;
    }

    setIsFrozen(true);
    freezeTimeoutRef.current = window.setTimeout(() => {
      setIsFrozen(false);
      setQuestionIdx((i) => i + 1);
    }, FREEZE_SECONDS * 1000);
  };

  // Fallback: if `onPlay` doesn't fire for some reason, emit a sync timestamp shortly after mount.
  useEffect(() => {
    if (uiMode !== "display") return;
    if (!isActive) return;
    if (didVideoStartRef.current) return;
    if (!onVideoStartedAt) return;

    const id = window.setTimeout(() => {
      if (didVideoStartRef.current) return;
      didVideoStartRef.current = true;
      onVideoStartedAt(Date.now());
    }, 500);
    return () => window.clearTimeout(id);
  }, [uiMode, isActive, onVideoStartedAt]);

  return (
    <section className={`truefalse-root ${uiMode === "mobile" ? "truefalse-root-mobile" : ""}`}>
      {resolvedShowVideoBg && (
        <video
          className="truefalse-bg"
          ref={videoRef}
          src="/assets/minigames/truefalse.mp4"
          autoPlay
          playsInline
          preload="auto"
          muted={false}
          onPlay={() => {
            if (didVideoStartRef.current) return;
            didVideoStartRef.current = true;
            onVideoStartedAt?.(Date.now());
          }}
        />
      )}

      <div className="truefalse-overlay">
        <div className="truefalse-topline">
          {gameStarted && (
            <>
              <div className="truefalse-timer">
                ⏱ {timeLeft}
              </div>
              {uiMode === "mobile" && (
                <div className="truefalse-score-badge">
                  ✓ {score}
                </div>
              )}
            </>
          )}
        </div>

        {countdownNumber != null && (
          <div className="truefalse-countdown" aria-live="polite">
            {countdownNumber}
          </div>
        )}

        {!gameStarted && countdownNumber == null && isActive && (
          <div className="truefalse-wait">
            {uiMode === "mobile" ? "Дивіться на головний екран" : "Інструкція триває…"}
          </div>
        )}

        {!isActive && (
          <div className="truefalse-wait">
            {uiMode === "mobile" ? "Очікуйте старту…" : "Очікуйте результатів конкурсу…"}
          </div>
        )}

        {uiMode === "mobile" && gameStarted && currentQ && (
          <div className="truefalse-card">
            <div className="truefalse-question">{currentQ.text}</div>
            <div className="truefalse-buttons">
              <button
                className="truefalse-btn truefalse-btn-true"
                onClick={() => answer(true)}
                disabled={!canAnswer || isFrozen}
                type="button"
              >
                Правда
              </button>
              <button
                className="truefalse-btn truefalse-btn-false"
                onClick={() => answer(false)}
                disabled={!canAnswer || isFrozen}
                type="button"
              >
                Брехня
              </button>
            </div>
          </div>
        )}

        {uiMode === "mobile" && isFrozen && gameStarted && canAnswer && (
          <div className="truefalse-freeze" aria-live="polite">
            ⛔ Заморожено
          </div>
        )}
      </div>
    </section>
  );
}


import "./style.css";
import { API, APIError, type Action, type Run, type Board } from "./api";
import { Input } from "./input";
import { Sound } from "./audio";
import { World, type Target } from "./world";

interface TelegramApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent?(event: string, callback: () => void): void;
  openLink?(url: string): void;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const show = (selector: string, visible: boolean) =>
  $(selector).classList.toggle("hidden", !visible);
const text = (selector: string, value: string | number) => {
  $(selector).textContent = String(value);
};
const api = new API();
const input = new Input();
const sound = new Sound();
let world: World;
let run: Run | null = null;
let started = false,
  busy = false,
  modalOpen = false,
  paused = false,
  canClose = true;
let lastFocus: HTMLElement | null = null;
let toastTimer = 0;
let lastFrame = performance.now();
let lastRender = 0;
let nearest: Target | null = null;
let demoAxis: { x: number; y: number } | null = null;
let demoRunning = false;

function toast(message: string) {
  text("#toast", message);
  show("#toast", true);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => show("#toast", false), 4200);
}

function fail(error: unknown) {
  show("#loading", false);
  text(
    "#fatal-text",
    error instanceof Error
      ? error.message
      : "Не удалось открыть архив. Попробуй перезагрузить страницу",
  );
  show("#fatal", true);
}

function button(label: string, callback: () => void, primary = false) {
  const node = document.createElement("button");
  node.className = primary ? "primary-button" : "secondary-button";
  node.textContent = label;
  node.addEventListener("click", callback);
  return node;
}
function paragraph(value: string, className = "") {
  const node = document.createElement("p");
  node.textContent = value;
  node.className = className;
  return node;
}

function modal(
  label: string,
  title: string,
  paragraphs: string[],
  actions: { label: string; callback: () => void; primary?: boolean }[],
  closeable = true,
) {
  input.reset();
  if (!modalOpen) lastFocus = document.activeElement as HTMLElement | null;
  modalOpen = true;
  canClose = closeable;
  text("#modal-label", label);
  text("#modal-title", title);
  $("#modal-body").replaceChildren(...paragraphs.map((p) => paragraph(p)));
  $("#modal-actions").replaceChildren(
    ...actions.map((a) => button(a.label, a.callback, a.primary)),
  );
  show("#modal-close", closeable);
  show("#modal", true);
  updateControls();
  requestAnimationFrame(() => $("#modal-actions button")?.focus());
}

function closeModal() {
  modalOpen = false;
  paused = false;
  show("#modal", false);
  input.reset();
  sound.resume();
  updateControls();
  lastFocus?.focus();
}

function updateControls() {
  const exploring =
    !!run &&
    (run.state.phase === "explore" || run.state.phase === "won") &&
    run.status === "active";
  input.enabled = started && !busy && !modalOpen && !paused;
  show("#touch-controls", input.touch && input.enabled && exploring);
  show("#interaction", !!nearest && input.enabled && exploring);
  $<HTMLButtonElement>("#touch-interact").disabled = !nearest;
}

function renderState() {
  if (!run) return;
  const state = run.state;
  world.setState(state);
  const fighting =
    state.phase === "combat" || (busy && ["won", "lost"].includes(state.phase));
  show("#battle", fighting);
  show("#quest", started && !fighting);
  show("#explore-hud", started && !fighting);
  text("#found-count", `${state.secrets.length} / ${state.secret_total}`);
  if (state.phase === "won")
    text(
      "#quest-text",
      state.secrets.length === 2
        ? "Пройди к арке и покинь архив"
        : "Путь открыт. В зале ещё остались отголоски",
    );
  else text("#quest-text", "Найди стража у северной арки");
  $("#quest-progress-fill").style.width =
    `${state.phase === "won" ? 85 : 18 + state.secrets.length * 15}%`;
  text("#player-hp", `${state.hp}/${state.max_hp}`);
  text("#enemy-hp", `${state.enemy_hp}/${state.enemy_max_hp}`);
  $("#player-hp-fill").style.width = `${(100 * state.hp) / state.max_hp}%`;
  $("#enemy-hp-fill").style.width =
    `${(100 * state.enemy_hp) / state.enemy_max_hp}%`;
  text("#turn-number", String(state.turn + 1).padStart(2, "0"));
  text("#battle-log", state.log);
  text(
    "#enemy-intent",
    state.intent === "heavy"
      ? "✦ Готовит тяжёлый удар. Защищайся"
      : state.intent === "recover"
        ? "◇ Восстанавливается. Время атаковать"
        : "† Готовит обычный удар",
  );
  $("#charge-display")
    .querySelectorAll("i")
    .forEach((n, i) => n.classList.toggle("active", i < state.charge));
  document
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach((node) => {
      node.disabled =
        busy ||
        state.phase !== "combat" ||
        (node.dataset.action === "pulse" && state.charge < 2);
    });
  updateControls();
}

async function start() {
  if (busy) return;
  busy = true;
  $<HTMLButtonElement>("#start-button").disabled = true;
  try {
    run = await api.start();
    world.reset(run.state);
    started = true;
    paused = false;
    nearest = null;
    show("#intro", false);
    closeModal();
    renderState();
    toast("WASD или стик: ходьба. Потяни по сцене, чтобы повернуть камеру");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Не удалось войти");
  } finally {
    busy = false;
    $<HTMLButtonElement>("#start-button").disabled = false;
    renderState();
  }
}

async function resync() {
  if (!run) return;
  try {
    run = await api.getRun(run.id);
    renderState();
  } catch {
    /* Keep last canonical state until retry. */
  }
}

async function battleAction(action: Action) {
  if (!run || busy || modalOpen || run.state.phase !== "combat") return;
  if (action === "pulse" && run.state.charge < 2) return;
  busy = true;
  input.reset();
  renderState();
  try {
    const result = await api.action(run, action);
    world.animateAction(action);
    sound.play(
      action === "attack" ? "hit" : action === "guard" ? "guard" : "pulse",
    );
    run = result;
    renderState();
    $("#world").classList.remove("battle-flash");
    void $("#world").offsetWidth;
    $("#world").classList.add("battle-flash");
    await new Promise((resolve) => setTimeout(resolve, 950));
  } catch (error) {
    await resync();
    toast(
      error instanceof Error ? error.message : "Сигнал потерян. Попробуй снова",
    );
  } finally {
    busy = false;
    renderState();
    if (run.state.phase === "won") {
      sound.play("win");
      modal(
        "СИГНАЛ ВОССТАНОВЛЕН",
        "Арка открыта",
        [
          "Страж больше не держит тебя здесь. Осмотрись: после боя зал звучит иначе.",
          `За бой получено ${run.state.battle_score} очков. Чтобы завершить прохождение, подойди к северной арке.`,
        ],
        [{ label: "Вернуться в зал ↗", callback: closeModal, primary: true }],
      );
    } else if (run.state.phase === "lost") {
      modal(
        "СИГНАЛ ПОГАС",
        "Ещё один шаг",
        [
          "Архив не закрывает двери навсегда. Попробуй защищаться перед тяжёлым ударом и использовать импульс, когда страж восстанавливается.",
        ],
        [
          {
            label: "Начать заново ↗",
            callback: () => void start(),
            primary: true,
          },
          { label: "Таблица результатов", callback: () => void leaderboard() },
        ],
        false,
      );
    }
  }
}

async function engage() {
  if (!run || busy) return;
  busy = true;
  updateControls();
  try {
    run = await api.action(run, "engage");
    sound.play("click");
    closeModal();
    renderState();
  } catch (error) {
    await resync();
    toast(error instanceof Error ? error.message : "Не удалось начать бой");
  } finally {
    busy = false;
    renderState();
  }
}

async function secret(id: "inscription" | "echo") {
  if (!run || busy) return;
  if (run.state.secrets.includes(id)) {
    modal(
      "ЗНАК УЖЕ НАЙДЕН",
      "Знакомый мотив",
      [
        "Ты уже восстановил этот фрагмент сигнала. Он останется с тобой до конца пути.",
      ],
      [{ label: "Продолжить", callback: closeModal, primary: true }],
    );
    return;
  }
  busy = true;
  updateControls();
  try {
    const prompt = await api.secret(run, id);
    modal(
      "ФРАГМЕНТ ПАМЯТИ",
      prompt.title,
      [prompt.text],
      prompt.options.map((option) => ({
        label: option.text,
        callback: () => void solve(id, option.id),
      })),
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : "Здесь пока тихо");
  } finally {
    busy = false;
    updateControls();
  }
}

async function solve(id: string, answer: string) {
  if (!run || busy) return;
  busy = true;
  $("#modal-actions")
    .querySelectorAll("button")
    .forEach((b) => (b.disabled = true));
  try {
    run = await api.answer(run, id, answer);
    sound.play("secret");
    renderState();
    closeModal();
    toast("Фрагмент памяти найден · +120 очков");
  } catch (error) {
    await resync();
    toast(error instanceof Error ? error.message : "Попробуй ещё раз");
  } finally {
    busy = false;
    updateControls();
    $("#modal-actions")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = false));
  }
}

function interact() {
  if (!input.enabled || !nearest || !run || busy) return;
  sound.play("click");
  switch (nearest) {
    case "keeper":
      modal(
        "ХРАНИТЕЛЬ АРХИВА",
        "Кто идёт?",
        [
          "«Я охраняю то, о чём все забыли. Покажи, что умеешь слушать».",
          "Бой пошаговый. Следи за намерением стража. Удар и защита дают заряд, а два заряда открывают импульс.",
        ],
        [
          {
            label: "Вступить в бой ↗",
            callback: () => void engage(),
            primary: true,
          },
          { label: "Пока осмотреться", callback: closeModal },
        ],
      );
      break;
    case "inscription":
      void secret("inscription");
      break;
    case "echo":
      void secret("echo");
      break;
    case "exit":
      if (run.state.phase === "won") {
        modal(
          "ПОРОГ",
          "Дальше есть свет",
          [
            run.state.secrets.length < 2
              ? "В зале ещё остались фрагменты памяти. Можно вернуться за ними или закончить путь сейчас."
              : "Ты услышал всё, что хранил этот зал. Пора идти дальше.",
          ],
          [
            {
              label: "Завершить прохождение ↗",
              callback: () => void finish(),
              primary: true,
            },
            { label: "Остаться в зале", callback: closeModal },
          ],
        );
      } else toast("Арку удерживает страж. Сначала поговори с ним");
  }
}

async function finish() {
  if (!run || busy) return;
  busy = true;
  updateControls();
  try {
    run = await api.finish(run);
    renderState();
    sound.play("win");
    modal(
      "КОНЕЦ ПЕРВОЙ ГЛАВЫ",
      "Сигнал дошёл.",
      [
        "Некоторые двери открываются, когда перестаёшь торопиться.",
        api.user.is_guest
          ? "Это локальное гостевое прохождение. Его результат хранится отдельно от рейтинга Telegram."
          : api.config.competition_open
            ? "Результат сохранён в этой версии рейтинга."
            : "Результат сохранён в тестовом рейтинге. Призовой запуск ещё не начался.",
      ],
      [
        {
          label: "Таблица результатов ↗",
          callback: () => void leaderboard(),
          primary: true,
        },
        { label: "К магазину new0", callback: () => openShop() },
        { label: "Пройти ещё раз", callback: () => void start() },
      ],
      false,
    );
    const score = document.createElement("div");
    score.className = "score-big";
    score.textContent = String(run.state.score);
    const small = document.createElement("small");
    small.textContent = "ОЧКОВ";
    score.append(small);
    const details = document.createElement("div");
    details.className = "score-details";
    details.append(
      paragraph(`За бой: ${run.state.battle_score}`),
      paragraph(`Пасхалки: ${run.state.secrets.length} × 120`),
    );
    $("#modal-body").prepend(score);
    $("#modal-body").append(details);
  } catch (error) {
    toast(
      error instanceof Error ? error.message : "Не удалось сохранить результат",
    );
  } finally {
    busy = false;
    updateControls();
  }
}

function openShop() {
  const url = "https://new0.shop/";
  if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

async function leaderboard() {
  if (busy || !api.user) return;
  modal(
    "ОТГОЛОСКИ",
    "Таблица результатов",
    ["Загружаем записи архива…"],
    [{ label: "Продолжить", callback: closeModal, primary: true }],
    run?.status !== "finished",
  );
  try {
    const versions = await api.versions();
    const select = document.createElement("select");
    select.className = "version-select";
    select.setAttribute("aria-label", "Версия рейтинга");
    for (const v of versions) {
      const option = document.createElement("option");
      option.value = v.version;
      option.textContent = `${v.title}${v.prize ? " · призовая" : " · тестовая"}`;
      option.selected = v.current;
      select.append(option);
    }
    const list = document.createElement("div");
    list.id = "board-list";
    $("#modal-body").replaceChildren(select, list);
    const draw = (board: Board) => {
      list.replaceChildren();
      list.append(
        paragraph(
          board.is_guest_board
            ? "Локальная гостевая таблица. Она отделена от Telegram-рейтинга."
            : board.prize
              ? "Лучший результат каждого Telegram-аккаунта."
              : "Тестовая версия. Эти результаты не участвуют в розыгрыше.",
          "rule-note",
        ),
      );
      for (const entry of board.entries) {
        const row = document.createElement("div");
        row.className = `board-row${entry.is_me ? " me" : ""}`;
        const rank = document.createElement("span");
        rank.className = "board-place";
        rank.textContent = String(entry.rank).padStart(2, "0");
        const name = document.createElement("span");
        name.textContent = entry.name + (entry.is_me ? " · ты" : "");
        const score = document.createElement("span");
        score.className = "board-score";
        score.textContent = String(entry.score);
        row.append(rank, name, score);
        list.append(row);
      }
      if (!board.entries.length)
        list.append(
          paragraph(
            "Пока здесь тихо. Заверши прохождение, чтобы оставить свой след.",
            "empty-board",
          ),
        );
      list.append(
        paragraph(
          "1000 за победу + 25 за каждое оставшееся здоровье + 40 за защиту от тяжёлого удара − 30 за ход + 120 за каждую пасхалку. Время не учитывается.",
          "rule-note",
        ),
      );
      list.append(
        paragraph(
          "При равных очках место общее. Правило определения получателя приза ещё предстоит согласовать.",
          "rule-note",
        ),
      );
    };
    select.addEventListener("change", () => {
      select.disabled = true;
      void api
        .board(select.value)
        .then(draw)
        .catch((e) => toast(e.message))
        .finally(() => (select.disabled = false));
    });
    draw(await api.board());
    if (run?.status === "finished") {
      $("#modal-actions").replaceChildren(
        button("Пройти ещё раз ↗", () => void start(), true),
        button("К магазину new0", openShop),
      );
    }
  } catch (error) {
    $("#modal-body").replaceChildren(
      paragraph(
        error instanceof Error ? error.message : "Не удалось загрузить рейтинг",
      ),
    );
  }
}

function pause() {
  if (!started || busy) return;
  if (modalOpen) {
    if (canClose) closeModal();
    return;
  }
  paused = true;
  sound.suspend();
  modal(
    "ПАУЗА",
    "Архив подождёт",
    [
      "WASD или экранный стик: движение. Потяни мышью или пальцем по сцене, чтобы повернуть камеру. Подходи к знакам и взаимодействуй. В бою следи за намерением стража.",
    ],
    [
      { label: "Продолжить ↗", callback: closeModal, primary: true },
      {
        label: "Таблица результатов",
        callback: () => {
          paused = false;
          void leaderboard();
        },
      },
      { label: "Начать заново", callback: () => void start() },
      { label: "Авторы и материалы", callback: credits },
    ],
  );
}

function credits() {
  modal(
    "МАТЕРИАЛЫ ПРОТОТИПА",
    "Нулевой архив",
    [
      "Герои, геометрия зала, анимации и временный синтезированный звук созданы для этой демки.",
      "Текстуры PSX Dungeon: Goblinatron, лицензия CC BY 4.0. Исходные PNG не изменены. В игре применены тонирование, повторение и освещение.",
    ],
    [
      {
        label: "Вернуться к паузе",
        callback: () => {
          closeModal();
          pause();
        },
        primary: true,
      },
    ],
  );
  const links = paragraph("");
  for (const [label, url] of [
    ["PSX Dungeon by Goblinatron", "https://goblinatron.itch.io/psx-dungeon"],
    ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ]) {
    const link = document.createElement("a");
    link.href = url;
    link.textContent = label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link, document.createTextNode(" · "));
  }
  $("#modal-body").append(links);
}

input.onInteract = interact;
input.onPause = pause;
input.onAction = (n) => {
  if (!modalOpen)
    void battleAction((["attack", "guard", "pulse"] as Action[])[n - 1]);
};
$("#start-button").addEventListener("click", () => void start());
$("#interact-button").addEventListener("click", interact);
$("#touch-interact").addEventListener("click", interact);
$("#pause-button").addEventListener("click", pause);
$("#leaderboard-button").addEventListener("click", () => void leaderboard());
$("#modal-close").addEventListener("click", () => {
  if (canClose) closeModal();
});
$("#sound-button").addEventListener("click", () => {
  void sound
    .toggle()
    .then((enabled) => {
      show(".sound-slash", !enabled);
      $("#sound-button").setAttribute("aria-pressed", String(enabled));
      $("#sound-button").setAttribute(
        "aria-label",
        enabled ? "Выключить звук" : "Включить звук",
      );
      $("#sound-button").title = enabled ? "Выключить звук" : "Включить звук";
      if (enabled) sound.play("click");
    })
    .catch(() => toast("Нажми ещё раз, чтобы разрешить звук"));
});
document
  .querySelectorAll<HTMLButtonElement>("[data-action]")
  .forEach((node) =>
    node.addEventListener(
      "click",
      () => void battleAction(node.dataset.action as Action),
    ),
  );
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    input.reset();
    sound.suspend();
    if (started && !modalOpen && !busy) pause();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !modalOpen) return;
  const focusable = [
    ...$("#modal").querySelectorAll<HTMLElement>(
      "button:not([disabled]),select,a[href]",
    ),
  ].filter((n) => n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0],
    last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
window.addEventListener("game-context-lost", () =>
  fail(
    new Error("Графика была приостановлена устройством. Перезагрузи страницу"),
  ),
);

function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - lastRender < 1000 / (input.touch ? 30 : 60)) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  lastRender = now;
  if (!world) return;
  const active =
    started &&
    !modalOpen &&
    !busy &&
    !paused &&
    run?.status === "active" &&
    ["explore", "won"].includes(run.state.phase);
  world.update(paused ? 0 : dt, demoAxis ?? input.axis(), !!active);
  const target = active ? world.nearest() : null;
  nearest = target?.id ?? null;
  if (target) text("#interaction-name", target.title);
  updateControls();
}

async function boot() {
  try {
    const tg = window.Telegram?.WebApp?.initData
      ? window.Telegram.WebApp
      : undefined;
    tg?.ready();
    tg?.expand();
    try {
      tg?.setHeaderColor?.("#141715");
      tg?.setBackgroundColor?.("#141715");
      tg?.disableVerticalSwipes?.();
    } catch {
      /* Older Telegram clients. */
    }
    tg?.onEvent?.("deactivated", () => {
      input.reset();
      sound.suspend();
      if (started && !modalOpen && !busy) pause();
    });
    tg?.onEvent?.("viewportChanged", () => world?.resize());
    world = new World($<HTMLCanvasElement>("#world"), input.touch);
    input.bindLook($("#world"));
    input.onLook = (dx, dy) => world.orbit(dx, dy);
    world.onStep = () => sound.play("step");
    requestAnimationFrame(frame);
    await Promise.all([world.load(), api.connect(tg?.initData ?? "")]);
    text("#player-name", api.user.name.toLocaleUpperCase("ru"));
    text(
      "#account-label",
      api.user.is_guest
        ? "Гостевой путь · отдельный рейтинг"
        : "Аккаунт Telegram подтверждён",
    );
    text(
      "#connection-status",
      api.user.is_guest
        ? "ГОСТЕВОЙ ПУТЬ"
        : `ТВОЙ ПУТЬ, ${api.user.name.toLocaleUpperCase("ru")}`,
    );
    text("#start-button span", "Войти в архив");
    $<HTMLButtonElement>("#start-button").disabled = false;
    show("#loading", false);
    if (
      new URLSearchParams(location.search).get("showcase") === "1" &&
      api.user.is_guest
    ) {
      const demo = document.createElement("button");
      demo.id = "showcase-button";
      demo.className = "showcase-button";
      demo.textContent = "Автопоказ · 20 секунд";
      demo.addEventListener("click", () => void showcase(demo));
      $("#app").append(demo);
    }
  } catch (error) {
    if (error instanceof APIError && error.status === 401)
      fail(
        new Error(
          "Telegram не подтвердил вход. Закрой мини-приложение и открой его заново",
        ),
      );
    else fail(error);
  }
}

async function showcase(control: HTMLButtonElement) {
  if (demoRunning) return;
  demoRunning = true;
  control.disabled = true;
  control.textContent = "Автопоказ · реальный движок";
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const move = async (ms: number, axis: { x: number; y: number }) => {
    demoAxis = axis;
    await wait(ms);
    demoAxis = { x: 0, y: 0 };
  };
  try {
    if (modalOpen) closeModal();
    await start();
    await wait(700);
    await move(2450, { x: 0, y: -1 });
    await wait(500);
    world.orbit(95, 0);
    await wait(1000);
    world.orbit(-95, 0);
    await wait(600);
    interact();
    await wait(900);
    await engage();
    await wait(700);
    for (const action of [
      "attack",
      "guard",
      "pulse",
      "attack",
      "guard",
      "pulse",
    ] as Action[]) {
      await battleAction(action);
      await wait(180);
    }
    await wait(1200);
    if (modalOpen) closeModal();
    await wait(500);
    await move(700, { x: 0, y: -1 });
    await wait(1000);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Показ прерван");
  } finally {
    demoAxis = null;
    demoRunning = false;
    control.disabled = false;
    control.textContent = "Повторить автопоказ";
  }
}
void boot();

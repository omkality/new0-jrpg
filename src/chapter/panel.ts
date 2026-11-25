import {
  SCOUT,
  MIMIC,
  TECHNIQUES,
  CRITICAL_CHANCE,
  force,
  intent,
  unavailable,
  REGEN_HEAL,
  REGEN_TURNS,
  weaponStats,
  type ChapterWeapon,
  type Command,
} from "./encounter";
import {
  INSCRIPTION,
  INSCRIPTION_TEXT,
  TABLETS,
  LAST_SINGER,
  SIGNS,
  TOLL,
  type CourtOption,
} from "./bell-quest";
import type { ForestChapter } from "./forest";
import { WEAPONS } from "../weapon-spec";

export const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const btn = (id: string) => el<HTMLButtonElement>(id);
export const commands: readonly Command[] = ["attack", "item", "skill"];
const courtOptions: { id: CourtOption; label: string; screen: string }[] = [
  { id: "promise", label: "Обещать вернуть голос", screen: "cantorName" },
  { id: "name", label: "Спросить её имя", screen: "dialogue" },
  { id: "ask", label: "Чья могила во дворе?", screen: "toll" },
  { id: "speak", label: "Произнести имя", screen: "cairn" },
  { id: "take", label: "Взять копьё", screen: "cache" },
  { id: "swap", label: "Взять оружие", screen: "weapon" },
  { id: "uncatch", label: "Поднять крышку", screen: "coffer" },
  { id: "retreat", label: "Отступить от сундука", screen: "defeat" },
  { id: "takeRegen", label: "Взять зелье регенерации", screen: "votive" },
  {
    id: "drinkRegen",
    label: `Регенерация · +${REGEN_HEAL} × ${REGEN_TURNS} хода`,
    screen: "potions",
  },
  { id: "drinkHeal", label: "Лечебное зелье", screen: "potions" },
  { id: "shelter", label: "Прикрыть огонёк", screen: "votive" },
  { id: "pay", label: `Отдать ${TOLL} монет`, screen: "toll" },
  { id: "fight", label: "Вызвать на поединок", screen: "toll" },
  ...(["thorn", "sun", "wave"] as const).map((id) => ({
    id,
    label: SIGNS[id].name,
    screen: "seals",
  })),
  { id: "left", label: "Левее", screen: "mirror" },
  { id: "right", label: "Правее", screen: "mirror" },
  { id: "inscribe", label: "Вписать в помянник", screen: "tablet" },
  { id: "rest", label: "Закрыть помянник", screen: "tablet" },
  { id: "one", label: "Позвать Певчую", screen: "vow" },
  { id: "all", label: "Разбудить двор", screen: "vow" },
];
export function buildCourtOptions(
  bind: (button: HTMLButtonElement, id: CourtOption) => void,
) {
  for (const { id, label } of courtOptions) {
    const button = document.createElement("button");
    button.id = "court-" + id;
    if (id === "wave" || id === "thorn" || id === "sun") {
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg"),
        path = document.createElementNS(ns, "path");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      path.setAttribute("d", SIGNS[id].path);
      svg.append(path);
      button.append(svg);
    }
    button.append(document.createTextNode(label));
    el("court-options").append(button);
    bind(button, id);
  }
}
function stats(who: "hero" | "foe", value: number, max: number) {
  el(who + "-hp").textContent = value + " / " + max;
  const meter = el<HTMLMeterElement>(who + "-meter");
  meter.max = max;
  meter.value = value;
}
function compareRow(id: string, weapon: ChapterWeapon) {
  const { damage, critical, skill } = weaponStats(weapon);
  el(id + "-weapon").textContent = WEAPONS[weapon].name;
  el(id + "-stats").textContent =
    `Урон ${damage} · Крит ${critical}% · Приём ${skill}`;
}
export function drawPanel(game: ForestChapter, nearby: string, notice: string) {
  const { screen, battle, result, spec } = game;
  const trail = screen === "trail",
    choosing = screen === "choice";
  const advance = btn("advance"),
    interact = btn("interact");
  let label = "Лесная тропа",
    title = "У Чёрных ворот",
    line = "",
    next = "";
  el("walk").hidden = !trail;
  el("place").textContent =
    game.location === "forest"
      ? "Чёрные ворота"
      : game.location === "roofs"
        ? "Колокольный двор"
        : game.location === "crypt"
          ? "Костница"
          : game.player.y > 4.95
            ? "Верхняя ризница"
            : "Часовня";
  let hasOptions = false;
  for (const option of courtOptions) {
    const b = btn("court-" + option.id);
    b.hidden =
      option.screen !== screen ||
      (option.id === "name" && spec !== SCOUT) ||
      (option.id === "speak" && !game.learnedName) ||
      (option.id === "take" && game.foundPike) ||
      (option.id === "retreat" && spec !== MIMIC) ||
      (option.id === "takeRegen" && game.foundRegen) ||
      (option.id === "shelter" && game.sheltered) ||
      ((option.id === "inscribe" || option.id === "rest") &&
        (game.mirrorIndex !== LAST_SINGER || game.tabletIndex !== LAST_SINGER));
    if (!b.hidden && option.id === "name")
      b.textContent = game.learnedName ? "Вернуться к разговору" : option.label;
    if (!b.hidden && option.id === "uncatch")
      b.textContent = game.mimicAwake ? "Сразиться с мимиком" : option.label;
    if (!b.hidden && option.id === "drinkHeal" && battle)
      b.textContent =
        "Лечебное · +" + spec.heal + " HP · " + battle.flasks + " шт.";
    b.disabled =
      b.hidden ||
      (option.id === "drinkHeal" &&
        !!battle &&
        !!unavailable(battle, "item")) ||
      (option.id === "drinkRegen" &&
        !!battle &&
        !!unavailable(battle, "regen")) ||
      (option.id === "pay" && game.coins < TOLL) ||
      (option.id === "left" && game.mirrorIndex === 0) ||
      (option.id === "right" && game.mirrorIndex === TABLETS.length - 1);
    if (!b.hidden) hasOptions = true;
  }
  el("court-options").hidden = !hasOptions;
  const showingCommands = choosing || screen === "action" || screen === "reply";
  el("choices").hidden = !showingCommands;
  el("vitals").hidden = screen === "memorial";
  el("enemy-vitals").hidden = !game.inEncounter;
  el("report").hidden = screen !== "memorial";
  el("credits").hidden = screen !== "memorial";
  const presented = game.shownTurn;
  const pierce = battle?.weapon === "spear";
  const moves = TECHNIQUES[battle?.weapon ?? game.equipped];
  const offered = game.offered;
  el("weapon-compare").hidden = !offered;
  if (offered) {
    compareRow("find", offered);
    compareRow("held", game.equipped);
  }
  btn("attack").querySelector("strong")!.textContent = moves.basic;
  btn("skill").querySelector("strong")!.textContent = moves.heavy;
  stats("hero", presented?.hp ?? game.player.hp, game.player.maxHp);
  const foeName =
    spec === SCOUT ? "Певчая" : spec === MIMIC ? "Мимик" : "Причетник";
  el("foe-name").textContent = foeName;
  stats("foe", presented?.enemyHp ?? spec.hp, spec.hp);
  if (showingCommands && presented) {
    for (const cmd of commands) {
      const button = btn(cmd),
        bag = cmd === "item" && presented.regenFlasks > 0,
        reason = bag
          ? unavailable(presented, "regen") && unavailable(presented, "item")
          : unavailable(presented, cmd);
      const selected =
        !choosing &&
        (result?.command === cmd ||
          (cmd === "item" && result?.command === "regen"));
      button.disabled = !choosing || !!reason;
      button.classList.toggle("selected", selected);
      button.querySelector("small")!.textContent = selected
        ? "Выбрано"
        : reason ||
          (cmd === "item"
            ? bag
              ? "Выбрать зелье"
              : "+" + spec.heal + " HP · " + presented.flasks + " шт."
            : force(spec, presented.weapon, cmd) +
              " урона · крит " +
              CRITICAL_CHANCE[presented.weapon] +
              "%");
    }
  }
  el("stock").textContent = game.inEncounter
    ? "Серия " +
      (presented?.charge ?? 0) +
      " / 2" +
      (presented?.regenTurns ? " · Реген. " + presented.regenTurns + " х." : "")
    : "Зелья " + (game.flasks + game.regenFlasks) + " · Монеты " + game.coins;
  if (trail) {
    title = game.cleared ? "Дорога к воротам" : "Голос в тумане";
    line =
      notice ||
      (game.openDoors.has("gate")
        ? "Створки поддались. Переступи порог."
        : game.cleared
          ? game.keys.has("gate")
            ? "Ключ у тебя. Иди вниз по тропе к воротам."
            : "У каменной плиты слева лежит ключ Чёрных ворот."
          : "Справа за корнями кто-то поёт сквозь костяной клюв.");
    if (game.quest !== "forest") {
      label = el("place").textContent!;
      if (game.quest === "bell") {
        title = "Колокол молчит";
        line = "Поднимись по ступеням. У левой стены двора висит колокол.";
      }
      if (game.quest === "keeper") {
        title = "За голосом";
        line =
          game.learnedName && !game.foundPike
            ? "У западной стены белеют три зарубки. Дальше, у решётки, ждёт причетник."
            : "У решётки часовни слышно, как железо скребёт по камню.";
      }
      if (game.quest === "vestry") {
        title = "Ризница звонаря";
        line = game.openDoors.has("gallery")
          ? "В глубине ризницы лежит бронзовый ларец."
          : game.keys.has("gallery")
            ? "Поднимись по лестнице справа в часовне и отопри ризницу."
            : "За решёткой войди в часовню. На аналое слева лежит ключ от верхней ризницы.";
      }
      if (game.quest === "return") {
        title = "Голос в бронзе";
        line = "Спустись из ризницы и верни язык колоколу во дворе.";
      }
      if (game.quest === "ossuary") {
        title = "Четвёртый певчий";
        line =
          game.player.z > -76
            ? "Пройди часовню насквозь. За дальней решёткой из потолочного окна падает свет."
            : game.mirrorTurns === 0
              ? "Под световым колодцем стоит зеркало. На дальней плите виден отпечаток ладони."
              : "Свет падает на плиту «" +
                TABLETS[game.mirrorIndex].mark +
                "». Подойди, чтобы прочесть надпись.";
      }
      if (notice) line = notice;
    }
    interact.hidden = !nearby;
    interact.textContent = nearby;
    el("walk-help").hidden = !!nearby;
  } else if (!battle) {
    label = el("place").textContent!;
    switch (screen) {
      case "inscription":
        title = "Пустая чаша";
        line =
          "Под бронзовым краем пусто. На ярме три клейма. " +
          INSCRIPTION_TEXT +
          ". В такую же печать звонарь запер язык колокола.";
        next = "Запомнить клейма";
        break;
      case "remembrance":
        title = "Слово у корней";
        line = game.clapperMounted
          ? "Ива разжимает когти. Между ветвей пробивается певческое дыхание."
          : "«Я не возьму с тебя крови». Певчая разворачивает ладонь. Пять старых монет на дорогу. «Возьми ключ с плиты и позвони по мне».";
        next = "Вернуться на тропу";
        break;
      case "cairn":
        title = "Камень с тремя зарубками";
        line = game.learnedName
          ? "Под плитой шуршит сухая ветка. В выемке осталось место для одного имени."
          : "В камень врезана ветка ивы. Чьё имя стёрто? Тот, кто держит затвор, ещё помнит погребённых.";
        next = "Отойти";
        break;
      case "cache":
        title = "Под корнями";
        line = game.foundPike
          ? "В пустом ложе осталось серое перо."
          : "Копьё лежит в саване. При обмене твоё оружие останется у могилы.";
        next = "Оставить тайник";
        break;
      case "weapon":
        title = "Оружие на земле";
        line =
          "Урон зависит от цели. Если взять находку, твоё оружие останется здесь.";
        next = "Оставить на земле";
        break;
      case "coffer":
        title = game.mimicAwake ? "Алчный реликварий" : "Окованный сундук";
        line = game.mimicAwake
          ? "Между зубами дрожит цепочка. Челюсти ждут."
          : "Замок тёплый. Под крышкой тихо шевелится цепочка.";
        next = "Отойти";
        break;
      case "votive":
        title = game.sheltered ? "Четвёртый фитиль" : "Огарок под окном";
        line = game.sheltered
          ? "На камне проступили слова «Ива» и «не записан в хоре». Четвёртый огонь отзовётся во дворе."
          : "Сквозняк гасит крошечный фитиль. На стенке подсвечника след детской ладони.";
        if (!game.foundRegen) line += " У подножия зеленеет флакон.";
        next = "Отойти";
        break;
      case "keeperStory":
        title = "Имена под камнем";
        line =
          "«Ива легла под тремя зарубками, а поёт до сих пор. В часовне был ещё один певчий. Его огарок бросили у скамьи под окном».";
        next = "Вернуться к затвору";
        break;
      case "toll":
        title = "Железный причетник";
        line =
          "«У меня отсюда только один ключ». Из-под железной митры тянет воском. «Пять монет за проход. Или подними оружие».";
        next = "Отойти";
        break;
      case "seals": {
        title = "Печать звонаря";
        const progress = game.marks
          ? INSCRIPTION.slice(0, game.marks)
              .map((s) => SIGNS[s].name)
              .join(" · ")
          : "";
        line = game.wrongMark
          ? "Зубцы сорвались. Ты вспоминаешь надпись на ярме. " +
            INSCRIPTION_TEXT +
            "."
          : progress
            ? progress + ". Клеймо запало. Нажми следующее."
            : "На передней стенке ларца три клавиши. Нажми их в порядке, который видела на ярме колокола.";
        next = "Отойти от ларца";
        break;
      }
      case "relic":
        title = "Язык колокола";
        line =
          "Замок отступил. В бархате лежит бронзовый язык с продетой в ушко красной нитью.";
        next = "Взять язык";
        break;
      case "vow":
        title = "Кого позвать?";
        line =
          "Язык снова висит в чаше. Один удар зовёт того, чей голос потерян. Три удара разбудят всех, кто остался в стенах.";
        next = "Отойти";
        break;
      case "ringing":
        title = game.vow === "one" ? "Один удар" : "Три удара";
        line = "Бронза дрожит. На поминальной полке проступает свет.";
        break;
      case "ending":
        label = "Колокольный двор";
        title = game.vow === "one" ? "Голос из леса" : "Двор проснулся";
        line =
          game.vow === "one"
            ? game.promised
              ? "Из леса долетел ответ Ивы. Ты сдержала слово. На полке горит один огонь."
              : "От ворот донеслось тихое «я здесь». На полке горит один огонь."
            : "Три огня дрожат под колоколом. Из пустых окон отозвались чужие голоса.";
        if (game.sheltered) line += " На краю полки горит четвёртый фитиль.";
        line += " В глубине часовни заскрежетала подъёмная цепь.";
        next = "Пойти на звук цепи";
        break;
      case "mirror":
        title = "Погребальное зеркало";
        line =
          "Серебро ловит свет потолочного окна. Полоса света легла на знак «" +
          TABLETS[game.mirrorIndex].mark +
          "». " +
          (game.sheltered
            ? "На огарке в часовне была маленькая ладонь."
            : "Среди знаков на камне виден отпечаток детской ладони.");
        next = "Отойти от зеркала";
        break;
      case "tablet": {
        const p = TABLETS[game.tabletIndex];
        title = "Плита со знаком «" + p.mark + "»";
        line =
          game.tabletIndex !== game.mirrorIndex
            ? "Камень холоден. В косом свете на нём можно было бы разобрать буквы."
            : p.inscription;
        if (
          game.tabletIndex === LAST_SINGER &&
          game.mirrorIndex === LAST_SINGER
        )
          line +=
            " Рядом раскрыт помянник. Вписанных в него зовут на каждый звон.";
        next = "Отойти от плиты";
        break;
      }
      case "memorial":
        label = "Конец главы";
        title =
          game.memorial === "inscribe"
            ? "Четвёртый голос"
            : "После последнего звона";
        line =
          game.memorial === "inscribe"
            ? "Имя Саввы осталось в помяннике. Загорелся фитиль. Когда колокол ударит вновь, у Ивы будет кому ответить."
            : "Ты закрыла помянник. Савву больше не позовут к вечерне. Впервые за долгую зиму под плитой тихо.";
        next = "Пройти ещё раз";
        break;
    }
  } else if (battle) {
    title = spec.name;
    label = "Встреча";
    switch (screen) {
      case "cantorName":
        title = "Имя под языком";
        line =
          "«Ива. Когда у меня ещё были губы, меня звали Ива. Под западной стеной двора лежит мой камень. Узнаешь по трём зарубкам». Клюв смыкается.";
        next = "Запомнить имя";
        break;
      case "dialogue":
        line =
          spec === SCOUT
            ? "В горле птицы слышно два голоса. «За воротами меня похоронили в другой раз. Выдержишь мою песню?»"
            : spec === MIMIC
              ? "Под крышкой скребутся монеты. Цепочка натянута между зубами. На третьем укусе челюсти можно перебить сильным приёмом."
              : "«На третий удар я заношу секиру. Успеешь провести две обычные атаки, собьёшь мой замах третьей, усиленной».";
        next = "Принять вызов";
        break;
      case "reveal":
        label = "В часовне";
        line = "Вместе с крышкой поднимается ряд зубов.";
        break;
      case "potions":
        title = "Пояс с зельями";
        line =
          "За ход можно выпить одно зелье. Регенерация лечит сразу и ещё два твоих хода в этом бою.";
        next = "Назад";
        break;
      case "choice": {
        const foe = intent(spec, battle);
        label = "Твой ход · " + battle.turn;
        line =
          foeName +
          " готовит " +
          foe.label.toLowerCase() +
          ". Базовый урон " +
          foe.damage +
          (foe.breakable
            ? ". " + moves.heavy + " собьёт замах."
            : battle.turn === 1
              ? ". Две обычные атаки подготовят сильный приём."
              : ".");
        break;
      }
      case "action": {
        label = "Твоё действие";
        if (!game.contacted) {
          line =
            result!.command === "item" || result!.command === "regen"
              ? "Паломница подносит флакон к губам."
              : pierce
                ? result!.command === "skill"
                  ? "Паломница шагает вперёд, выбрасывая копьё."
                  : "Короткий толчок остриём."
                : battle.weapon === "axe"
                  ? "Паломница заносит секиру."
                  : "Лезвие выходит из-за плеча.";
          break;
        }
        const hit = result!.strike;
        if (!hit) {
          line =
            result!.command === "regen"
              ? "Ты выпила зелье регенерации. +" + result!.regenerated + " HP."
              : "Ты выпила зелье. Рана затягивается.";
          break;
        }
        const impact = hit.lethal
          ? hit.critical
            ? "Критическое добивание"
            : "Добивание"
          : hit.critical
            ? "Критический удар"
            : result!.command === "skill"
              ? moves.heavy
              : pierce
                ? "Остриё попало в цель"
                : battle.weapon === "axe"
                  ? "Секира попала в цель"
                  : "Клинок попал в цель";
        line =
          impact +
          ". Урон " +
          hit.damage +
          "." +
          (result!.interrupted ? " Замах сбит." : "");
        break;
      }
      case "reply":
        label =
          spec === SCOUT
            ? "Ответ Певчей"
            : spec === MIMIC
              ? "Ответ мимика"
              : "Ответ причетника";
        line =
          result!.reply!.label +
          (game.contacted
            ? (result!.reply!.critical ? ". Критический удар. " : ". ") +
              "Ты теряешь " +
              result!.reply!.damage +
              " HP."
            : ". Замах.");
        break;
      case "victory":
        label = "Победа";
        title =
          spec === SCOUT
            ? "Песня оборвалась"
            : spec === MIMIC
              ? "Челюсти разжались"
              : "Затвор уступил";
        line =
          (spec === SCOUT
            ? "Певчая склонила клюв. Из оперения выпали погребальные монеты (+"
            : spec === MIMIC
              ? "Из пасти выкатились поминальные монеты (+"
              : "У руки причетника упала секира. Решётка открыта. Монеты сторожа (+") +
          spec.reward +
          ").";
        next =
          spec === SCOUT
            ? "Вернуться на тропу"
            : spec === MIMIC
              ? "Забрать монеты"
              : "Войти в часовню";
        break;
      case "defeat":
        label = "Поражение";
        title = "Туман сомкнулся";
        line =
          "Можно вернуться к началу разговора с прежним здоровьем и зельями.";
        next = "Повторить встречу";
        break;
    }
  }
  if (
    screen === "action" &&
    game.contacted &&
    result?.regenerated &&
    result.command !== "regen"
  )
    line += " Регенерация +" + result.regenerated + " HP.";
  el("mode-label").textContent = label;
  el("panel-title").textContent = title;
  el("line").textContent = line;
  advance.hidden = !next;
  advance.textContent = next;
  advance.disabled = !next;
}

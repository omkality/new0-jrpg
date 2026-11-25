import { Campaign } from "../campaign.ts";
import motion from "../../public/assets/motion/contract.json" with { type: "json" };
import { ATTACKS, ENEMIES, type MoveInput } from "../game.ts";
import { Duel } from "./duel.ts";
import { FOREST_GATE as gate, floorHeight } from "../world-layout.ts";
import { bodyRadius } from "../body-collision.ts";
import { WEAPONS } from "../weapon-spec.ts";
import {
  beginEncounter,
  freshBattleSeed,
  SCOUT,
  KEEPER,
  MIMIC,
  unavailable,
  takeTurn,
  type ChapterWeapon,
  type Encounter,
  type Battle,
  type Command,
  type Supplies,
  type TurnResult,
} from "./encounter.ts";
import {
  BELL,
  BELL_BASE,
  CAIRN,
  VOTIVE,
  COFFER,
  CAIRN_SHOT,
  VOTIVE_SHOT,
  RELIC_BASE,
  MIRROR,
  TABLETS,
  LAST_SINGER,
  MIRROR_SHOT,
  tabletShot,
  type Memorial,
  BELL_SHOT,
  RELIC_SHOT,
  CHOIR_PORTAL,
  REAR_PORTAL,
  MORTUARY_EXIT,
  RELIQUARY,
  TOLL,
  INSCRIPTION,
  KEEPER_POSITION,
  portalBarrier,
  type CourtOption,
  type Sign,
  type Vow,
} from "./bell-quest.ts";

type Screen =
  | "trail"
  | "dialogue"
  | "choice"
  | "action"
  | "reply"
  | "victory"
  | "defeat"
  | "cantorName"
  | "remembrance"
  | "keeperStory"
  | "cairn"
  | "cache"
  | "weapon"
  | "coffer"
  | "reveal"
  | "potions"
  | "votive"
  | "inscription"
  | "toll"
  | "seals"
  | "relic"
  | "vow"
  | "ringing"
  | "ending"
  | "mirror"
  | "tablet"
  | "memorial";
type Quest = "forest" | "bell" | "keeper" | "vestry" | "return" | "ossuary";
const courtyardFace = gate.z - gate.towerDepth / 2;

export class ForestChapter extends Campaign {
  readonly scout;
  readonly keeper;
  readonly mimic;
  regenFlasks = 0;
  foundRegen = false;
  private selectedDrop = -1;
  get equipped(): ChapterWeapon {
    const w = this.player.weapon;
    return w === "spear" || w === "axe" ? w : "sword";
  }
  get offered(): ChapterWeapon | undefined {
    if (this.screen === "cache" && !this.foundPike) return "spear";
    const drop = this.drops[this.selectedDrop];
    if (
      this.screen === "weapon" &&
      drop?.active &&
      drop.weapon !== "unarmed" &&
      drop.weapon !== "relic"
    )
      return drop.weapon;
  }
  screen: Screen = "trail";
  quest: Quest = "forest";
  guardianOutcome: "paid" | "won" | null = null;
  vow: Vow | null = null;
  marks = 0;
  wrongMark = false;
  lastMark?: Sign;
  presses = 0;
  ringTime = 0;
  clapperMounted = false;
  mirrorIndex = 0;
  mirrorTurns = 0;
  tabletIndex = 0;
  memorial: Memorial | null = null;
  spec: Encounter = SCOUT;
  battle?: Battle;
  result?: TurnResult;
  private checkpoint?: Supplies;
  private attempts = 0;
  private readonly combatSeed: number;
  private beatTime = 0;
  contacted = false;
  learnedName = false;
  promised = false;
  foundPike = false;
  cairnOpen = false;
  sheltered = false;
  private stage?: Duel;
  get duel() {
    return this.stage && this.battle && this.screen !== "cantorName"
      ? this.stage.sample(this.player, this.enemy)
      : undefined;
  }
  get shownTurn() {
    if (this.screen === "action")
      return this.contacted ? this.result?.action : this.result?.before;
    if (this.screen === "reply" && !this.contacted) return this.result?.action;
    return this.battle;
  }
  cleared = false;

  constructor(seed = freshBattleSeed()) {
    super();
    this.combatSeed = seed;
    this.scenario = "forest";
    this.phase = "playing";
    this.scout = this.enemies.get(SCOUT.actor)!;
    this.keeper = this.enemies.get(KEEPER.actor)!;
    this.mimic = this.enemies.get(MIMIC.actor)!;
    Object.assign(this.mimic, COFFER, {
      area: "chapel",
      yaw: Math.atan2(Duel.dx, Duel.dz),
      hp: MIMIC.hp,
      maxHp: MIMIC.hp,
    });
    this.scout.hp = this.scout.maxHp = SCOUT.hp;
    this.keeper.hp = this.keeper.maxHp = KEEPER.hp;
    this.keeper.weapon = "axe";
    Object.assign(this.keeper, KEEPER_POSITION, {
      y: floorHeight(KEEPER_POSITION.x, KEEPER_POSITION.z),
      yaw: 0.32,
    });
    this.enemy = this.scout;
    for (const id of this.enemies.keys())
      if (id !== SCOUT.actor && id !== KEEPER.actor && id !== MIMIC.actor)
        this.enemies.delete(id);
    this.chests = [];
    this.drops = this.drops.slice(0, 2);
    this.obstacles = [
      ...this.obstacles.filter((o) => !o.chest),
      BELL_BASE,
      RELIC_BASE,
      { x: CAIRN.x, z: CAIRN.z, hx: 0.54, hz: 0.85, minY: 2.31, maxY: 3.13 },
      { x: VOTIVE.x, z: VOTIVE.z, hx: 0.37, hz: 0.29, minY: 2.31, maxY: 3.36 },
      { ...portalBarrier(CHOIR_PORTAL), door: "choir" },
      { ...portalBarrier(REAR_PORTAL), door: "ossuary" },
      portalBarrier(MORTUARY_EXIT),
      { ...MIRROR, hx: 0.44, hz: 0.44, minY: 2.3, maxY: 3.8 },
      ...TABLETS.map((p) => ({
        ...p,
        hx: 0.7,
        hz: 0.36,
        minY: 2.3,
        maxY: 3.94,
      })),
    ];
  }
  get inEncounter() {
    return !!this.battle;
  }
  get speaker() {
    return this.screen === "toll" || this.screen === "keeperStory"
      ? this.keeper
      : this.screen === "cantorName" || this.screen === "remembrance"
        ? this.scout
        : undefined;
  }
  get shot() {
    switch (this.screen) {
      case "weapon": {
        const { x, y, z } = this.drops[this.selectedDrop];
        return {
          eye: { x: x + 0.55, y: y + 1.65, z: z + 1.55 },
          target: { x, y, z },
        };
      }
      case "coffer":
        return {
          eye: { x: COFFER.x - 0.85, y: COFFER.y + 1.42, z: COFFER.z + 2.4 },
          target: { x: COFFER.x, y: COFFER.y + 0.43, z: COFFER.z },
        };
      case "cairn":
      case "cache":
        return CAIRN_SHOT;
      case "votive":
        return VOTIVE_SHOT;
      case "inscription":
      case "vow":
      case "ringing":
      case "ending":
        return BELL_SHOT;
      case "mirror":
        return MIRROR_SHOT;
      case "tablet":
      case "memorial":
        return tabletShot(this.tabletIndex);
      case "seals":
      case "relic":
        return RELIC_SHOT;
    }
  }
  get hasClapper() {
    return (
      this.clapperMounted || this.quest === "return" || this.screen === "relic"
    );
  }

  private reachable(point: { x: number; y: number; z: number }, range: number) {
    return (
      Math.hypot(this.player.x - point.x, this.player.z - point.z) < range &&
      this.clearLine(this.player, point)
    );
  }
  private get site() {
    for (const drop of this.drops) {
      if (
        drop.active &&
        Math.abs(this.player.y - drop.y) < 0.9 &&
        this.reachable(drop, 1.65)
      )
        return drop;
    }
    if (
      this.guardianOutcome &&
      this.mimic.hp > 0 &&
      this.reachable(this.mimic, 2.05)
    )
      return "coffer";
    if (this.quest === "ossuary") {
      if (this.reachable({ ...MIRROR, z: MIRROR.z + 0.63 }, 1.65))
        return "mirror";
      for (const [index, p] of TABLETS.entries())
        if (this.reachable({ ...p, z: p.z + 0.55 }, 1.45)) return index;
    }
    if (this.reachable(this.scout, 2.05) && (!this.cleared || this.promised))
      return "scout";
    if (
      !this.cleared &&
      Math.hypot(this.player.x - gate.x, this.player.z - gate.z) < 2.1
    )
      return "gate";
    if (this.quest === "forest") return;
    if (this.reachable({ ...CAIRN, z: CAIRN.z + 1.0 }, 1.65)) return "cairn";
    if (
      this.guardianOutcome &&
      this.reachable({ ...VOTIVE, z: VOTIVE.z + 0.4 }, 1.5)
    )
      return "votive";
    if (this.reachable({ x: BELL.x, y: BELL.y, z: BELL.z + 0.8 }, 2.0))
      return "bell";
    if (this.guardianOutcome !== "won" && this.reachable(this.keeper, 2.18))
      return "keeper";
    if (
      this.quest === "vestry" &&
      this.openDoors.has("gallery") &&
      this.reachable(
        { x: RELIQUARY.x, y: RELIQUARY.y, z: RELIQUARY.z + 0.69 },
        1.65,
      )
    )
      return "relic";
  }
  override get nearby() {
    if (this.screen !== "trail") return "";
    const site = this.site;
    if (typeof site === "number") return "Осмотреть плиту";
    if (typeof site === "object") return "Осмотреть оружие";
    switch (site) {
      case "coffer":
        return this.mimicAwake
          ? "Вернуться к мимику"
          : "Осмотреть окованный сундук";
      case "mirror":
        return "Повернуть зеркало";
      case "scout":
        return this.promised ? "Ответить Певчей" : "Заговорить";
      case "cairn":
        return "Осмотреть зарубки";
      case "votive":
        return "Осмотреть огарок";
      case "gate":
        return "Прислушаться к воротам";
      case "bell":
        if (this.quest === "ossuary") return "Прислушаться";
        return this.quest === "return"
          ? this.clapperMounted
            ? "Позвонить в колокол"
            : "Вернуть язык колоколу"
          : "Осмотреть колокол";
      case "keeper":
        return "Окликнуть сторожа";
      case "relic":
        return "Осмотреть ларец";
    }
    return this.pickupOrDoor()?.label ?? "";
  }
  private notice(label: string) {
    this.events.push({
      type: "secret",
      x: this.player.x,
      z: this.player.z,
      label,
    });
  }
  override interact() {
    if (this.screen !== "trail") return;
    const site = this.site;
    if (typeof site === "object") {
      this.stopWalking();
      this.selectedDrop = this.drops.indexOf(site);
      this.screen = "weapon";
      return;
    }
    if (typeof site === "number") {
      this.tabletIndex = site;
      this.stopWalking();
      this.screen = "tablet";
      return;
    }
    switch (site) {
      case "coffer":
        this.stopWalking();
        this.screen = "coffer";
        return;
      case "mirror":
        this.stopWalking();
        this.screen = "mirror";
        return;
      case "scout":
        if (this.promised) {
          this.stopWalking();
          this.screen = "remembrance";
        } else this.startFight(SCOUT);
        return;
      case "gate":
        this.notice("Из леса доносится пение. Кто-то ещё ждёт.");
        return;
      case "bell":
        if (this.quest === "ossuary") {
          this.notice("Из-за дальней решётки часовни тянет холодом.");
          return;
        }
        this.stopWalking();
        if (this.quest === "return") this.clapperMounted = true;
        this.screen = this.quest === "return" ? "vow" : "inscription";
        return;
      case "cairn":
      case "votive": {
        const site = this.site;
        this.stopWalking();
        this.screen =
          site === "votive" ? "votive" : this.cairnOpen ? "cache" : "cairn";
        return;
      }
      case "keeper":
        if (this.quest === "bell") {
          this.notice("Сторож кивает на колокол у левой стены.");
          return;
        }
        this.stopWalking();
        this.screen = this.guardianOutcome ? "keeperStory" : "toll";
        return;
      case "relic":
        this.stopWalking();
        this.screen = "seals";
        this.wrongMark = false;
        return;
    }
    this.pickupOrDoor()?.run();
  }
  private startFight(spec: Encounter) {
    this.stopWalking();
    this.spec = spec;
    this.enemy = this.enemies.get(spec.actor)!;
    this.checkpoint = {
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      flasks: this.flasks,
      regenFlasks: this.regenFlasks,
    };
    this.begin();
  }
  private begin() {
    this.battle = beginEncounter(
      this.spec,
      this.checkpoint!,
      ++this.attempts,
      this.equipped,
      this.combatSeed,
    );
    this.stage = new Duel(this.player, this.enemy);
    this.player.mode = "idle";
    this.player.time = this.beatTime = 0;
    this.contacted = false;
    this.screen = "dialogue";
    this.result = undefined;
    this.enemy.mode = "idle";
    this.enemy.hp = this.enemy.maxHp = this.spec.hp;
    this.enemy.time = 0;
    if (this.spec !== MIMIC) this.enemy.yaw = Math.atan2(0.7, 1.55);
  }
  private admit(outcome: "paid" | "won") {
    this.guardianOutcome = outcome;
    this.openDoors.add("choir");
    this.doorOpenedAt.set("choir", this.elapsed);
    this.quest = "vestry";
    this.screen = "trail";
  }
  private placeWeapon(
    index: number,
    weapon: ChapterWeapon,
    x: number,
    z: number,
  ) {
    Object.assign(this.drops[index], {
      active: true,
      weapon,
      x,
      y: floorHeight(x, z) + 0.025,
      z,
    });
  }
  private swapWeapon(index: number) {
    const drop = this.drops[index];
    if (!drop?.active || drop.weapon === "unarmed" || drop.weapon === "relic")
      return;
    const previous = this.equipped;
    this.player.weapon = drop.weapon;
    drop.weapon = previous;
    this.screen = "trail";
    this.notice(
      WEAPONS[this.player.weapon].name +
        " в руке. На земле: " +
        WEAPONS[previous].name +
        ".",
    );
  }
  openPotions() {
    if (this.screen === "choice" && this.battle && this.battle.regenFlasks > 0)
      this.screen = "potions";
  }
  select(option: CourtOption) {
    if (this.screen === "weapon" && option === "swap") {
      this.swapWeapon(this.selectedDrop);
      return;
    }
    if (this.screen === "coffer" && option === "uncatch") {
      const dormant = !this.mimicAwake;
      this.startFight(MIMIC);
      if (dormant) {
        this.mimicAwake = true;
        this.mimicAwokeAt = this.elapsed;
        this.screen = "reveal";
      }
      return;
    }
    if (
      this.screen === "defeat" &&
      this.spec === MIMIC &&
      option === "retreat"
    ) {
      this.player.mode = "idle";
      this.player.time = this.mimic.time = 0;
      this.mimic.mode = "idle";
      this.battle = this.result = this.checkpoint = this.stage = undefined;
      this.screen = "trail";
      return;
    }
    if (
      this.screen === "votive" &&
      option === "takeRegen" &&
      !this.foundRegen
    ) {
      this.foundRegen = true;
      this.regenFlasks++;
      return;
    }
    if (
      this.screen === "potions" &&
      this.battle &&
      (option === "drinkHeal" || option === "drinkRegen")
    ) {
      const command = option === "drinkHeal" ? "item" : "regen";
      if (unavailable(this.battle, command)) return;
      this.screen = "choice";
      this.choose(command, this.battle.attempt, this.battle.turn);
      return;
    }
    if (this.screen === "mirror" && (option === "left" || option === "right")) {
      const next = this.mirrorIndex + (option === "left" ? -1 : 1);
      if (next >= 0 && next < TABLETS.length) {
        this.mirrorIndex = next;
        this.mirrorTurns++;
      }
      return;
    }
    if (
      this.screen === "tablet" &&
      this.tabletIndex === LAST_SINGER &&
      this.mirrorIndex === LAST_SINGER &&
      (option === "inscribe" || option === "rest")
    ) {
      this.memorial = option;
      this.screen = "memorial";
      return;
    }
    if (
      this.screen === "dialogue" &&
      this.spec === SCOUT &&
      option === "name"
    ) {
      this.learnedName = true;
      this.screen = "cantorName";
    } else if (
      this.screen === "cantorName" &&
      option === "promise" &&
      !this.cleared
    ) {
      this.promised = this.cleared = true;
      this.coins += SCOUT.reward;
      this.completedAreas.add("forest");
      this.battle = this.result = this.checkpoint = undefined;
      this.stage = undefined;
      this.screen = "remembrance";
    } else if (
      this.screen === "cairn" &&
      option === "speak" &&
      this.learnedName
    ) {
      this.cairnOpen = true;
      this.screen = "cache";
    } else if (
      this.screen === "cache" &&
      option === "take" &&
      this.cairnOpen &&
      !this.foundPike
    ) {
      this.foundPike = true;
      this.placeWeapon(0, "spear", CAIRN.x + 0.88, CAIRN.z + 0.62);
      this.swapWeapon(0);
    } else if (
      this.screen === "votive" &&
      option === "shelter" &&
      !this.sheltered
    ) {
      this.sheltered = true;
      this.learnedName = true;
    } else if (this.screen === "toll") {
      if (option === "ask") {
        this.learnedName = true;
        this.screen = "keeperStory";
      } else if (option === "pay" && this.coins >= TOLL) {
        this.coins -= TOLL;
        this.admit("paid");
      } else if (option === "fight") this.startFight(KEEPER);
    } else if (
      this.screen === "seals" &&
      (option === "wave" || option === "thorn" || option === "sun")
    ) {
      this.presses++;
      this.lastMark = option;
      this.wrongMark = option !== INSCRIPTION[this.marks];
      this.marks = this.wrongMark ? 0 : this.marks + 1;
      if (this.marks === INSCRIPTION.length) this.screen = "relic";
    } else if (
      this.screen === "vow" &&
      (option === "one" || option === "all")
    ) {
      this.vow = option;
      this.ringTime = 0;
      this.screen = "ringing";
    }
  }
  advance() {
    switch (this.screen) {
      case "potions":
        this.screen = "choice";
        break;
      case "coffer":
      case "weapon":
        this.screen = "trail";
        break;
      case "ending":
        this.quest = "ossuary";
        this.screen = "trail";
        break;
      case "mirror":
      case "tablet":
        this.screen = "trail";
        break;
      case "cantorName":
        this.screen = "dialogue";
        break;
      case "remembrance":
        this.screen = "trail";
        break;
      case "keeperStory":
        this.screen = this.guardianOutcome ? "trail" : "toll";
        break;
      case "cache":
      case "cairn":
      case "votive":
        this.screen = "trail";
        break;
      case "inscription":
        if (this.quest === "bell") this.quest = "keeper";
        this.screen = "trail";
        break;
      case "toll":
      case "seals":
      case "vow":
        this.screen = "trail";
        break;
      case "relic":
        this.quest = "return";
        this.screen = "trail";
        break;
      case "dialogue":
        this.screen = "choice";
        break;
      case "defeat":
        this.begin();
        break;
      case "victory": {
        const battle = this.battle!;
        this.player.hp = battle.hp;
        this.flasks = battle.flasks;
        this.regenFlasks = battle.regenFlasks;
        this.coins += this.spec.reward;
        this.enemy.hp = 0;
        this.enemy.yaw = Math.atan2(Duel.dx, Duel.dz);
        this.player.mode = "idle";
        this.player.time = 0;
        this.stage = undefined;
        if (this.spec === SCOUT) {
          this.cleared = true;
          this.completedAreas.add("forest");
          this.screen = "trail";
        } else if (this.spec === KEEPER) {
          this.placeWeapon(
            1,
            "axe",
            this.keeper.x + 0.85,
            this.keeper.z + 0.72,
          );
          this.keeper.weapon = "unarmed";
          this.admit("won");
        } else this.screen = "trail";
        this.battle = this.result = this.checkpoint = undefined;
        break;
      }
    }
  }
  choose(command: Command, attempt: number, turn: number) {
    if (this.screen !== "choice" || !this.battle) return;
    const result = takeTurn(this.spec, this.battle, command, attempt, turn);
    if (!result) return;
    this.result = result;
    this.battle = result.next;
    this.screen = "action";
    this.beatTime = 0;
    this.contacted = false;
    this.player.mode =
      command === "item" || command === "regen" ? "heal" : "attack";
    this.player.regenDraught = command === "regen";
    this.player.combo = command === "skill" ? 3 : 1 + ((turn - 1) % 2);
    this.player.time = 0;
    this.enemy.mode = "guard";
    this.enemy.time = 0;
  }
  override update(dt: number, input: MoveInput) {
    if (this.screen === "reveal") {
      this.elapsed += dt;
      if (this.elapsed - this.mimicAwokeAt >= 1.15) this.screen = "dialogue";
      return;
    }
    if (this.screen === "ringing") {
      this.ringTime += dt;
      if (this.ringTime >= (this.vow === "all" ? 4.6 : 3.1)) {
        this.openDoors.add("ossuary");
        this.doorOpenedAt.set("ossuary", this.elapsed);
        this.screen = "ending";
      }
      return;
    }
    if (this.screen === "trail") {
      this.elapsed += dt;
      this.player.time += dt;
      this.scout.time += dt;
      this.keeper.time += dt;
      this.mimic.time += dt;
      this.updateLocomotion(dt, input);
      if (
        this.quest === "forest" &&
        this.cleared &&
        this.openDoors.has("gate") &&
        this.player.z + bodyRadius(this.player) <= courtyardFace
      )
        this.quest = "bell";
      return;
    }
    if (this.screen !== "action" && this.screen !== "reply") return;
    const result = this.result!;
    const heroTurn = this.screen === "action",
      drink =
        heroTurn && (result.command === "item" || result.command === "regen");
    const attacker = heroTurn ? this.player : this.enemy,
      target = heroTurn ? this.enemy : this.player;
    const attack = ATTACKS[attacker.combo - 1];
    const lead = heroTurn ? 0 : this.spec === KEEPER ? 0.33 : 0.21;
    const contact = drink
      ? 0.5
      : heroTurn
        ? attack.contact
        : this.spec === MIMIC
          ? lead + 0.36
          : lead +
            (0.68 * (attack.contact * 0.28)) /
              (attack.duration - attack.contact * 0.72);
    const hit = heroTurn ? result.strike : result.reply;
    const fall = hit?.lethal ?? false;
    const recovery = drink
      ? 1.05
      : heroTurn
        ? attack.duration + 0.04
        : lead + 0.76;
    const duration = fall
      ? Math.max(recovery, contact + motion[`Death${target.death}`])
      : recovery;
    this.beatTime += dt;
    target.time += dt;
    if (!heroTurn && this.beatTime < lead) {
      attacker.mode = "windup";
      attacker.time =
        (ENEMIES[this.enemy.kind].windup * 0.9 * this.beatTime) / lead;
    } else {
      attacker.mode = drink ? "heal" : "attack";
      attacker.time = this.beatTime - lead;
      if (attacker.time > (heroTurn ? recovery : 0.7)) attacker.mode = "idle";
    }
    if (!this.contacted && this.beatTime >= contact) {
      this.contacted = true;
      if (hit) {
        target.reaction = result.next.turn % 3;
        target.mode = fall ? "dead" : "hit";
        target.time = this.beatTime - contact;
        const pose = this.duel!;
        const who = heroTurn ? pose.foe : pose.hero;
        const from = heroTurn ? pose.hero : pose.foe;
        const dx = who.x - from.x,
          dz = who.z - from.z;
        const distance = Math.hypot(dx, dz) || 1;
        this.events.push({
          type: heroTurn ? "hit" : "hurt",
          x: who.x,
          z: who.z,
          wound:
            hit.critical || (heroTurn && hit.lethal)
              ? {
                  dx: dx / distance,
                  dz: dz / distance,
                  ground: who.y,
                  y:
                    who.y +
                    (who.kind === "mimic"
                      ? 0.67
                      : heroTurn && this.spec === KEEPER
                        ? 1.35
                        : 1.14),
                  incoming: !heroTurn,
                  kind:
                    attacker.weapon === "spear"
                      ? "thrust"
                      : attacker.weapon === "axe"
                        ? "hew"
                        : heroTurn
                          ? "cut"
                          : "rake",
                }
              : undefined,
        });
      }
    }
    if (this.beatTime < duration) return;
    this.beatTime = 0;
    if (heroTurn && result.reply) {
      this.screen = "reply";
      this.contacted = false;
      this.player.mode = "guard";
      this.player.time = 0;
      this.enemy.combo = 1 + ((result.before.turn - 1) % 3);
      this.enemy.mode = "windup";
      this.enemy.time = 0;
      return;
    }
    this.screen =
      this.battle!.outcome === "won"
        ? "victory"
        : this.battle!.outcome === "lost"
          ? "defeat"
          : "choice";
    for (const actor of [this.enemy, this.player])
      if (actor.mode !== "dead") {
        actor.mode = "idle";
        actor.time = 0;
      }
  }
}

export type Action = "engage" | "attack" | "guard" | "pulse";
export interface GameState {
  phase: "explore" | "combat" | "won" | "lost";
  hp: number;
  max_hp: number;
  enemy_hp: number;
  enemy_max_hp: number;
  charge: number;
  turn: number;
  guards: number;
  secrets: string[];
  battle_score: number;
  score: number;
  secret_total: number;
  intent: "strike" | "heavy" | "recover";
  log: string;
}
export interface Run {
  id: string;
  version: string;
  revision: number;
  status: string;
  state: GameState;
}
export interface User {
  name: string;
  is_guest: boolean;
}
export interface Config {
  bot_username: string;
  shop_url: string;
  drop_url: string;
  version: string;
  title: string;
  allow_guest: boolean;
  competition_open: boolean;
  attempt_limit: number;
  request_timeout_ms?: number;
  bootstrap_attempts?: number;
}
export interface Secret {
  title: string;
  text: string;
  options: { id: string; text: string }[];
  points: number;
}
export interface Board {
  version: string;
  title: string;
  prize: boolean;
  is_guest_board: boolean;
  tie_rule: string;
  entries: { rank: number; name: string; score: number; is_me: boolean }[];
}
export interface Version {
  version: string;
  title: string;
  prize: boolean;
  current: boolean;
}

export class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class API {
  private token = "";
  user!: User;
  config!: Config;
  private network: { timeoutMs: number; attempts: number; delayMs: number };
  constructor(
    options: { timeoutMs?: number; attempts?: number; delayMs?: number } = {},
  ) {
    this.network = {
      timeoutMs: options.timeoutMs ?? 30_000,
      attempts: options.attempts ?? 3,
      delayMs: options.delayMs ?? 500,
    };
  }

  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    try {
      const response = await fetch(`/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(
          this.config?.request_timeout_ms ?? this.network.timeoutMs,
        ),
      });
      let result: Record<string, unknown>;
      try {
        result = await response.json();
      } catch {
        if (response.ok)
          throw new APIError(
            "Ответ не удалось загрузить полностью. Повтори подключение",
            0,
          );
        result = {};
      }
      if (!response.ok) {
        const detail =
          typeof result.detail === "string"
            ? result.detail
            : "Не удалось выполнить действие. Попробуй ещё раз";
        throw new APIError(detail, response.status);
      }
      return result as T;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(
        "Связь прервалась или ответ занял слишком долго. Повтори подключение",
        0,
      );
    }
  }
  private async bootstrap<T>(operation: () => Promise<T>): Promise<T> {
    const attempts = this.config?.bootstrap_attempts ?? this.network.attempts;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof APIError) ||
          (error.status !== 0 && error.status < 500 && error.status !== 429) ||
          attempt + 1 === attempts
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, this.network.delayMs * (attempt + 1)),
        );
      }
    }
    throw new APIError("Подключение не удалось", 0);
  }

  async connect(initData: string): Promise<void> {
    this.config = await this.bootstrap(() => this.request<Config>("/config"));
    // Actual Telegram launches must authenticate as Telegram. Never silently downgrade.
    if (initData) {
      const auth = await this.bootstrap(() =>
        this.request<{ token: string; user: User }>("/auth/telegram", {
          init_data: initData,
        }),
      );
      this.token = auth.token;
      this.user = auth.user;
      return;
    }
    if (!this.config.allow_guest)
      throw new Error(
        `Открой игру кнопкой ${this.config.bot_username ? "в @" + this.config.bot_username : "бота"} в Telegram`,
      );
    try {
      this.token = sessionStorage.getItem("new0-guest-session") ?? "";
      if (this.token) {
        this.user = await this.request<User>("/me");
        return;
      }
    } catch {
      this.token = "";
    }
    const auth = await this.bootstrap(() =>
      this.request<{ token: string; user: User }>("/auth/guest", {}, "POST"),
    );
    this.token = auth.token;
    this.user = auth.user;
    try {
      sessionStorage.setItem("new0-guest-session", auth.token);
    } catch {
      /* Storage is optional. */
    }
  }
  start() {
    return this.request<Run>("/runs", {});
  }
  getRun(id: string) {
    return this.request<Run>(`/runs/${id}`);
  }
  action(run: Run, action: Action) {
    return this.request<Run>(`/runs/${run.id}/actions`, {
      action,
      expected_revision: run.revision,
      request_id: this.uuid(),
    });
  }
  secret(run: Run, id: string) {
    return this.request<Secret>(`/runs/${run.id}/secrets/${id}`);
  }
  answer(run: Run, id: string, answer: string) {
    return this.request<Run>(`/runs/${run.id}/secrets/${id}`, {
      answer,
      expected_revision: run.revision,
      request_id: this.uuid(),
    });
  }
  finish(run: Run) {
    return this.request<Run>(`/runs/${run.id}/finish`, {});
  }
  board(version?: string) {
    return this.request<Board>(
      `/leaderboard${version ? "?version=" + encodeURIComponent(version) : ""}`,
    );
  }
  versions() {
    return this.request<Version[]>("/versions");
  }
  private uuid() {
    // crypto.randomUUID is unavailable over plain LAN HTTP on some mobile browsers.
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        Number(c) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
      ).toString(16),
    );
  }
}

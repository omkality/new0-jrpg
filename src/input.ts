export class Input {
  keys = new Set<string>();
  stick = { x: 0, y: 0 };
  enabled = false;
  touch =
    matchMedia("(pointer:coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    matchMedia("(max-width:700px)").matches;
  onInteract = () => {};
  onPause = () => {};
  onAction = (_action: number) => {};
  onLook = (_dx: number, _dy: number) => {};
  onAttack = () => {};
  onDodge = () => {};
  onLock = () => {};
  private guardKey = false;
  private guardPointer: number | null = null;
  private actionPointers = new Map<HTMLButtonElement, number>();
  get guarding() {
    return this.enabled && (this.guardKey || this.guardPointer !== null);
  }
  private lookPointer: number | null = null;
  private pointer: number | null = null;
  private joystick: HTMLElement;
  private knob: HTMLElement;

  constructor() {
    this.joystick = document.querySelector("#joystick")!;
    this.knob = document.querySelector("#joystick-knob")!;
    if (this.touch) document.body.classList.add("is-touch");
    window.addEventListener("keydown", (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const key = e.code;
      if (
        (key === "Space" || key === "Enter") &&
        e.target instanceof Element &&
        e.target.closest("button,a")
      )
        return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          key,
        )
      )
        e.preventDefault();
      if (e.repeat) return;
      this.keys.add(key);
      if (key === "Escape") this.onPause();
      if (!this.enabled) return;
      if (key === "KeyE") this.onInteract();
      if (key === "KeyJ") this.onAttack();
      if (["Space", "ShiftLeft", "ShiftRight", "KeyK"].includes(key))
        this.onDodge();
      if (key === "KeyF") this.guardKey = true;
      if (key === "KeyQ") this.onLock();
      if (["Digit1", "Digit2", "Digit3"].includes(key))
        this.onAction(Number(key.slice(-1)));
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyF") this.guardKey = false;
    });
    window.addEventListener("blur", () => this.reset());
    this.joystick.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.pointer !== null) return;
      this.pointer = e.pointerId;
      this.joystick.setPointerCapture(e.pointerId);
      this.move(e);
    });
    this.joystick.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.pointer) this.move(e);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.joystick.addEventListener(event, (e) => {
        if ((e as PointerEvent).pointerId === this.pointer) this.resetStick();
      });
    }
  }
  private move(e: PointerEvent) {
    const r = this.joystick.getBoundingClientRect();
    const radius = r.width * 0.34;
    let x = e.clientX - r.left - r.width / 2;
    let y = e.clientY - r.top - r.height / 2;
    const length = Math.hypot(x, y);
    if (length > radius) {
      x *= radius / length;
      y *= radius / length;
    }
    this.stick = { x: x / radius, y: y / radius };
    this.knob.style.transform = `translate(${x}px,${y}px)`;
  }
  bindLook(element: HTMLElement) {
    let lastX = 0,
      lastY = 0;
    let distance = 0;
    element.addEventListener("contextmenu", (e) => e.preventDefault());
    element.addEventListener("pointerdown", (e) => {
      if (e.button === 2 && this.enabled) {
        if (this.guardPointer !== null) return;
        this.guardPointer = e.pointerId;
        element.setPointerCapture(e.pointerId);
        return;
      }
      if (!this.enabled || this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      distance = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookPointer || !this.enabled) return;
      distance += Math.hypot(e.clientX - lastX, e.clientY - lastY);
      this.onLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      element.addEventListener(type, (e) => {
        if ((e as PointerEvent).pointerId === this.guardPointer) {
          this.guardPointer = null;
        }
        if (
          type === "pointerup" &&
          (e as PointerEvent).pointerId === this.lookPointer &&
          distance < 8 &&
          this.enabled
        )
          this.onAttack();
        if ((e as PointerEvent).pointerId === this.lookPointer)
          this.lookPointer = null;
      });
    }
  }
  bindGuard(element: HTMLElement) {
    element.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.guardPointer !== null) return;
      this.guardPointer = e.pointerId;
      element.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      element.addEventListener(name, (e) => {
        if ((e as PointerEvent).pointerId === this.guardPointer) {
          this.guardPointer = null;
        }
      });
  }
  bindAction(button: HTMLButtonElement, action: () => void) {
    button.addEventListener("pointerdown", (e) => {
      if (
        e.button !== 0 ||
        !this.enabled ||
        button.disabled ||
        this.actionPointers.has(button)
      )
        return;
      button.setPointerCapture(e.pointerId);
      this.actionPointers.set(button, e.pointerId);
    });
    for (const type of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      button.addEventListener(type, (e) => {
        if (this.actionPointers.get(button) !== e.pointerId) return;
        this.actionPointers.delete(button);
        if (
          type === "pointerup" &&
          this.enabled &&
          !button.disabled &&
          button.contains(document.elementFromPoint(e.clientX, e.clientY))
        )
          action();
      });
    // Pointer activation is handled above, including secondary touch pointers.
    // Keep native keyboard and assistive-technology activation.
    button.addEventListener("click", (e) => {
      if (e.detail === 0 && this.enabled && !button.disabled) action();
    });
  }
  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x =
      this.stick.x +
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    let y =
      this.stick.y +
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    if (length < 0.12) return { x: 0, y: 0 };
    return { x, y };
  }
  private resetStick() {
    this.pointer = null;
    this.stick = { x: 0, y: 0 };
    this.knob.style.transform = "";
  }
  reset() {
    this.actionPointers.clear();
    this.keys.clear();
    this.lookPointer = null;
    this.guardKey = false;
    this.guardPointer = null;
    this.resetStick();
  }
}

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
      if (key === "KeyE" || key === "Space") this.onInteract();
      if (["Digit1", "Digit2", "Digit3"].includes(key))
        this.onAction(Number(key.slice(-1)));
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
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
    element.addEventListener("contextmenu", (e) => e.preventDefault());
    element.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookPointer || !this.enabled) return;
      this.onLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      element.addEventListener(type, (e) => {
        if ((e as PointerEvent).pointerId === this.lookPointer)
          this.lookPointer = null;
      });
    }
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
    this.keys.clear();
    this.lookPointer = null;
    this.resetStick();
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { Input } from "../src/input.ts";

class FakeElement extends EventTarget {
  style = {};
  captured = null;
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
  setPointerCapture(id) {
    this.captured = id;
  }
  closest() {
    return null;
  }
}
class FakeButton extends FakeElement {
  closest() {
    return this;
  }
}
globalThis.Element = FakeElement;
globalThis.HTMLInputElement = class extends FakeElement {};
globalThis.HTMLSelectElement = class extends FakeElement {};

function setup() {
  const joystick = new FakeElement(),
    knob = new FakeElement();
  globalThis.window = new EventTarget();
  globalThis.document = {
    querySelector: (s) => (s === "#joystick" ? joystick : knob),
    body: { classList: { add() {} } },
  };
  globalThis.matchMedia = () => ({ matches: false });
  Object.defineProperty(globalThis, "navigator", {
    value: { maxTouchPoints: 0 },
    configurable: true,
  });
  const input = new Input();
  input.enabled = true;
  return { input, joystick, knob };
}
function dispatch(target, type, properties) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

test("held movement persists until keyup and diagonals stay normalized", () => {
  const { input } = setup();
  dispatch(window, "keydown", { code: "KeyW", repeat: false });
  assert.deepEqual(input.axis(), { x: 0, y: -1 });
  assert.deepEqual(input.axis(), { x: 0, y: -1 });
  dispatch(window, "keydown", { code: "KeyD", repeat: false });
  assert.ok(Math.abs(Math.hypot(input.axis().x, input.axis().y) - 1) < 1e-10);
  dispatch(window, "keyup", { code: "KeyW" });
  assert.deepEqual(input.axis(), { x: 1, y: 0 });
  dispatch(window, "blur", {});
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
});

test("stick clamps its radius, ignores a second finger and releases on cancel", () => {
  const { input, joystick, knob } = setup();
  dispatch(joystick, "pointerdown", {
    pointerId: 1,
    clientX: 120,
    clientY: 50,
  });
  assert.equal(joystick.captured, 1);
  assert.deepEqual(input.axis(), { x: 1, y: 0 });
  dispatch(joystick, "pointerdown", { pointerId: 2, clientX: 0, clientY: 50 });
  assert.deepEqual(input.axis(), { x: 1, y: 0 });
  dispatch(joystick, "pointercancel", { pointerId: 1 });
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
  assert.equal(knob.style.transform, "");
});

test("lost pointer capture and disabled input cannot leave the character moving", () => {
  const { input, joystick } = setup();
  dispatch(joystick, "pointerdown", { pointerId: 7, clientX: 50, clientY: 0 });
  assert.equal(input.axis().y, -1);
  dispatch(joystick, "lostpointercapture", { pointerId: 7 });
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
  input.enabled = false;
  dispatch(joystick, "pointerdown", { pointerId: 8, clientX: 90, clientY: 50 });
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
});

test("space remains available to focused buttons", () => {
  setup();
  const button = new FakeButton();
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    code: { value: "Space" },
    target: { value: button },
    repeat: { value: false },
  });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test("camera drag and movement stick use independent fingers and stop on cancel", () => {
  const { input, joystick } = setup();
  const canvas = new FakeElement(),
    deltas = [];
  input.bindLook(canvas);
  input.onLook = (x, y) => deltas.push([x, y]);
  dispatch(joystick, "pointerdown", { pointerId: 1, clientX: 50, clientY: 0 });
  dispatch(canvas, "pointerdown", { pointerId: 2, clientX: 200, clientY: 100 });
  dispatch(canvas, "pointermove", { pointerId: 2, clientX: 220, clientY: 95 });
  assert.deepEqual(deltas, [[20, -5]]);
  assert.equal(input.axis().y, -1);
  dispatch(canvas, "pointermove", { pointerId: 3, clientX: 900, clientY: 900 });
  assert.equal(deltas.length, 1);
  dispatch(canvas, "pointercancel", { pointerId: 2 });
  dispatch(canvas, "pointermove", { pointerId: 2, clientX: 250, clientY: 95 });
  assert.equal(deltas.length, 1);
  dispatch(joystick, "pointerup", { pointerId: 1 });
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
  dispatch(canvas, "pointerdown", { pointerId: 4, clientX: 10, clientY: 10 });
  input.reset();
  dispatch(canvas, "pointermove", { pointerId: 4, clientX: 30, clientY: 10 });
  assert.equal(deltas.length, 1);
});

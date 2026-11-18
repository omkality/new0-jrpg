import { Campaign } from "../../../src/campaign";
import { Input } from "../../../src/input";
import { World } from "../../../src/world";
import type { InstancedMesh } from "three";

const input = new Input();
const actions: { action: string; axis: { x: number; y: number } }[] = [];
input.enabled = true;
for (const action of ["attack", "dodge"])
  input.bindAction(
    document.querySelector<HTMLButtonElement>(`#${action}`)!,
    () => actions.push({ action, axis: input.axis() }),
  );

async function disposeWorlds() {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false })!;
  const deleteBuffer = gl.deleteBuffer.bind(gl);
  let deleted = 0;
  gl.deleteBuffer = (buffer) => {
    if (buffer) deleted++;
    deleteBuffer(buffer);
  };
  const results = [];
  try {
    for (let pass = 0; pass < 2; pass++) {
      const world = new World(canvas, new Campaign());
      await world.load();
      const instances: InstancedMesh[] = [];
      let events = 0;
      world.scene.traverse((object) => {
        const mesh = object as InstancedMesh;
        if (mesh.isInstancedMesh) {
          instances.push(mesh);
          mesh.addEventListener("dispose", () => events++);
        }
      });
      const before = deleted;
      await Promise.all([world.dispose(), world.dispose()]);
      const after = deleted;
      const disposeEvents = events;
      for (const mesh of instances) mesh.dispose();
      results.push({
        instances: instances.length,
        disposeEvents,
        buffersDeleted: after - before,
        lateDeletes: deleted - after,
      });
    }
    return results;
  } finally {
    gl.deleteBuffer = deleteBuffer;
  }
}

async function rejectRecordingFrame() {
  const { CanvasSource, Output } = await import("mediabunny");
  const { FrameCapture } = await import("../../../src/recording");
  const add = CanvasSource.prototype.add;
  const cancel = Output.prototype.cancel;
  const error = new Error("Test encoder failure");
  let cancelled = 0;
  CanvasSource.prototype.add = () => Promise.reject(error);
  Output.prototype.cancel = function () {
    cancelled++;
    return cancel.call(this);
  };
  try {
    const capture = new FrameCapture(
      document.querySelector<HTMLCanvasElement>("#canvas")!,
    );
    await capture.start();
    const rejectedAdd = await capture
      .add()
      .catch((failure) => failure === error);
    const rejectedFinish = await capture
      .finish()
      .catch((failure) => failure === error);
    return {
      rejectedAdd,
      rejectedFinish,
      cancelled,
      frames: capture.frames,
      busy: capture.busy,
    };
  } finally {
    CanvasSource.prototype.add = add;
    Output.prototype.cancel = cancel;
  }
}

Object.assign(window, {
  auditLab: {
    actions,
    axis: () => input.axis(),
    disposeWorlds,
    rejectRecordingFrame,
  },
});

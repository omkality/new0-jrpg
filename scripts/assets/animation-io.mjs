import { Document } from "@gltf-transform/core";
import { createHash } from "node:crypto";

/** Copy only animation-referenced rig nodes and accessors into a fresh document. */
export function animationOnly(
  source,
  selected = source.getRoot().listAnimations(),
) {
  const output = new Document();
  const sourceRoot = source.getRoot(),
    root = output.getRoot();
  const parents = new Map();
  for (const node of sourceRoot.listNodes()) {
    for (const child of node.listChildren()) parents.set(child, node);
  }
  const kept = new Set();
  for (const animation of selected)
    for (const channel of animation.listChannels()) {
      let node = channel.getTargetNode();
      while (node) {
        kept.add(node);
        node = parents.get(node);
      }
    }
  const nodes = new Map();
  for (const node of kept)
    nodes.set(
      node,
      output
        .createNode(node.getName())
        .setTranslation(node.getTranslation())
        .setRotation(node.getRotation())
        .setScale(node.getScale()),
    );
  for (const [node, copied] of nodes)
    for (const child of node.listChildren()) {
      if (nodes.has(child)) copied.addChild(nodes.get(child));
    }
  const scene = output.createScene("motion-rig");
  root.setDefaultScene(scene);
  for (const [node, copied] of nodes)
    if (!nodes.has(parents.get(node))) scene.addChild(copied);
  const buffer = output.createBuffer("motion-data");
  const accessors = new Map();
  function copyAccessor(accessor) {
    if (!accessors.has(accessor)) {
      const values = accessor.getArray();
      accessors.set(
        accessor,
        output
          .createAccessor(accessor.getName())
          .setType(accessor.getType())
          .setNormalized(accessor.getNormalized())
          .setArray(new values.constructor(values))
          .setBuffer(buffer),
      );
    }
    return accessors.get(accessor);
  }
  for (const animation of selected) {
    const copy = output
      .createAnimation(animation.getName())
      .setExtras(animation.getExtras());
    const samplers = new Map();
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      if (!samplers.has(sampler))
        samplers.set(
          sampler,
          output
            .createAnimationSampler()
            .setInput(copyAccessor(sampler.getInput()))
            .setOutput(copyAccessor(sampler.getOutput()))
            .setInterpolation(sampler.getInterpolation()),
        );
      copy.addSampler(samplers.get(sampler));
      copy.addChannel(
        output
          .createAnimationChannel()
          .setTargetNode(nodes.get(channel.getTargetNode()))
          .setTargetPath(channel.getTargetPath())
          .setSampler(samplers.get(sampler)),
      );
    }
  }
  Object.assign(root.getAsset(), {
    copyright: sourceRoot.getAsset().copyright,
    extras: sourceRoot.getAsset().extras,
  });
  return output;
}

/** Bind a copied animation to another document by the shared joint names. */
export function copyAnimation(sourceAnimation, target) {
  const byName = new Map(
    target
      .getRoot()
      .listNodes()
      .map((node) => [node.getName(), node]),
  );
  const buffer =
    target.getRoot().listBuffers()[0] ?? target.createBuffer("motion-data");
  const copy = target
    .createAnimation(sourceAnimation.getName())
    .setExtras(sourceAnimation.getExtras());
  const samplers = new Map(),
    accessors = new Map();
  function accessor(source) {
    if (!accessors.has(source)) {
      const values = source.getArray();
      accessors.set(
        source,
        target
          .createAccessor(source.getName())
          .setType(source.getType())
          .setNormalized(source.getNormalized())
          .setArray(new values.constructor(values))
          .setBuffer(buffer),
      );
    }
    return accessors.get(source);
  }
  for (const channel of sourceAnimation.listChannels()) {
    const original = channel.getSampler(),
      node = byName.get(channel.getTargetNode().getName());
    if (!node)
      throw new Error(`Missing joint ${channel.getTargetNode().getName()}`);
    if (!samplers.has(original))
      samplers.set(
        original,
        target
          .createAnimationSampler()
          .setInput(accessor(original.getInput()))
          .setOutput(accessor(original.getOutput()))
          .setInterpolation(original.getInterpolation()),
      );
    copy.addSampler(samplers.get(original));
    copy.addChannel(
      target
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(channel.getTargetPath())
        .setSampler(samplers.get(original)),
    );
  }
  return copy;
}

export function animationDigest(animation) {
  const hash = createHash("sha256");
  for (const channel of [...animation.listChannels()].sort((a, b) =>
    `${a.getTargetNode().getName()}/${a.getTargetPath()}`.localeCompare(
      `${b.getTargetNode().getName()}/${b.getTargetPath()}`,
    ),
  )) {
    hash.update(
      `${channel.getTargetNode().getName()}/${channel.getTargetPath()}`,
    );
    for (const accessor of [
      channel.getSampler().getInput(),
      channel.getSampler().getOutput(),
    ]) {
      const values = accessor.getArray();
      hash.update(
        Buffer.from(values.buffer, values.byteOffset, values.byteLength),
      );
    }
  }
  return hash.digest("hex");
}

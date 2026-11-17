// Original FK/IK pose authoring. Coordinates use the source rig's +Z forward axis.
export function makeCombatPoses(rig) {
  const { clonePose, body, plantedLegs, arms, rotateWorld } = rig;
  const X = rig.axes.X,
    Y = rig.axes.Y,
    Z = rig.axes.Z;
  const guard = {
    down: 0.05,
    x: 0,
    z: 0,
    yaw: -0.06,
    lean: 0.08,
    twist: 0.08,
    side: 0,
    headPitch: 0,
    headYaw: 0,
    shoulderR: 0,
    shoulderL: 0,
    footL: [0.03, 0, 0.09],
    footR: [-0.03, 0, -0.08],
    right: [-0.24, 1.36, 0.36],
    left: [0.23, 1.29, 0.26],
    blade: [-0.08, 0.9, 0.33],
    pole: [-0.7, 1.36, 0.05],
    leftPole: [0.7, 1.25, 0.08],
  };
  const fields = Object.keys(guard);
  function flat(input) {
    const c = { ...guard, ...input };
    return fields.flatMap((key) => (Array.isArray(c[key]) ? c[key] : [c[key]]));
  }
  function unflat(values) {
    const c = {};
    let offset = 0;
    for (const key of fields) {
      if (Array.isArray(guard[key])) {
        c[key] = values.slice(offset, offset + 3);
        offset += 3;
      } else c[key] = values[offset++];
    }
    c.down = Math.max(0, c.down);
    c.footL[1] = Math.max(0, c.footL[1]);
    c.footR[1] = Math.max(0, c.footR[1]);
    return c;
  }
  function pose(config) {
    const p = clonePose();
    body(p, config);
    rotateWorld(p, "clavicle_R", Z, config.shoulderR ?? 0);
    rotateWorld(p, "clavicle_L", Z, config.shoulderL ?? 0);
    rotateWorld(p, "head", X, config.headPitch ?? 0);
    rotateWorld(p, "head", Y, config.headYaw ?? 0);
    plantedLegs(p, config.footL, config.footR);
    arms(
      p,
      config.right,
      config.left,
      config.blade,
      config.pole,
      config.leftPole,
    );
    return p;
  }
  // C1 Hermite parameter curves. IK is solved again at every exported sample,
  // so planted feet and hand targets do not drift between quaternion key poses.
  function curve(keys, tension = 0.72) {
    const points = keys.map(([time, c]) => ({ time, values: flat(c) }));
    function tangent(i) {
      if (i === 0 || i === points.length - 1)
        return points[i].values.map(() => 0);
      const a = points[i - 1],
        b = points[i + 1];
      return a.values.map(
        (v, k) => ((b.values[k] - v) / (b.time - a.time)) * tension,
      );
    }
    return (time) => {
      let i = 0;
      while (i < points.length - 2 && time > points[i + 1].time) i++;
      const a = points[i],
        b = points[i + 1],
        span = b.time - a.time;
      const u = Math.max(0, Math.min(1, (time - a.time) / span));
      const m0 = tangent(i),
        m1 = tangent(i + 1);
      const h00 = 2 * u * u * u - 3 * u * u + 1,
        h10 = u * u * u - 2 * u * u + u;
      const h01 = -2 * u * u * u + 3 * u * u,
        h11 = u * u * u - u * u;
      const values = a.values.map(
        (v, k) =>
          h00 * v + h10 * span * m0[k] + h01 * b.values[k] + h11 * span * m1[k],
      );
      const derivative = a.values.map(
        (v, k) =>
          ((6 * u * u - 6 * u) * v +
            (3 * u * u - 4 * u + 1) * span * m0[k] +
            (-6 * u * u + 6 * u) * b.values[k] +
            (3 * u * u - 2 * u) * span * m1[k]) /
          span,
      );
      return { values, derivative };
    };
  }
  // Link points .52 and 1.03 lie inside moving segments, not in a Guard reset.
  const combo = curve([
    [0, guard],
    [
      0.1,
      {
        down: 0.065,
        yaw: -0.1,
        twist: -0.1,
        x: -0.02,
        shoulderR: -0.025,
        right: [-0.3, 1.42, 0.27],
        blade: [-0.15, 0.94, 0.1],
      },
    ],
    [
      0.205,
      {
        down: 0.085,
        yaw: -0.22,
        twist: -0.34,
        lean: 0.02,
        x: -0.025,
        right: [-0.43, 1.57, -0.015],
        left: [0.28, 1.29, 0.23],
        blade: [-0.25, 0.91, -0.22],
        pole: [-0.8, 1.55, -0.18],
        shoulderR: -0.045,
        headYaw: 0.055,
        footL: [0.03, 0, 0.11],
        footR: [-0.04, 0, -0.12],
      },
    ],
    [
      0.265,
      {
        down: 0.09,
        yaw: -0.035,
        twist: -0.12,
        lean: 0.12,
        z: 0.025,
        right: [-0.34, 1.48, 0.26],
        left: [0.27, 1.28, 0.22],
        blade: [-0.02, 0.22, 0.97],
        shoulderR: -0.05,
        headYaw: 0.025,
        footL: [0.04, 0, 0.16],
        footR: [-0.04, 0, -0.12],
      },
    ],
    [
      0.3,
      {
        down: 0.105,
        yaw: 0.1,
        twist: 0.22,
        lean: 0.23,
        x: 0.02,
        z: 0.045,
        right: [-0.1, 1.28, 0.56],
        left: [0.28, 1.24, 0.2],
        blade: [0.23, -0.25, 0.94],
        pole: [-0.68, 1.34, 0.32],
        shoulderR: -0.015,
        headPitch: 0.025,
        footL: [0.05, 0, 0.17],
        footR: [-0.04, 0, -0.1],
      },
    ],
    [
      0.365,
      {
        down: 0.1,
        yaw: 0.26,
        twist: 0.42,
        lean: 0.22,
        x: 0.035,
        z: 0.055,
        right: [0.29, 1.04, 0.4],
        left: [0.29, 1.18, 0.19],
        blade: [0.94, -0.27, 0.28],
        pole: [-0.38, 1.12, 0.4],
        headYaw: -0.045,
        footL: [0.05, 0, 0.17],
        footR: [-0.04, 0, -0.1],
      },
    ],
    [
      0.445,
      {
        down: 0.08,
        yaw: 0.255,
        twist: 0.4,
        lean: 0.16,
        x: 0.025,
        z: 0.04,
        right: [0.32, 1.08, 0.29],
        left: [0.3, 1.19, 0.18],
        blade: [0.88, 0.24, -0.35],
        pole: [-0.3, 1.27, 0.44],
        footL: [0.05, 0, 0.17],
        footR: [-0.04, 0, -0.1],
      },
    ],
    [
      0.625,
      {
        down: 0.09,
        yaw: 0.245,
        twist: 0.47,
        lean: 0.075,
        x: 0.02,
        z: 0.025,
        right: [0.33, 1.34, 0.18],
        left: [0.32, 1.13, 0.17],
        blade: [0.55, 0.43, -0.66],
        pole: [-0.23, 1.43, 0.49],
        shoulderR: -0.025,
        headYaw: -0.065,
        footL: [0.05, 0, 0.17],
        footR: [-0.045, 0.025, -0.035],
      },
    ],
    [
      0.73,
      {
        down: 0.1,
        yaw: 0.05,
        twist: 0.17,
        lean: 0.12,
        z: 0.04,
        right: [0.17, 1.36, 0.43],
        left: [0.31, 1.14, 0.18],
        blade: [-0.05, 0.17, 0.98],
        pole: [-0.4, 1.42, 0.5],
        footL: [0.045, 0, 0.15],
        footR: [-0.05, 0.035, 0.09],
      },
    ],
    [
      0.79,
      {
        down: 0.105,
        yaw: -0.13,
        twist: -0.23,
        lean: 0.2,
        x: -0.015,
        z: 0.055,
        right: [-0.19, 1.27, 0.59],
        left: [0.31, 1.16, 0.18],
        blade: [-0.47, 0.02, 0.88],
        pole: [-0.69, 1.39, 0.32],
        headYaw: 0.035,
        footL: [0.045, 0, 0.14],
        footR: [-0.05, 0, 0.14],
      },
    ],
    [
      0.875,
      {
        down: 0.075,
        yaw: -0.25,
        twist: -0.39,
        lean: 0.15,
        x: -0.025,
        z: 0.04,
        right: [-0.47, 1.14, 0.27],
        left: [0.3, 1.18, 0.2],
        blade: [-0.92, -0.1, 0.3],
        pole: [-0.8, 1.23, -0.015],
        headYaw: 0.055,
        footL: [0.04, 0, 0.11],
        footR: [-0.05, 0, 0.14],
      },
    ],
    [
      0.95,
      {
        down: 0.08,
        yaw: -0.2,
        twist: -0.3,
        lean: 0.09,
        z: 0.02,
        right: [-0.36, 1.25, 0.22],
        left: [0.22, 1.26, 0.22],
        blade: [-0.65, 0.65, 0.22],
        pole: [-0.75, 1.4, 0.02],
        shoulderR: -0.035,
        footL: [0.04, 0, 0.07],
        footR: [-0.045, 0, 0.11],
      },
    ],
    [
      1.18,
      {
        down: 0.1,
        yaw: -0.055,
        twist: -0.13,
        lean: -0.015,
        right: [-0.17, 1.57, 0.1],
        left: [0.1, 1.49, 0.11],
        blade: [-0.05, 0.99, -0.08],
        pole: [-0.66, 1.64, -0.12],
        leftPole: [0.62, 1.52, -0.03],
        shoulderR: -0.065,
        shoulderL: 0.035,
        headPitch: -0.025,
        footL: [0.04, 0, 0.04],
        footR: [-0.035, 0, -0.13],
      },
    ],
    [
      1.325,
      {
        down: 0.145,
        yaw: -0.035,
        twist: -0.105,
        lean: -0.09,
        z: -0.015,
        right: [-0.12, 1.72, -0.025],
        left: [0.1, 1.65, 0.015],
        blade: [0, 1, -0.19],
        pole: [-0.66, 1.7, -0.22],
        leftPole: [0.62, 1.62, -0.12],
        shoulderR: -0.075,
        shoulderL: 0.055,
        headPitch: -0.035,
        footL: [0.04, 0, 0.035],
        footR: [-0.035, 0, -0.15],
      },
    ],
    [
      1.395,
      {
        down: 0.15,
        yaw: 0.025,
        twist: 0.02,
        lean: 0.16,
        z: 0.04,
        right: [-0.1, 1.55, 0.34],
        left: [0.11, 1.47, 0.31],
        blade: [0, 0.43, 0.9],
        pole: [-0.65, 1.64, 0.05],
        leftPole: [0.62, 1.52, 0.09],
        shoulderR: -0.055,
        shoulderL: 0.04,
        footL: [0.04, 0.025, 0.22],
        footR: [-0.035, 0, -0.12],
      },
    ],
    [
      1.45,
      {
        down: 0.17,
        yaw: 0.045,
        twist: 0.1,
        lean: 0.3,
        z: 0.075,
        right: [-0.09, 1.27, 0.57],
        left: [0.11, 1.22, 0.49],
        blade: [0.03, -0.43, 0.9],
        pole: [-0.65, 1.41, 0.2],
        leftPole: [0.61, 1.3, 0.13],
        shoulderR: -0.015,
        shoulderL: 0.015,
        headPitch: 0.035,
        footL: [0.04, 0, 0.27],
        footR: [-0.035, 0, -0.09],
      },
    ],
    [
      1.565,
      {
        down: 0.18,
        yaw: 0.06,
        twist: 0.12,
        lean: 0.43,
        z: 0.085,
        right: [-0.1, 0.85, 0.58],
        left: [0.12, 0.87, 0.49],
        blade: [0.05, -0.65, 0.62],
        pole: [-0.65, 1.06, 0.3],
        leftPole: [0.63, 1.04, 0.25],
        headPitch: 0.04,
        footL: [0.04, 0, 0.28],
        footR: [-0.035, 0, -0.08],
      },
    ],
    [
      1.735,
      {
        down: 0.115,
        yaw: 0.02,
        twist: 0.045,
        lean: 0.24,
        z: 0.035,
        right: [-0.18, 1.02, 0.42],
        left: [0.17, 1.06, 0.35],
        blade: [0.02, -0.2, 0.98],
        headPitch: -0.015,
        footL: [0.04, 0, 0.18],
        footR: [-0.03, 0, -0.08],
      },
    ],
    [
      1.89,
      {
        ...guard,
        down: 0.065,
        lean: 0.115,
        right: [-0.24, 1.24, 0.38],
        blade: [-0.05, 0.65, 0.62],
      },
    ],
    [2.03, guard],
  ]);
  const guardValues = flat(guard);
  function attackConfig(offset, link, duration, time) {
    if (link === null || time <= link)
      return unflat(combo(offset + time).values);
    // The standalone recovery branches off with the incoming derivative intact.
    const start = combo(offset + link),
      span = duration - link;
    const u = Math.max(0, Math.min(1, (time - link) / span));
    const values = start.values.map(
      (v, k) =>
        (2 * u * u * u - 3 * u * u + 1) * v +
        (u * u * u - 2 * u * u + u) * span * start.derivative[k] +
        (-2 * u * u * u + 3 * u * u) * guardValues[k],
    );
    return unflat(values);
  }
  const contract = {
    Attack1: { duration: 0.74, contact: 0.3, link: 0.52 },
    Attack2: { duration: 0.7, contact: 0.27, link: 0.51 },
    Attack3: { duration: 1.0, contact: 0.42, link: null },
  };
  const descriptors = [
    {
      name: "Attack1",
      duration: 0.74,
      landmarks: [0.3, 0.52 - 1 / 600, 0.52, 0.52 + 1 / 600],
      poseAt: (t) => pose(attackConfig(0, 0.52, 0.74, t)),
    },
    {
      name: "Attack2",
      duration: 0.7,
      landmarks: [1 / 600, 0.27, 0.51 - 1 / 600, 0.51, 0.51 + 1 / 600],
      poseAt: (t) => pose(attackConfig(0.52, 0.51, 0.7, t)),
    },
    {
      name: "Attack3",
      duration: 1.0,
      landmarks: [1 / 600, 0.42],
      poseAt: (t) => pose(attackConfig(1.03, null, 1, t)),
    },
  ];
  function motion(name, duration, anchors, landmarks = []) {
    const f = curve(anchors, 0.62);
    descriptors.push({
      name,
      duration,
      landmarks,
      poseAt: (t) => pose(unflat(f(t).values)),
    });
  }
  for (const [name, side] of [
    ["DodgeLeft", 1],
    ["DodgeRight", -1],
  ])
    motion(name, 0.52, [
      [0, guard],
      [
        0.075,
        {
          ...guard,
          down: 0.105,
          lean: 0.16,
          x: -side * 0.02,
          side: side * 0.045,
          headYaw: -side * 0.035,
          right: [-0.27, 1.3, 0.32],
          left: [0.26, 1.27, 0.25],
          blade: [-0.08, 0.7, 0.65],
        },
      ],
      [
        0.18,
        {
          ...guard,
          down: 0.12,
          lean: 0.2,
          x: side * 0.045,
          side: -side * 0.125,
          yaw: side * 0.045,
          footL: [0.03 + side * 0.075, Math.max(0, side) * 0.025, 0.1],
          footR: [-0.03 + side * 0.075, Math.max(0, -side) * 0.025, -0.09],
          right: [-0.28, 1.27, 0.31],
          left: [0.27, 1.25, 0.25],
          blade: [-0.08, 0.65, 0.7],
        },
      ],
      [
        0.3,
        {
          ...guard,
          down: 0.135,
          lean: 0.14,
          x: side * 0.055,
          side: -side * 0.09,
          footL: [0.03 + side * 0.105, Math.max(0, -side) * 0.03, 0.1],
          footR: [-0.03 + side * 0.045, Math.max(0, side) * 0.03, -0.08],
          right: [-0.28, 1.27, 0.31],
          left: [0.27, 1.25, 0.25],
          blade: [-0.08, 0.7, 0.65],
        },
      ],
      [
        0.415,
        {
          ...guard,
          down: 0.07,
          lean: 0.1,
          x: side * 0.02,
          side: -side * 0.025,
          footL: [0.03 + side * 0.035, 0, 0.09],
          footR: [-0.03 + side * 0.02, 0, -0.08],
        },
      ],
      [0.52, guard],
    ]);
  motion("DodgeBack", 0.52, [
    [0, guard],
    [0.075, { ...guard, down: 0.1, lean: 0.15, z: 0.02 }],
    [
      0.18,
      {
        ...guard,
        down: 0.12,
        lean: 0.19,
        z: -0.055,
        footL: [0.04, 0.03, 0.025],
        footR: [-0.035, 0, -0.2],
        right: [-0.26, 1.3, 0.3],
        left: [0.24, 1.28, 0.23],
        blade: [-0.04, 0.75, 0.6],
      },
    ],
    [
      0.3,
      {
        ...guard,
        down: 0.13,
        lean: 0.14,
        z: -0.045,
        footL: [0.04, 0, -0.015],
        footR: [-0.035, 0, -0.22],
        right: [-0.27, 1.31, 0.31],
      },
    ],
    [0.415, { ...guard, down: 0.065, lean: 0.1, z: -0.015 }],
    [0.52, guard],
  ]);
  motion("DodgeForward", 0.52, [
    [0, guard],
    [0.075, { ...guard, down: 0.105, lean: 0.18, z: -0.02 }],
    [
      0.18,
      {
        ...guard,
        down: 0.13,
        lean: 0.27,
        z: 0.045,
        footL: [0.04, 0.035, 0.22],
        footR: [-0.035, 0, -0.16],
        right: [-0.28, 1.26, 0.34],
        left: [0.26, 1.24, 0.25],
        blade: [-0.04, 0.45, 0.85],
      },
    ],
    [
      0.3,
      {
        ...guard,
        down: 0.14,
        lean: 0.21,
        z: 0.055,
        footL: [0.04, 0, 0.23],
        footR: [-0.035, 0.025, -0.09],
        right: [-0.28, 1.27, 0.34],
        left: [0.26, 1.25, 0.25],
        blade: [-0.04, 0.55, 0.8],
      },
    ],
    [0.415, { ...guard, down: 0.07, lean: 0.12, z: 0.02 }],
    [0.52, guard],
  ]);
  for (const [name, side, duration] of [
    ["HitFront", 0, 0.4],
    ["HitLeft", -1, 0.42],
    ["HitRight", 1, 0.46],
  ])
    motion(name, duration, [
      [0, guard],
      [
        0.045,
        {
          ...guard,
          down: 0.065,
          z: -0.01,
          lean: -0.06,
          side: side * 0.055,
          twist: -side * 0.055,
          shoulderR: -0.025,
          shoulderL: 0.025,
          right: [-0.29, 1.33, 0.3],
          left: [0.28, 1.31, 0.23],
        },
      ],
      [
        0.105,
        {
          ...guard,
          down: 0.085,
          x: -side * 0.05,
          z: -0.025,
          lean: -0.17,
          side: side * 0.14,
          twist: -side * 0.16,
          headPitch: -0.025,
          headYaw: side * 0.035,
          right: [-0.37, 1.24, 0.22],
          left: [0.37, 1.3, 0.16],
          blade: [0.18, 0.45, 0.75],
          shoulderR: -0.05,
          shoulderL: 0.045,
        },
      ],
      [
        0.17,
        {
          ...guard,
          down: 0.075,
          x: -side * 0.035,
          z: -0.015,
          lean: -0.08,
          side: side * 0.095,
          twist: -side * 0.1,
          headPitch: -0.095,
          headYaw: side * 0.07,
          right: [-0.39, 1.18, 0.22],
          left: [0.38, 1.25, 0.16],
          blade: [0.22, 0.2, 0.88],
          shoulderR: -0.025,
          shoulderL: 0.025,
        },
      ],
      [
        0.265,
        {
          ...guard,
          down: 0.06,
          x: -side * 0.009,
          lean: 0.1,
          side: -side * 0.02,
          twist: side * 0.025,
          headPitch: -0.035,
          right: [-0.29, 1.29, 0.31],
          left: [0.28, 1.3, 0.23],
          blade: [0.03, 0.72, 0.65],
        },
      ],
      [
        duration - 0.055,
        { ...guard, down: 0.045, lean: 0.075, headPitch: 0.015 },
      ],
      [duration, guard],
    ]);
  motion("Guard", 0.8, [
    [0, guard],
    [
      0.4,
      {
        ...guard,
        down: 0.045,
        lean: 0.083,
        right: [-0.24, 1.365, 0.36],
        left: [0.23, 1.295, 0.26],
      },
    ],
    [0.8, guard],
  ]);
  motion("BlockHit", 0.32, [
    [0, guard],
    [
      0.045,
      {
        ...guard,
        down: 0.065,
        lean: 0.02,
        z: -0.01,
        right: [-0.26, 1.39, 0.29],
        left: [0.21, 1.34, 0.23],
        blade: [-0.05, 0.95, 0.24],
        shoulderR: -0.025,
      },
    ],
    [
      0.1,
      {
        ...guard,
        down: 0.09,
        lean: -0.085,
        z: -0.027,
        twist: -0.085,
        headPitch: -0.025,
        right: [-0.28, 1.38, 0.28],
        left: [0.2, 1.35, 0.22],
        blade: [-0.05, 0.95, 0.24],
        shoulderR: -0.035,
        shoulderL: 0.025,
      },
    ],
    [
      0.19,
      {
        ...guard,
        down: 0.07,
        lean: 0.055,
        z: -0.012,
        twist: -0.035,
        right: [-0.26, 1.37, 0.32],
        left: [0.22, 1.32, 0.24],
        blade: [-0.06, 0.92, 0.29],
      },
    ],
    [0.26, { ...guard, down: 0.046, lean: 0.088 }],
    [0.32, guard],
  ]);
  return { descriptors, contract };
}

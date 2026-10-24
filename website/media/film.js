const STYLE = {
  bg: "#11151c",
  ink: "#f1f3f6",
  muted: "#a5b0c0",
  gold: "#dcc49a",
  line: "#303946",
  panel: "#1b2029",
};
(() => {
  const canvas = document.querySelector("canvas"),
    c = canvas.getContext("2d"),
    W = 1280,
    H = 720,
    T = window.GUIDE_TIMING,
    starts = T.chapters;
  canvas.width = W;
  canvas.height = H;
  const images = {},
    ready = Promise.all(
      Object.entries(window.GUIDE_ASSETS).map(
        ([key, src]) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              images[key] = image;
              resolve();
            };
            image.onerror = () => reject(Error(`Asset not loaded: ${key}`));
            image.src = src;
          }),
      ),
    );
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n)),
    ease = (n) => 1 - (1 - clamp(n)) ** 3,
    mix = (a, b, t) => a + (b - a) * t;
  let issues = [],
    boxes = [];
  const font = (size, weight = 400) =>
    `${weight} ${size}px -apple-system,BlinkMacSystemFont,Arial,sans-serif`;
  function text(value, x, y, size = 28, color = STYLE.ink, weight = 400) {
    c.font = font(size, weight);
    c.fillStyle = color;
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
    c.fillText(value, x, y);
    if (c.globalAlpha > 0.05) {
      const m = c.measureText(value),
        b = { value, x, y: y - size * 0.83, w: m.width, h: size * 1.04 };
      boxes.push(b);
      if (x < 42 || x + m.width > W - 42 || b.y < 18 || b.y + b.h > H - 16)
        issues.push(`Text outside safe area: ${value}`);
    }
  }
  function rr(x, y, w, h, r = 13) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }
  function rule(x, y, w, color = STYLE.line) {
    c.fillStyle = color;
    c.fillRect(x, y, w, 1);
  }
  function line(x, y, w, p = 1) {
    c.fillStyle = STYLE.gold;
    c.fillRect(x, y, w * clamp(p), 2);
  }
  function title(lines, x = 64, y = 232, size = 64) {
    lines.forEach((s, i) => {
      text(
        s,
        x,
        y + i * (size + 9),
        size,
        i === lines.length - 1 ? STYLE.gold : STYLE.ink,
      );
    });
  }
  function screen(key, x, y, w, h, crop = [0, 0, 1100, 760], alpha = 1) {
    c.save();
    c.globalAlpha = alpha;
    c.shadowColor = "#00000080";
    c.shadowBlur = 30;
    c.shadowOffsetY = 12;
    c.fillStyle = STYLE.panel;
    rr(x, y, w, h);
    c.fill();
    c.shadowColor = "transparent";
    rr(x, y, w, h);
    c.clip();
    c.drawImage(images[key], ...crop, x, y, w, h);
    c.restore();
    c.strokeStyle = STYLE.line;
    c.lineWidth = 1;
    rr(x, y, w, h);
    c.stroke();
  }
  function cursor(x, y, t, click = false) {
    c.save();
    c.translate(x, y);
    c.fillStyle = STYLE.gold;
    c.strokeStyle = STYLE.bg;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 28);
    c.lineTo(8, 21);
    c.lineTo(15, 36);
    c.lineTo(21, 33);
    c.lineTo(14, 19);
    c.lineTo(25, 18);
    c.closePath();
    c.fill();
    c.stroke();
    if (click) {
      const p = (t % 0.65) / 0.65;
      c.globalAlpha = 1 - p;
      c.strokeStyle = STYLE.gold;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, 10 + p * 30, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }
  function wave(x, y, width, t) {
    c.fillStyle = STYLE.gold;
    for (let i = 0; i < 43; i++) {
      const p = i / 42,
        a =
          (0.15 + 0.85 * Math.sin(Math.PI * p) ** 2) *
          (6 +
            24 *
              Math.abs(Math.sin(i * 1.7 + t * 5) * Math.cos(i * 0.39 - t * 2)));
      rr(x + p * width, y - a / 2, 3, a, 2);
      c.fill();
    }
  }
  function header(i, t) {
    c.drawImage(images.icon, 64, 29, 34, 34);
    text("ASTRA", 111, 53, 17, STYLE.ink, 500);
    text("TALK · CREATE · USE", 937, 52, 15, STYLE.muted, 500);
    rule(64, 82, 1152);
    text("DEMO MINI-APPS · SAMPLE DATA", 64, 113, 12, STYLE.muted, 500);
    const labels = [
      "THE IDEA",
      "POSSIBILITIES",
      "CREATION",
      "CHANGES",
      "YOUR TURN",
    ];
    text(
      `${String(i + 1).padStart(2, "0")} / ${labels[i]}`,
      1043,
      113,
      12,
      STYLE.gold,
      500,
    );
    rule(64, 697, 1152);
    line(64, 697, 1152, t / T.duration);
    for (let j = 1; j < 5; j++) {
      c.fillStyle = STYLE.bg;
      c.fillRect(64 + (1152 * starts[j]) / T.duration - 2, 695, 4, 6);
    }
  }
  function caption(t) {
    const s = window.GUIDE_CAPTIONS.find((s) => t >= s.start && t < s.end);
    if (!s) return;
    c.fillStyle = STYLE.bg;
    c.fillRect(0, 614, W, 73);
    c.font = font(34);
    let lines = [],
      current = "";
    for (const word of s.text.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (c.measureText(next).width > 1138) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    if (lines.length > 2) issues.push(`Caption exceeds two lines: ${s.text}`);
    lines.forEach((s, i) => {
      c.font = font(34);
      text(
        s,
        (W - c.measureText(s).width) / 2,
        lines.length === 1 ? 657 : 638 + i * 36,
        34,
      );
    });
  }
  function intro(u, t) {
    if (u < 3.3) {
      title(["Your personal", "Jarvis."], 64, 236, 68);
      text("Powered by Codex.", 69, 428, 25, STYLE.muted);
      wave(72, 506, 280, t);
      const p = ease(u / 2);
      screen("project-before", 585, 168, 615, 425, [
        0,
        0,
        mix(1140, 1100, p),
        mix(788, 760, p),
      ]);
    } else {
      title(["You talk.", "Astra builds."], 64, 232, 62);
      text("It starts with a conversation.", 69, 424, 23, STYLE.muted);
      line(70, 491, 327, ease((u - 3.3) / 1.6));
      screen("travel", 512, 146, 688, 463, [15, 15, 1070, 720]);
    }
  }
  function examples(u, t) {
    const i = u < 2.1 ? 0 : u < 4.2 ? 1 : 2,
      key = ["travel", "project-before", "quiz"][i],
      labels = [
        ["Plan", "a trip."],
        ["Move a", "project forward."],
        ["Learn", "something new."],
      ][i],
      local = u - [0, 2.1, 4.2][i],
      p = ease(local / 1.7);
    title(labels, 64, 240, i === 1 ? 54 : 62);
    text(
      [
        "A plan and a checklist.",
        "Tasks and the next step.",
        "Questions, then explanations.",
      ][i],
      69,
      433,
      22,
      STYLE.muted,
    );
    screen(key, 512, 146, 688, 463, [
      mix(0, 18, p),
      mix(0, 12, p),
      mix(1100, 1064, p),
      mix(740, 715, p),
    ]);
    line(70, 491, 320, (local % 2.1) / 2.1);
    if (i === 2 && local > 1.2) {
      screen("quiz-answer", 512, 146, 688, 463, [18, 12, 1064, 715]);
      cursor(512 + (467 / 1064) * 688, 146 + (405 / 715) * 463, t, true);
    }
  }
  function create(u, t) {
    if (u < 2.8) {
      text("Say what you need.", 64, 211, 62);
      const a = "“Make me a project tracker,",
        b = "with the next steps.”";
      const pa = clamp((u - 0.35) / 0.9),
        pb = clamp((u - 1) / 1.1);
      text(a.slice(0, Math.floor(a.length * pa)), 69, 330, 48, STYLE.ink);
      text(b.slice(0, Math.floor(b.length * pb)), 69, 402, 48, STYLE.gold);
      wave(73, 507, 430, t);
    } else {
      title(
        u < 5.6
          ? ["A little tool.", "Ready to use."]
          : ["Open it.", "Keep it."],
        64,
        235,
        u < 5.6 ? 64 : 54,
      );
      text("Come back. Make it your own.", 69, 437, 24, STYLE.muted);
      const close = ease((u - 5.2) / 1.5),
        crop = [
          mix(0, 30, close),
          mix(0, 240, close),
          mix(1100, 1040, close),
          mix(740, 450, close),
        ];
      screen(
        u > 6.5 ? "project-checked" : "project-before",
        512,
        146,
        688,
        463,
        crop,
      );
      const point = window.GUIDE_CONTROLS.task,
        x = 512 + ((point.x - crop[0]) / crop[2]) * 688,
        y = 146 + ((point.y - crop[1]) / crop[3]) * 463;
      if (u > 5.1)
        cursor(
          mix(1140, x, ease((u - 5.1) / 1.2)),
          mix(230, y, ease((u - 5.1) / 1.2)),
          t,
          u > 6.5 && u < 7.1,
        );
    }
  }
  function adapt(u, t) {
    const added = u > 2.6,
      focus = u > 5.1;
    title(
      focus ? ["Your app", "evolves."] : ["A different view?", "Just ask."],
      64,
      232,
      focus ? 64 : 52,
    );
    text("“Give me a simpler view.”", 69, 426, 25, STYLE.muted);
    screen(
      focus ? "project-focus" : added ? "project" : "project-before",
      512,
      146,
      688,
      463,
      [0, 0, 1100, 740],
    );
    if (added && !focus) {
      const p = window.GUIDE_CONTROLS.view,
        x = 512 + (p.x / 1100) * 688,
        y = 146 + (p.y / 740) * 463;
      cursor(
        mix(1110, x, ease((u - 2.6) / 1.5)),
        mix(530, y, ease((u - 2.6) / 1.5)),
        t,
        u > 4.5,
      );
    }
    if (focus) {
      line(70, 493, 330, ease((u - 5.1) / 1.5));
      text("Your way.", 69, 552, 29, STYLE.gold);
    }
  }
  function end(u, _t) {
    if (u < 3.25) {
      title(["Your assistant.", "Your own tools."], 64, 228, 64);
      text("One idea is enough to start.", 69, 444, 26, STYLE.muted);
      screen("quiz", 875, 183, 320, 221);
      screen("travel", 723, 245, 320, 221);
      screen("project", 572, 313, 360, 249);
    } else {
      title(["Your own", "little universe."], 64, 255, 83);
      text("Astra. Powered by Codex.", 69, 500, 32, STYLE.ink);
      line(71, 554, 610, ease((u - 3.25) / 2));
      screen("travel", 928, 160, 268, 185);
      screen("quiz", 831, 266, 285, 197);
      screen("project-focus", 766, 370, 338, 233);
    }
  }
  window.guideCanvas = canvas;
  window.TIMELINE = {
    ...T,
    shots: [
      0,
      3.3,
      starts[1],
      starts[1] + 2.1,
      starts[1] + 4.2,
      starts[2],
      starts[2] + 2.8,
      starts[2] + 5.6,
      starts[3],
      starts[3] + 2.6,
      starts[3] + 5.1,
      starts[4],
      starts[4] + 3.25,
    ],
  };
  window.renderFrame = (t) => {
    t = clamp(t, 0, T.duration);
    issues = [];
    boxes = [];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = STYLE.bg;
    c.fillRect(0, 0, W, H);
    const i = Math.max(
      0,
      starts.findLastIndex((s) => t >= s),
    );
    [intro, examples, create, adapt, end][i](t - starts[i], t);
    header(i, t);
    caption(t);
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const x = boxes[a],
          y = boxes[b];
        if (
          Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x) > 5 &&
          Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y) > 5
        )
          issues.push(`Text overlap: ${x.value} / ${y.value}`);
      }
    return { issues, bounds: boxes, time: t, chapter: i + 1 };
  };
  window.guideReady = ready.then(() => {
    window.renderFrame(0);
    return true;
  });
})();

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { root, output, assets, timeline, captions } = settings;
app.setName("Astra media renderer");
app.setPath("userData", path.join(output, "render-profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const paint = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Offscreen paint timed out")),
        5000,
      );
      window.webContents.once("paint", (_event, _dirty, image) => {
        clearTimeout(timer);
        resolve(image);
      });
      window.webContents.invalidate();
    });
  const capture = async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      await window.webContents.executeJavaScript(
        "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
      );
      await paint();
      const image = await paint();
      const pixels = image.toBitmap();
      let lowest = 255;
      let highest = 0;
      for (let offset = 0; offset < pixels.length; offset += 400) {
        const value =
          (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
        lowest = Math.min(lowest, value);
        highest = Math.max(highest, value);
      }
      if (highest - lowest > 30) return image;
    }
    throw new Error(
      "The media capture remained blank after 12 painted frames.",
    );
  };
  const screenshot = async (name) =>
    fs.writeFileSync(
      path.join(assets, `${name}.png`),
      (await capture()).toPNG(),
    );
  const load = async (name) => {
    const demo = JSON.parse(
      fs.readFileSync(
        path.join(root, "website/media/demos", `${name}.json`),
        "utf8",
      ),
    );
    const file = path.join(output, `${name}.html`);
    fs.writeFileSync(
      file,
      '<!doctype html><html lang="en"><meta charset="utf-8"><style>' +
        demo.css +
        "</style><body>" +
        demo.html +
        "</body></html>",
    );
    await window.loadFile(file);
  };
  try {
    const review = {};
    await load("travel");
    await screenshot("travel");
    review.travel = await window.webContents.executeJavaScript(
      `(()=>{const field=document.querySelector('#trip-name');field.value='A weekend away';field.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-pack="1"]').click();return JSON.parse(document.querySelector('#demo-state').textContent).packed.filter(Boolean).length})()`,
    );
    await load("project-before");
    await screenshot("project-before");
    const controls = await window.webContents.executeJavaScript(
      `(()=>{const r=document.querySelector('[data-task="1"]').getBoundingClientRect();return {task:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-task="1"]').click();true`,
    );
    await screenshot("project-checked");
    review.project = await window.webContents.executeJavaScript(
      `JSON.parse(document.querySelector('#demo-state').textContent).tasks.filter(t=>t.done).length`,
    );
    await load("project");
    await screenshot("project");
    controls.view = await window.webContents.executeJavaScript(
      `(()=>{const r=document.querySelector('#project-view').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('#project-view').click();true`,
    );
    await screenshot("project-focus");
    review.focus = await window.webContents.executeJavaScript(
      `document.querySelector('#substrate').classList.contains('focus-view')`,
    );
    await load("quiz");
    await screenshot("quiz");
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-answer="1"]').click();true`,
    );
    await screenshot("quiz-answer");
    review.quiz = await window.webContents.executeJavaScript(
      `document.querySelector('#quiz-score').textContent`,
    );
    if (
      review.travel !== 2 ||
      review.project !== 2 ||
      !review.focus ||
      !review.quiz.startsWith("1")
    )
      throw Error(`A demo control did not work: ${JSON.stringify(review)}`);
    const files = [
      "icon",
      "project-before",
      "project-checked",
      "project",
      "project-focus",
      "travel",
      "quiz",
      "quiz-answer",
    ];
    const imagePaths = Object.fromEntries(
      files.map((name) => [
        name,
        pathToFileURL(path.join(assets, `${name}.png`)).href,
      ]),
    );
    const film = path.join(output, "film.html");
    fs.writeFileSync(
      film,
      '<!doctype html><html lang="en"><meta charset="utf-8"><style>html,body{margin:0;background:#11151c;overflow:hidden}canvas{display:block;width:1280px;height:720px}</style><canvas></canvas><script>window.GUIDE_ASSETS=' +
        JSON.stringify(imagePaths) +
        ";window.GUIDE_TIMING=" +
        JSON.stringify(timeline) +
        ";window.GUIDE_CAPTIONS=" +
        JSON.stringify(captions) +
        ";window.GUIDE_CONTROLS=" +
        JSON.stringify(controls) +
        '</script><script src="' +
        pathToFileURL(path.join(root, "website/media/film.js")).href +
        '"></script></html>',
    );
    window.setContentSize(1280, 720);
    await window.loadFile(film);
    await window.webContents.executeJavaScript("window.guideReady");
    const shots = await window.webContents.executeJavaScript(
      "window.TIMELINE.shots",
    );
    const violations = [];
    fs.mkdirSync(path.join(output, "stills"), { recursive: true });
    for (let i = 0; i < shots.length; i++) {
      const result = await window.webContents.executeJavaScript(
        `window.renderFrame(${shots[i]})`,
      );
      if (result.issues.length)
        violations.push({ time: shots[i], issues: result.issues });
      fs.writeFileSync(
        path.join(output, "stills", `${String(i).padStart(2, "0")}.png`),
        (await capture()).toPNG(),
      );
    }
    if (violations.length)
      throw Error(
        `Storyboard text checks failed: ${JSON.stringify(violations)}`,
      );
    console.log(`STORYBOARD_PASSED ${shots.length} frames`);
    if (!settings.stillsOnly) {
      fs.mkdirSync(path.join(output, "frames"), { recursive: true });
      const count = Math.ceil(timeline.duration * timeline.fps);
      for (let frame = 0; frame < count; frame++) {
        const time = frame / timeline.fps;
        const result = await window.webContents.executeJavaScript(
          `window.renderFrame(${time})`,
        );
        if (result.issues.length)
          throw Error(
            `Text check at ${time}: ${JSON.stringify(result.issues)}`,
          );
        fs.writeFileSync(
          path.join(output, "frames", `${String(frame).padStart(5, "0")}.jpg`),
          (await capture()).toJPEG(88),
        );
        if (frame % 120 === 0) console.log(`RENDER ${frame}/${count}`);
      }
      console.log(`FRAMES_RENDERED ${count}`);
    }
    fs.writeFileSync(
      path.join(output, "render-review.json"),
      JSON.stringify(
        {
          controls: review,
          storyboardFrames: shots.length,
          violations: 0,
          frames: Math.ceil(timeline.duration * timeline.fps),
        },
        null,
        2,
      ),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

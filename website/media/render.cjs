const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { root, output, assets } = settings;
app.setName("Astra screenshot capture");
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
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-task="1"]').click();true`,
    );
    await screenshot("project-checked");
    review.project = await window.webContents.executeJavaScript(
      `JSON.parse(document.querySelector('#demo-state').textContent).tasks.filter(t=>t.done).length`,
    );
    await load("project");
    await screenshot("project");
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
    fs.writeFileSync(
      path.join(output, "render-review.json"),
      JSON.stringify({ controls: review }, null, 2),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

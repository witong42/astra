const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const profile = path.join(
  require("node:os").homedir(),
  ".astra/media/getastra-banner",
);
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 640,
    useContentSize: true,
    backgroundColor: "#080d13",
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    for (const language of ["en", "fr"]) {
      await window.loadURL(`http://127.0.0.1:4587/?lang=${language}`);
      await window.webContents.insertCSS(`
        html,body{width:1280px;height:640px;overflow:hidden}
        .navigation{position:absolute;left:64px;top:0;width:1152px;height:94px;z-index:2}
        .navigation .brand{font-size:31px}.navigation .brand img{width:34px;height:34px}
        .main-navigation,.languages,.hero-actions,.eyebrow,main>section:not(.hero),footer{display:none!important}
        .hero{width:1216px;margin:0 32px;min-height:640px;height:640px;padding:0;grid-template-columns:1.12fr 1fr;gap:30px}
        .hero-galaxy{height:610px;margin-left:-55px;margin-right:0}
        .hero-copy{padding-top:25px}.hero h1{font-size:68px;letter-spacing:-3.5px}
        .hero-description{font-size:17px;max-width:365px;line-height:1.8}
      `);
      await window.webContents.executeJavaScript(
        "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
      );
      await new Promise((resolve) => setTimeout(resolve, 450));
      const name = language === "en" ? "banner.png" : "banner-fr.png";
      fs.writeFileSync(
        path.join(root, ".github/assets", name),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    console.log("Rendered English and French Astra banners.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

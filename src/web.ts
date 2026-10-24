import { getCopy, LANGUAGE_CHANGED_EVENT, readLanguage } from "./locale";
import { APP_RELEASE } from "./version";
import { WebBridge } from "./web-bridge";

declare const __ASTRA_REMOTE_URL__: string;
const root = document.getElementById("root");
document.documentElement.lang = readLanguage();
if (root) {
  root.innerHTML =
    '<main class="remote-opening"><strong>Astra</strong><p></p><small></small></main>';
  const opening = root.querySelector("p");
  if (opening) opening.textContent = getCopy().privateConnection;
  const release = root.querySelector("small");
  if (release) release.textContent = APP_RELEASE;
}
const banner = document.createElement("aside");
banner.className = "remote-connection";
banner.setAttribute("role", "status");
banner.hidden = true;
const message = document.createElement("span");
const retry = document.createElement("button");
retry.type = "button";
retry.onclick = () => window.location.reload();
const resume = document.createElement("button");
resume.type = "button";
resume.hidden = true;
banner.append(message, retry, resume);
document.body.append(banner);
let connectionError: string | null = null;
let playbackError: string | null = null;
function updateBanner() {
  retry.textContent = getCopy().reload;
  resume.textContent = getCopy().enableSound;
  const error = connectionError ?? playbackError;
  banner.hidden = error === null;
  message.textContent = error;
  retry.hidden = connectionError === null;
  resume.hidden = connectionError !== null || playbackError === null;
}
window.addEventListener(LANGUAGE_CHANGED_EVENT, updateBanner);
const remote = new WebBridge(
  __ASTRA_REMOTE_URL__,
  (connected, error) => {
    connectionError = connected ? null : (error ?? getCopy().privateConnection);
    updateBanner();
  },
  (error) => {
    playbackError = error;
    updateBanner();
  },
);
resume.onclick = () => {
  void remote.resumeAudio().catch((error) => {
    playbackError = error instanceof Error ? error.message : String(error);
    updateBanner();
  });
};
window.codexos = remote.bridge;
await remote.ready;
document.documentElement.dataset.platform = "web";
await import("./renderer");

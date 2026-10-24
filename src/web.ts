import { APP_RELEASE } from "./version";
import { WebBridge } from "./web-bridge";

declare const __ASTRA_REMOTE_URL__: string;
const root = document.getElementById("root");
if (root) {
  root.innerHTML =
    '<main class="remote-opening"><strong>Astra</strong><p>Connexion privée au Mac…</p><small></small></main>';
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
retry.textContent = "Recharger";
retry.onclick = () => window.location.reload();
banner.append(message, retry);
document.body.append(banner);
const remote = new WebBridge(__ASTRA_REMOTE_URL__, (connected, error) => {
  banner.hidden = connected;
  message.textContent = error ?? "Connexion privée au Mac…";
});
window.codexos = remote.bridge;
await remote.ready;
document.documentElement.dataset.platform = "web";
await import("./renderer");

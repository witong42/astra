import { mountGalaxy } from "../src/galaxy";
import { INITIAL_VOICE } from "../src/voice";
import {
  copy,
  SITE_LANGUAGE_KEY,
  type SiteLanguage,
  siteLanguage,
} from "./copy";

function requiredElement<T extends Element = HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Astra's website is missing ${selector}.`);
  return element;
}

const surface = requiredElement<HTMLCanvasElement>("#galaxy");
const galaxy = mountGalaxy(surface, () => INITIAL_VOICE);
addEventListener("pagehide", () => galaxy.dispose(), { once: true });

let language = siteLanguage(
  new URL(location.href).searchParams.get("lang") ??
    localStorage.getItem(SITE_LANGUAGE_KEY),
);

const applyLanguage = (next: SiteLanguage) => {
  language = next;
  document.documentElement.lang = language;
  document.title = copy[language].title;
  requiredElement("#copy-install").setAttribute(
    "aria-label",
    copy[language].copyLabel,
  );
  requiredElement(".languages").setAttribute(
    "aria-label",
    copy[language].languageLabel,
  );
  requiredElement(".main-navigation").setAttribute(
    "aria-label",
    copy[language].navigationLabel,
  );
  requiredElement("[role=tablist]").setAttribute(
    "aria-label",
    copy[language].examplesLabel,
  );
  requiredElement("#pitch").setAttribute(
    "aria-label",
    copy[language].videoLabel,
  );
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n as keyof typeof copy.en;
    const text = copy[language][key];
    if (!text) throw new Error(`Missing Astra site translation: ${key}`);
    element.innerHTML = text;
  }
  for (const link of document.querySelectorAll("[data-language]"))
    link.setAttribute(
      "aria-current",
      String((link as HTMLElement).dataset.language === language),
    );
  requiredElement("#copy-feedback").textContent = "";
};

for (const link of document.querySelectorAll<HTMLAnchorElement>(
  "[data-language]",
))
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const next = siteLanguage(link.dataset.language ?? null);
    localStorage.setItem(SITE_LANGUAGE_KEY, next);
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    history.replaceState(null, "", url);
    applyLanguage(next);
  });
applyLanguage(language);

const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-demo]")];
const selectDemo = (selected: HTMLButtonElement) => {
  for (const tab of tabs) {
    tab.setAttribute("aria-selected", String(tab === selected));
    tab.tabIndex = tab === selected ? 0 : -1;
  }
  const image = requiredElement<HTMLImageElement>("#example-image");
  image.src = `./assets/${selected.dataset.demo}.png`;
  image.alt = `${selected.querySelector("strong")?.textContent}. ${copy[language].sampleData}.`;
  requiredElement("#app-preview").setAttribute("aria-labelledby", selected.id);
};
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectDemo(tab));
  tab.addEventListener("keydown", (event) => {
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = (index + 1) % tabs.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectDemo(tabs[next]);
    tabs[next].focus();
  });
}

requiredElement("#copy-install").addEventListener("click", async () => {
  const status = requiredElement("#copy-feedback");
  try {
    await navigator.clipboard.writeText(
      requiredElement("#install-command").textContent ?? "",
    );
    status.textContent = copy[language].copied;
  } catch {
    status.textContent = copy[language].copyFailed;
  }
});

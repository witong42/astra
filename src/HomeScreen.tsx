import { CaretLeftIcon, CaretRightIcon, StarIcon } from "@phosphor-icons/react";
import { BrainIcon } from "@solar-icons/react/line-duotone/brain";
import { BranchingPathsUpIcon } from "@solar-icons/react/line-duotone/branching-paths-up";
import { CalculatorIcon } from "@solar-icons/react/line-duotone/calculator";
import { CalendarMinimalisticIcon } from "@solar-icons/react/line-duotone/calendar-minimalistic";
import { Chart2Icon } from "@solar-icons/react/line-duotone/chart-2";
import { CompassIcon } from "@solar-icons/react/line-duotone/compass";
import { CpuBoltIcon } from "@solar-icons/react/line-duotone/cpu-bolt";
import { GamepadIcon } from "@solar-icons/react/line-duotone/gamepad";
import { GlobalIcon } from "@solar-icons/react/line-duotone/global";
import { LightbulbBoltIcon } from "@solar-icons/react/line-duotone/lightbulb-bolt";
import { NotebookIcon } from "@solar-icons/react/line-duotone/notebook";
import { PlanetIcon } from "@solar-icons/react/line-duotone/planet";
import { PlayCircleIcon } from "@solar-icons/react/line-duotone/play-circle";
import { PresentationGraphIcon } from "@solar-icons/react/line-duotone/presentation-graph";
import { SoundwaveIcon } from "@solar-icons/react/line-duotone/soundwave";
import { WalletMoneyIcon } from "@solar-icons/react/line-duotone/wallet-money";
import { Widget4Icon } from "@solar-icons/react/line-duotone/widget-4";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Astra } from "./Astra";
import { useLocale } from "./LocaleProvider";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
import type { VoiceState } from "./voice";
import { WorkspaceMenu } from "./WorkspaceMenu";

const VISIBLE_APPS = 6;
const WHEEL_STEP_PX = 40;
const WHEEL_LINE_PX = 16;
const WHEEL_STEP_INTERVAL_MS = 180;
const CAROUSEL_ANIMATION_MS = 180;

const APP_ICONS = [
  { match: /memory|mémoire|brain/, icon: BrainIcon },
  {
    match: /inner|introspect|mind|wellbeing|confiance/,
    icon: CompassIcon,
  },
  {
    match: /chinese|chinois|language|langue|learn|appren/,
    icon: GlobalIcon,
  },
  {
    match: /decision|décision|choice|choix/,
    icon: BranchingPathsUpIcon,
  },
  { match: /astra|jarvis|assistant/, icon: CpuBoltIcon },
  { match: /present|slide/, icon: PresentationGraphIcon },
  { match: /calculat/, icon: CalculatorIcon },
  {
    match: /solar|solaire|orbit|planet|astronom|star/,
    icon: PlanetIcon,
  },
  {
    match: /game|jeu|threejs|adventure|story|arcade/,
    icon: GamepadIcon,
  },
  {
    match: /music|listen|musique|radio|spotify/,
    icon: SoundwaveIcon,
  },
  {
    match: /money|argent|income|finance/,
    icon: WalletMoneyIcon,
  },
  { match: /video|vidéo|youtube/, icon: PlayCircleIcon },
  {
    match: /dashboard|business|tableau|life board/,
    icon: Chart2Icon,
  },
  {
    match: /plan|week|semaine|calendar|calendrier/,
    icon: CalendarMinimalisticIcon,
  },
  { match: /wiki|note|page|book|livre/, icon: NotebookIcon },
  { match: /idea|idée/, icon: LightbulbBoltIcon },
];
function AppIcon({ workspace }: { workspace: Workspace }) {
  const topic =
    workspace.messages.find((message) => message.role === "user")?.text ?? "";
  const rule =
    APP_ICONS.find(({ match }) => match.test(workspace.name.toLowerCase())) ??
    APP_ICONS.find(({ match }) => match.test(topic.toLowerCase()));
  const Icon = rule?.icon ?? Widget4Icon;
  return (
    <span className="app-icon">
      <Icon size={30} strokeWidth={1.35} secondaryOpacity={0.48} />
    </span>
  );
}
export function HomeScreen({
  snapshot,
  onOpen,
  onFavorite,
  onRename,
  onDelete,
  voice,
  onToggleVoice,
}: {
  snapshot: Snapshot;
  onOpen: (workspace: Workspace) => void;
  onFavorite: (workspace: Workspace) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  voice?: VoiceState;
  onToggleVoice?: () => void;
}) {
  const { t } = useLocale();
  const [startIndex, setStartIndex] = useState(0);
  const library = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const direction = useRef(1);
  const previousIndex = useRef(0);
  const activity = (workspace: Workspace) => {
    const session = snapshot.sessions[workspace.id];
    return session?.approval
      ? t.needsConfirmation
      : session?.busy
        ? t.inProgress
        : "";
  };
  const workspaces = [...snapshot.workspaces].sort(
    (first, second) =>
      Number(Boolean(second.favorite)) - Number(Boolean(first.favorite)),
  );
  const appCount = workspaces.length;
  const currentIndex = Math.min(startIndex, Math.max(0, appCount - 1));
  const visibleWorkspaces = Array.from(
    { length: Math.min(VISIBLE_APPS, appCount) },
    (_, offset) => workspaces[(currentIndex + offset) % appCount],
  );
  const move = useCallback(
    (step: number) => {
      if (appCount < 2) return;
      direction.current = step;
      setStartIndex(
        (index) => (Math.min(index, appCount - 1) + step + appCount) % appCount,
      );
    },
    [appCount],
  );
  useEffect(() => {
    const element = library.current;
    if (!element || appCount < 2) return;
    let distance = 0;
    let lastStep = -Infinity;
    let lastEvent = -Infinity;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || (event.target as Element).closest("[popover]"))
        return;
      const delta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      if (
        now - lastEvent > WHEEL_STEP_INTERVAL_MS ||
        Math.sign(distance) !== Math.sign(delta)
      )
        distance = 0;
      lastEvent = now;
      if (now - lastStep < WHEEL_STEP_INTERVAL_MS) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? WHEEL_LINE_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      distance += delta * unit;
      if (Math.abs(distance) < WHEEL_STEP_PX) return;
      move(Math.sign(distance));
      distance = 0;
      lastStep = now;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [appCount, move]);
  useLayoutEffect(() => {
    if (previousIndex.current === currentIndex) return;
    previousIndex.current = currentIndex;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const element = list.current;
    const row = element?.querySelector<HTMLElement>(".horizon-app");
    if (!element || !row) return;
    const offset = direction.current * row.getBoundingClientRect().height;
    const animation = element.animate(
      [
        { transform: `translateY(${offset}px)` },
        { transform: "translateY(0)" },
      ],
      { duration: CAROUSEL_ANIMATION_MS, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [currentIndex]);
  return (
    <main className="home-screen" aria-label={t.home} data-layout="horizon">
      <div className="home-content horizon-home">
        <Astra voice={voice} onToggle={onToggleVoice} />
        <section
          ref={library}
          className="horizon-library"
          aria-label={t.miniApps}
          aria-roledescription={appCount > 1 ? t.carousel : undefined}
          aria-description={appCount > 1 ? t.browseHint : undefined}
          tabIndex={appCount > 1 ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (
              ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              move(
                event.key === "ArrowDown" || event.key === "ArrowRight"
                  ? 1
                  : -1,
              );
            }
          }}
        >
          <div className="home-carousel-viewport">
            <div ref={list} className="workspace-library horizon-apps">
              {visibleWorkspaces.map((workspace) => (
                <div className="library-row horizon-app" key={workspace.id}>
                  <button
                    type="button"
                    className="library-open app-tile"
                    data-workspace-id={workspace.id}
                    aria-label={t.openApp(workspace.name)}
                    aria-description={
                      workspace.favorite ? t.favorite : undefined
                    }
                    onClick={() => onOpen(workspace)}
                    title={workspace.name}
                  >
                    <AppIcon workspace={workspace} />
                    <span className="library-name app-tile-name">
                      <span className="home-app-title">
                        <span className="home-app-name">{workspace.name}</span>
                        {workspace.favorite && (
                          <StarIcon
                            className="home-favorite-star"
                            size={13}
                            weight="fill"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      {activity(workspace) && (
                        <small
                          className={
                            snapshot.sessions[workspace.id]?.approval
                              ? "needs-you"
                              : ""
                          }
                        >
                          {activity(workspace)}
                        </small>
                      )}
                    </span>
                  </button>
                  <WorkspaceMenu
                    workspace={workspace}
                    busy={Boolean(snapshot.sessions[workspace.id]?.busy)}
                    onRename={onRename}
                    onDelete={onDelete}
                    onFavorite={
                      hasWorkspaceSurface(workspace)
                        ? async () => {
                            await onFavorite(workspace);
                            setStartIndex(0);
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          {appCount > 1 && (
            <nav className="home-carousel-controls" aria-label={t.browseApps}>
              <button
                type="button"
                aria-label={t.previousApps}
                onClick={() => move(-1)}
              >
                <CaretLeftIcon size={16} aria-hidden="true" />
              </button>
              <span
                className="home-carousel-position"
                role="status"
                aria-live="polite"
              >
                {currentIndex + 1} / {appCount}
              </span>
              <button
                type="button"
                aria-label={t.nextApps}
                onClick={() => move(1)}
              >
                <CaretRightIcon size={16} aria-hidden="true" />
              </button>
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}

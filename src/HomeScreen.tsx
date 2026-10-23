import { StarIcon } from "@phosphor-icons/react";
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
import type { CSSProperties } from "react";
import { Astra } from "./Astra";
import { ApprovalPanel } from "./Chat";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
import type { VoiceState } from "./voice";
import { WorkspaceMenu } from "./WorkspaceMenu";

const APP_STYLES = [
  { match: /memory|mémoire|brain/, icon: BrainIcon, color: "#bfb3ed" },
  {
    match: /inner|introspect|mind|wellbeing|confiance/,
    icon: CompassIcon,
    color: "#a5c5dc",
  },
  {
    match: /chinese|chinois|language|langue|learn|appren/,
    icon: GlobalIcon,
    color: "#d5b6c9",
  },
  {
    match: /decision|décision|choice|choix/,
    icon: BranchingPathsUpIcon,
    color: "#c5b7e3",
  },
  { match: /astra|jarvis|assistant/, icon: CpuBoltIcon, color: "#b8c5ec" },
  { match: /present|slide/, icon: PresentationGraphIcon, color: "#d0bfdc" },
  { match: /calculat/, icon: CalculatorIcon, color: "#afd0c7" },
  {
    match: /solar|solaire|orbit|planet|astronom|star/,
    icon: PlanetIcon,
    color: "#aebeea",
  },
  {
    match: /game|jeu|threejs|adventure|story|arcade/,
    icon: GamepadIcon,
    color: "#c6b9e5",
  },
  {
    match: /music|listen|musique|radio|spotify/,
    icon: SoundwaveIcon,
    color: "#b0cecb",
  },
  {
    match: /money|argent|income|finance/,
    icon: WalletMoneyIcon,
    color: "#afd0c7",
  },
  { match: /video|vidéo|youtube/, icon: PlayCircleIcon, color: "#d5b6c9" },
  {
    match: /dashboard|business|tableau|life board/,
    icon: Chart2Icon,
    color: "#afd0c7",
  },
  {
    match: /plan|week|semaine|calendar|calendrier/,
    icon: CalendarMinimalisticIcon,
    color: "#c9c2a9",
  },
  { match: /wiki|note|page|book|livre/, icon: NotebookIcon, color: "#b3c0df" },
  { match: /idea|idée/, icon: LightbulbBoltIcon, color: "#cec5ad" },
];
function AppIcon({ workspace }: { workspace: Workspace }) {
  const topic =
    workspace.messages.find((message) => message.role === "user")?.text ?? "";
  const style =
    APP_STYLES.find(({ match }) => match.test(workspace.name.toLowerCase())) ??
    APP_STYLES.find(({ match }) => match.test(topic.toLowerCase()));
  const Icon = style?.icon ?? Widget4Icon;
  return (
    <span
      className="app-icon"
      style={{ "--app-accent": style?.color ?? "#afb7d9" } as CSSProperties}
    >
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
  onInterruptVoice,
  onPauseVoice,
  onError = () => {},
}: {
  snapshot: Snapshot;
  onOpen: (workspace: Workspace) => void;
  onFavorite: (workspace: Workspace) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  voice?: VoiceState;
  onToggleVoice?: () => void;
  onInterruptVoice?: () => void;
  onPauseVoice?: () => void;
  onError?: (error: unknown) => void;
}) {
  const favorites = snapshot.workspaces.filter(
    (workspace) => workspace.favorite,
  );
  const assistantApproval = snapshot.assistant
    ? snapshot.sessions[snapshot.assistant.id]?.approval
    : null;
  const activity = (workspace: Workspace) => {
    const session = snapshot.sessions[workspace.id];
    return session?.approval ? "Needs you" : session?.busy ? "Working" : "";
  };
  return (
    <main className="home-screen" aria-label="Home">
      <div className="home-content">
        <Astra
          voice={voice}
          onToggle={onToggleVoice}
          onInterrupt={onInterruptVoice}
          onPause={onPauseVoice}
        />
        {snapshot.assistant && assistantApproval && (
          <ApprovalPanel
            approval={assistantApproval}
            workspaceId={snapshot.assistant.id}
            onError={onError}
          />
        )}
        <section className="home-favorites" aria-labelledby="favorites-heading">
          <div className="home-section-heading">
            <h2 id="favorites-heading" className="home-section-title">
              Your apps
            </h2>
            <span>
              {favorites.length
                ? `${favorites.length} favorite${favorites.length === 1 ? "" : "s"}`
                : "Favorites live here"}
            </span>
          </div>
          {favorites.length ? (
            <div className="app-grid">
              {favorites.map((workspace) => (
                <button
                  type="button"
                  className="app-tile"
                  key={workspace.id}
                  data-workspace-id={workspace.id}
                  aria-label={`Open ${workspace.name}`}
                  title={workspace.name}
                  onClick={() => onOpen(workspace)}
                >
                  <AppIcon workspace={workspace} />
                  <span className="app-tile-name">{workspace.name}</span>
                  {activity(workspace) && (
                    <span
                      className={`app-activity ${snapshot.sessions[workspace.id]?.approval ? "needs-you" : ""}`}
                    >
                      {activity(workspace)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="home-empty">
              <span className="home-empty-star">
                <StarIcon size={28} weight="duotone" />
              </span>
              <div>
                <h3 className="home-empty-title">Keep a canvas here.</h3>
                <p className="home-empty-copy">
                  Star a workspace below to make it a full-screen app.
                </p>
              </div>
            </div>
          )}
        </section>
        <details className="home-library" open={!favorites.length}>
          <summary className="home-library-toggle">
            All apps <span>{snapshot.workspaces.length}</span>
          </summary>
          <section aria-label="App library">
            <div className="workspace-library">
              {snapshot.workspaces.map((workspace) => (
                <div className="library-row" key={workspace.id}>
                  <button
                    type="button"
                    className="library-open"
                    data-workspace-id={workspace.id}
                    onClick={() => onOpen(workspace)}
                    title={workspace.name}
                  >
                    <AppIcon workspace={workspace} />
                    <span className="library-name">
                      {workspace.name}
                      <small>
                        {activity(workspace) ||
                          (hasWorkspaceSurface(workspace)
                            ? "Canvas"
                            : "Conversation")}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="favorite-toggle"
                    aria-label={`${workspace.favorite ? "Remove" : "Add"} ${workspace.name} ${workspace.favorite ? "from" : "to"} Home`}
                    aria-pressed={Boolean(workspace.favorite)}
                    disabled={!hasWorkspaceSurface(workspace)}
                    title={
                      hasWorkspaceSurface(workspace)
                        ? workspace.favorite
                          ? "Remove from Home"
                          : "Add to Home"
                        : "Create a canvas first"
                    }
                    onClick={() => onFavorite(workspace)}
                  >
                    <StarIcon
                      weight={workspace.favorite ? "fill" : "regular"}
                    />
                  </button>
                  <WorkspaceMenu
                    workspace={workspace}
                    busy={Boolean(snapshot.sessions[workspace.id]?.busy)}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                </div>
              ))}
            </div>
          </section>
        </details>
      </div>
    </main>
  );
}

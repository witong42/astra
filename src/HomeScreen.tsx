import {
  AppWindowIcon,
  CalculatorIcon,
  CalendarBlankIcon,
  ChartPieSliceIcon,
  CurrencyDollarIcon,
  GameControllerIcon,
  MusicNotesIcon,
  NotebookIcon,
  PlanetIcon,
  PlayCircleIcon,
  PresentationChartIcon,
  SparkleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
import { WorkspaceMenu } from "./WorkspaceMenu";

const APP_STYLES = [
  { match: /present|slide/, icon: PresentationChartIcon, tone: "clay" },
  { match: /calculat/, icon: CalculatorIcon, tone: "sage" },
  {
    match: /solar|solaire|orbit|planet|\b(?:atlas|star)\b/,
    icon: PlanetIcon,
    tone: "sky",
  },
  {
    match: /game|jeu|threejs|adventure|story|arcade/,
    icon: GameControllerIcon,
    tone: "clay",
  },
  { match: /music|listen|musique|radio/, icon: MusicNotesIcon, tone: "rose" },
  { match: /money|argent|income/, icon: CurrencyDollarIcon, tone: "sage" },
  { match: /video|vidéo|youtube/, icon: PlayCircleIcon, tone: "clay" },
  {
    match: /dashboard|business|tableau|life board/,
    icon: ChartPieSliceIcon,
    tone: "sage",
  },
  { match: /plan|week|semaine/, icon: CalendarBlankIcon, tone: "gold" },
  { match: /wiki|note|page/, icon: NotebookIcon, tone: "sand" },
  { match: /idea|idée|cool/, icon: SparkleIcon, tone: "gold" },
];
function AppIcon({ workspace }: { workspace: Workspace }) {
  const topic =
    `${workspace.name} ${workspace.messages.find((message) => message.role === "user")?.text ?? ""}`.toLowerCase();
  const style = APP_STYLES.find(({ match }) => match.test(topic));
  const Icon = style?.icon ?? AppWindowIcon;
  return (
    <span className={`app-icon tone-${style?.tone ?? "sky"}`}>
      <Icon size={48} weight="fill" />
    </span>
  );
}
export function HomeScreen({
  snapshot,
  onOpen,
  onFavorite,
  onRename,
  onDelete,
}: {
  snapshot: Snapshot;
  onOpen: (workspace: Workspace) => void;
  onFavorite: (workspace: Workspace) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const favorites = snapshot.workspaces.filter(
    (workspace) => workspace.favorite,
  );
  const activity = (workspace: Workspace) => {
    const session = snapshot.sessions[workspace.id];
    return session?.approval ? "Needs you" : session?.busy ? "Working" : "";
  };
  return (
    <main className="home-screen" aria-label="Home">
      <div className="home-content">
        <div className="home-intro">
          <h1 className="home-title">Home</h1>
          <p className="home-description">Your canvases, ready to open.</p>
        </div>
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
        <section className="home-library" aria-labelledby="library-heading">
          <div className="home-section-heading">
            <h2 id="library-heading" className="home-section-title">
              All workspaces
            </h2>
            <span>{snapshot.workspaces.length}</span>
          </div>
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
                  <StarIcon weight={workspace.favorite ? "fill" : "regular"} />
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
      </div>
    </main>
  );
}

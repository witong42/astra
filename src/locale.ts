export const INTERFACE_LANGUAGES = ["fr", "en"] as const;
export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = "astra.interface-language";
export const LANGUAGE_CHANGED_EVENT = "astra:language";

const fr = {
  interfaceLanguage: "Langue de l’interface",
  languageSaveFailed:
    "Impossible de mémoriser la langue. Autorise le stockage local puis réessaie.",
  openJournal: "Ouvrir le journal",
  closeJournal: "Fermer le journal",
  journal: "Journal",
  journalLabel: "Journal continu",
  journalEmpty: "Le fil de ce qu’on fait ensemble.",
  journalEmptyDetail: "Nos échanges et les actions d’Astra apparaîtront ici.",
  history: "Historique",
  you: "Toi",
  voice: "voix",
  action: "action",
  message: "message",
  details: "Détails",
  failureDetails: "Détail de l’échec",
  inProgress: "En cours",
  failed: "Non aboutie",
  completed: "Effectuée",
  astraWorking: "Astra travaille…",
  home: "Accueil",
  miniApps: "Mini-apps",
  browseApps: "Parcourir les mini-apps",
  carousel: "carrousel",
  browseHint: "Défilez à la molette ou utilisez les flèches du clavier.",
  previousApps: "Mini-apps précédentes",
  nextApps: "Mini-apps suivantes",
  openApp: (name: string) => `Ouvrir ${name}`,
  manageApp: (name: string) => `Gérer ${name}`,
  favorite: "Favori",
  needsConfirmation: "À confirmer",
  addFavorite: "Ajouter aux favoris",
  removeFavorite: "Retirer des favoris",
  rename: "Renommer",
  deleteApp: "Supprimer la mini-app",
  deleting: "Suppression…",
  appName: "Nom de la mini-app",
  appNameHint: "Un ou deux mots.",
  invalidAppName: "Utilise un ou deux mots, jusqu’à 32 caractères.",
  cancel: "Annuler",
  save: "Enregistrer",
  saving: "Enregistrement…",
  stopBeforeDelete: "Arrête la réponse en cours pour supprimer cette mini-app.",
  deleteConfirm:
    "Supprimer définitivement cette mini-app, sa conversation, sa vue, ses versions et son historique Codex ? Cette action est irréversible. Les fichiers du projet et les sauvegardes externes seront conservés.",
  deleteTitle: "Supprimer la mini-app ?",
  chooseFolder: "Choisir un dossier",
  chooseFolderPath: "Chemin absolu d’un dossier existant sur le Mac :",
  model: "Modèle",
  reasoning: "Raisonnement",
  modelSpeed: "Vitesse du modèle",
  default: "Par défaut",
  standard: "Standard",
  standardDescription: "Vitesse et utilisation normales",
  fast: "Rapide",
  fastDescription: "Réponses plus rapides, utilisation accrue",
  efforts: {
    none: "Aucun",
    minimal: "Minimal",
    low: "Faible",
    medium: "Moyen",
    high: "Élevé",
    xhigh: "Très élevé",
    max: "Maximum",
    ultra: "Ultra",
  },
  approvalRequest: "Demande d’Astra",
  yourAnswer: "Ta réponse",
  answerLabel: (header: string) => `Ta réponse : ${header}`,
  decline: "Refuser",
  sendAnswer: "Envoyer la réponse",
  allowOnce: "Autoriser une fois",
  messageAstra: "Message Astra",
  writeAstra: "Écris à Astra…",
  guideAstra: "Précise ta demande pendant qu’Astra travaille…",
  send: "Envoyer",
  steer: "Préciser",
  newLine: "Maj ↵ nouvelle ligne",
  stopSession: "Arrêter cette session",
  stopAstra: "Arrêter Astra",
  sendGuidance: "Envoyer une précision",
  steerTurn: "Préciser la demande en cours",
  sendMessage: "Envoyer le message",
  astraVoice: "Voix d’Astra",
  startVoice: "Activer la voix d’Astra",
  talkAstra: "Parler à Astra",
  pauseAstra: "Mettre Astra en veille",
  enableVoice: "Activer la voix",
  disableMicrophone: "Désactiver le micro",
  interruptAstra: "Interrompre Astra",
  returnHome: "Retour à l’accueil",
  here: "Je suis là.",
  listening: "Je t’écoute…",
  voiceStates: {
    off: "Micro désactivé",
    starting: "Connexion vocale",
    standby: "En veille",
    listening: "À ton écoute",
    thinking: "Je m’en occupe",
    speaking: "Astra répond",
    error: "Voix indisponible",
  },
  phoneActive: "Astra est ouverte sur ton téléphone.",
  closePhoneTab: "Ferme son onglet pour reprendre ici.",
  openingApps: "Ouverture de tes mini-apps…",
  appMissing: "La mini-app sélectionnée est introuvable.",
  reconnect: "Reconnecter",
  connecting: "Connexion…",
  disconnected: "Déconnectée",
  connected: "Codex connecté",
  working: "En cours",
  backgroundTasks: (count: number) =>
    count + (count > 1 ? " tâches en cours" : " tâche en cours"),
  dismissError: "Fermer l’erreur",
  liveCanvas: "Mini-app active",
  generatedCanvas: "Vue générée interactive",
  interactiveCanvas: "Vue interactive",
  restoreCanvas: "Restaurer une version",
  layoutFailed: "Cette vue doit être corrigée. Demande à Astra de la réparer.",
  canvasSaveFailed: (message: string) =>
    "Impossible d’enregistrer la vue : " +
    message +
    ". Le journal reste disponible avec la dernière version enregistrée.",
  reconnectBeforeSend: "Reconnecte Codex avant d’envoyer un message.",
  createApp: "Créer une mini-app",
  emptyTitle: "Que veux-tu créer ?",
  emptyDescription:
    "Décris une mini-app dans le journal. Elle prendra forme ici.",
  planWeek: "Organiser ma semaine",
  planWeekDetail: "Un tableau pour tes prochaines priorités",
  planWeekPrompt:
    "Crée une mini-app de planification hebdomadaire avec un tableau de tâches modifiable (À faire, En cours, Terminé), un titre court et un champ de notes. Commence avec une liste de tâches vide et quelques libellés utiles. Reste compact.",
  compareOptions: "Comparer mes options",
  compareOptionsDetail: "Un tableau clair et de la place pour les notes",
  compareOptionsPrompt:
    "Crée une mini-app d’aide à la décision avec un tableau comparant trois options, un champ pour nommer la décision et un champ de notes. Présente clairement les exemples comme modifiables. Utilise des composants simples et reste concis.",
  startIdea: "Partir d’une idée",
  startIdeaDetail: "Dis à Astra ce dont tu as besoin",
  startIdeaPrompt:
    "Aide-moi à préciser une nouvelle idée. Pose-moi d’abord une question utile, puis nous pourrons construire une mini-app interactive.",
  version: (generation: number) => `Version ${generation}`,
  restoreVersion: (generation: number) => `Restaurer la version ${generation}`,
  renderFailed:
    "Cette vue n’a pas pu s’afficher. Demande à Astra de la simplifier ou de la remplacer.",
  privateConnection: "Connexion privée au Mac…",
  reload: "Recharger",
  enableSound: "Activer le son",
  macDisconnected:
    "Connexion au Mac interrompue. Active Tailscale, ferme les autres onglets Astra, garde le Mac allumé puis recharge.",
  unreadableMac: "Le Mac a envoyé une réponse illisible. Recharge Astra.",
  reconnectVoice: "Reconnecte le téléphone au Mac avant d’activer la voix.",
  macOffline: "Mac déconnecté",
  connectionInterrupted:
    "La connexion privée au Mac est interrompue. Les actions n’ont pas été renvoyées automatiquement.",
  reconnectPhone: "Active Tailscale et recharge Astra pour retrouver le Mac.",
  phoneOpening: "L’interface du téléphone est encore en cours d’ouverture.",
  actionUnconfirmed:
    "Le Mac n’a pas confirmé cette action. Vérifie son état avant de réessayer.",
  phoneDisconnected:
    "Le téléphone est déconnecté du Mac. Active Tailscale puis recharge Astra.",
  micHttps:
    "Le microphone nécessite un navigateur récent et une connexion HTTPS.",
  micStopped: "Microphone arrêté.",
  micEnded:
    "Le téléphone a arrêté le microphone. Rouvre Astra puis active la voix.",
  slowVoice:
    "La connexion au Mac est trop lente pour la voix. Relance la voix avec une meilleure connexion.",
  audioSuspended:
    "Le navigateur a suspendu l’audio. Garde Astra au premier plan puis réactive la voix.",
  micInactive: "Le microphone du téléphone n’est plus actif. Relance la voix.",
  micNotReady: "Le microphone n’est pas prêt.",
  voiceInterrupted:
    "La connexion audio à Codex a été interrompue. Relance la voix.",
  audioReplaced: "La connexion audio a été remplacée.",
  noAudioOffer: "Le téléphone n’a pas produit de connexion audio.",
  audioExpired: "Cette connexion audio a expiré.",
  allowAudio: "Autorise l’audio du navigateur puis relance la voix.",
  audioPreparationFailed:
    "Le téléphone n’a pas pu préparer la connexion audio. Vérifie le réseau puis relance la voix.",
  playbackBlocked:
    "Le navigateur bloque le son. Appuie sur « Activer le son ». Si le blocage continue, autorise le son et la lecture automatique pour ce site.",
  playbackFailed: (message: string) =>
    "La lecture audio a échoué : " +
    message +
    ". Appuie sur « Activer le son » pour réessayer.",
  voiceBeforeSound: "Active la voix avant de réactiver le son.",
  playbackStillBlocked: "La lecture audio reste bloquée.",
  audioCloseFailed: (message: string) =>
    `Impossible de fermer l’audio : ${message}`,
};

const en: typeof fr = {
  interfaceLanguage: "Interface language",
  languageSaveFailed:
    "Could not save the interface language. Allow local storage and try again.",
  openJournal: "Open journal",
  closeJournal: "Close journal",
  journal: "Journal",
  journalLabel: "Continuous journal",
  journalEmpty: "The thread of what we do together.",
  journalEmptyDetail: "Our conversations and Astra’s actions will appear here.",
  history: "History",
  you: "You",
  voice: "voice",
  action: "action",
  message: "message",
  details: "Details",
  failureDetails: "Failure details",
  inProgress: "In progress",
  failed: "Unsuccessful",
  completed: "Completed",
  astraWorking: "Astra is working…",
  home: "Home",
  miniApps: "Mini-apps",
  browseApps: "Browse mini-apps",
  carousel: "carousel",
  browseHint: "Scroll or use the arrow keys.",
  previousApps: "Previous mini-apps",
  nextApps: "Next mini-apps",
  openApp: (name) => `Open ${name}`,
  manageApp: (name) => `Manage ${name}`,
  favorite: "Favorite",
  needsConfirmation: "Needs confirmation",
  addFavorite: "Add to favorites",
  removeFavorite: "Remove from favorites",
  rename: "Rename",
  deleteApp: "Delete app",
  deleting: "Deleting…",
  appName: "App name",
  appNameHint: "One or two words.",
  invalidAppName: "Use one or two words, up to 32 characters.",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  stopBeforeDelete: "Stop the current response to delete this app.",
  deleteConfirm:
    "Permanently delete this mini-app, its conversation, canvas, saved versions and Codex thread history? This cannot be undone. Project files and external backups will be kept.",
  deleteTitle: "Delete mini-app?",
  chooseFolder: "Choose a folder",
  chooseFolderPath: "Absolute path to an existing folder on the Mac:",
  model: "Model",
  reasoning: "Reasoning effort",
  modelSpeed: "Model speed",
  default: "Default",
  standard: "Standard",
  standardDescription: "Normal speed and usage",
  fast: "Fast",
  fastDescription: "Faster responses with higher usage",
  efforts: {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
    ultra: "Ultra",
  },
  approvalRequest: "Astra request",
  yourAnswer: "Your answer",
  answerLabel: (header) => `Your answer: ${header}`,
  decline: "Decline",
  sendAnswer: "Send answer",
  allowOnce: "Allow once",
  messageAstra: "Message Astra",
  writeAstra: "Write to Astra…",
  guideAstra: "Add guidance while Astra is working…",
  send: "Send",
  steer: "Steer",
  newLine: "Shift ↵ new line",
  stopSession: "Stop this session",
  stopAstra: "Stop Astra",
  sendGuidance: "Send guidance",
  steerTurn: "Steer the current turn",
  sendMessage: "Send message",
  astraVoice: "Astra voice assistant",
  startVoice: "Start Astra voice",
  talkAstra: "Talk to Astra",
  pauseAstra: "Pause Astra",
  enableVoice: "Enable voice",
  disableMicrophone: "Turn off microphone",
  interruptAstra: "Interrupt Astra",
  returnHome: "Return Home",
  here: "I’m here.",
  listening: "I’m listening…",
  voiceStates: {
    off: "Microphone off",
    starting: "Connecting voice",
    standby: "On standby",
    listening: "Listening",
    thinking: "Working on it",
    speaking: "Speaking",
    error: "Voice unavailable",
  },
  phoneActive: "Astra is open on your phone.",
  closePhoneTab: "Close its tab to continue here.",
  openingApps: "Opening your apps…",
  appMissing: "The selected mini-app is missing.",
  reconnect: "Reconnect",
  connecting: "Connecting",
  disconnected: "Disconnected",
  connected: "Codex connected",
  working: "Working",
  backgroundTasks: (count) =>
    count + (count === 1 ? " task running" : " tasks running"),
  dismissError: "Dismiss error",
  liveCanvas: "Live canvas",
  generatedCanvas: "Live generated canvas",
  interactiveCanvas: "Interactive canvas",
  restoreCanvas: "Restore canvas version",
  layoutFailed: "This layout needs a correction. Ask Astra to repair it.",
  canvasSaveFailed: (message) =>
    "Canvas changes could not be saved: " +
    message +
    ". The journal remains available using the last saved canvas.",
  reconnectBeforeSend: "Reconnect to Codex before sending a message.",
  createApp: "Create a mini-app",
  emptyTitle: "What will you make?",
  emptyDescription:
    "Describe a mini-app in the journal. It will take shape here.",
  planWeek: "Plan my week",
  planWeekDetail: "A board for what matters next",
  planWeekPrompt:
    "Create a weekly planning mini-app with an editable task board (To do, Doing, Done), a short heading and a notes input. Start with an empty task list and a few useful labels. Keep it compact.",
  compareOptions: "Compare my options",
  compareOptionsDetail: "A clear table and room for notes",
  compareOptionsPrompt:
    "Create a decision mini-app with a comparison table for three options, an input to name the decision, and a notes field. Label example options clearly as editable examples. Use high-level components and keep it concise.",
  startIdea: "Start from an idea",
  startIdeaDetail: "Tell Astra what you need",
  startIdeaPrompt:
    "Help me shape a new idea. Ask me one useful question first, then we can build an interactive mini-app for it.",
  version: (generation) => `Version ${generation}`,
  restoreVersion: (generation) => `Restore version ${generation}`,
  renderFailed:
    "This view could not render. Ask Astra to simplify or replace it.",
  privateConnection: "Private connection to your Mac…",
  reload: "Reload",
  enableSound: "Enable sound",
  macDisconnected:
    "The connection to your Mac was interrupted. Enable Tailscale, close other Astra tabs, keep your Mac awake and reload.",
  unreadableMac: "Your Mac sent an unreadable response. Reload Astra.",
  reconnectVoice: "Reconnect your phone to the Mac before enabling voice.",
  macOffline: "Mac disconnected",
  connectionInterrupted:
    "The private connection to your Mac was interrupted. Actions have not been retried automatically.",
  reconnectPhone: "Enable Tailscale and reload Astra to reconnect to your Mac.",
  phoneOpening: "The phone interface is still opening.",
  actionUnconfirmed:
    "Your Mac did not confirm this action. Check its state before trying again.",
  phoneDisconnected:
    "Your phone is disconnected from the Mac. Enable Tailscale and reload Astra.",
  micHttps: "The microphone requires a recent browser and an HTTPS connection.",
  micStopped: "Microphone stopped.",
  micEnded: "Your phone stopped the microphone. Reopen Astra and enable voice.",
  slowVoice:
    "The connection to your Mac is too slow for voice. Restart voice with a better connection.",
  audioSuspended:
    "Your browser suspended audio. Keep Astra in the foreground and enable voice again.",
  micInactive: "Your phone microphone is no longer active. Restart voice.",
  micNotReady: "The microphone is not ready.",
  voiceInterrupted:
    "The audio connection to Codex was interrupted. Restart voice.",
  audioReplaced: "The audio connection was replaced.",
  noAudioOffer: "Your phone did not produce an audio connection.",
  audioExpired: "This audio connection expired.",
  allowAudio: "Allow browser audio and restart voice.",
  audioPreparationFailed:
    "Your phone could not prepare the audio connection. Check your network and restart voice.",
  playbackBlocked:
    "Your browser blocked sound. Tap “Enable sound”. If it remains blocked, allow sound and autoplay for this site.",
  playbackFailed: (message) =>
    `Audio playback failed: ${message}. Tap “Enable sound” to try again.`,
  voiceBeforeSound: "Enable voice before restoring sound.",
  playbackStillBlocked: "Audio playback is still blocked.",
  audioCloseFailed: (message) => `Could not close audio: ${message}`,
};

export const messages = { fr, en };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readLanguage(
  storage?: Pick<PreferenceStorage, "getItem">,
): InterfaceLanguage {
  try {
    const value = (
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage)
    )?.getItem(LANGUAGE_STORAGE_KEY);
    return value === "en" ? "en" : "fr";
  } catch (error) {
    console.warn(
      "Astra could not read its interface language; using French.",
      error,
    );
    return "fr";
  }
}

export function writeLanguage(
  language: InterfaceLanguage,
  storage?: Pick<PreferenceStorage, "setItem">,
) {
  try {
    const target =
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage);
    if (!target) throw new Error("Local storage is unavailable.");
    target.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (cause) {
    throw new Error(messages[language].languageSaveFailed, { cause });
  }
  if (typeof window !== "undefined")
    window.dispatchEvent?.(new CustomEvent(LANGUAGE_CHANGED_EVENT));
}

export const getCopy = () => messages[readLanguage()];

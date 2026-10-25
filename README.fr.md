<p align="center"><img src=".github/assets/banner-fr.png" alt="Astra — Votre Jarvis personnel, propulsé par Codex" width="100%" /></p>

<p align="center"><a href="README.md">English</a> · <strong>Français</strong></p>
<p align="center">Un assistant vocal pour macOS et Windows, avec des mini-apps que vous créez et faites évoluer par la conversation.</p>
<p align="center"><a href="https://getastra.halcytron.chatgpt.site/?lang=fr">Site web</a> · <a href="#installation">Installer</a> · <a href="#découvrir-astra">Voir la démo</a> · <a href="CONTRIBUTING.md">Contribuer</a></p>

## Installation

Astra utilise votre [Codex CLI](https://developers.openai.com/codex/cli/) et votre connexion ChatGPT ; les limites de votre abonnement restent applicables.

### macOS

```sh
curl -fsSL https://getastra.halcytron.chatgpt.site/install.sh | bash
```

Pour les **Mac Apple Silicon sous macOS 14 ou ultérieur**. Autorisez les accès macOS nécessaires au premier lancement. Les premières versions sont signées localement, sans notarisation Apple.

[Télécharger directement](https://github.com/witong42/Astra/releases) · [Lire le script d’installation](install.sh)

### Windows

Téléchargez le **ZIP Windows x64** depuis les [versions](https://github.com/witong42/Astra/releases), décompressez toute l’archive, puis lancez **`Install.cmd`**. Retrouvez ensuite Astra dans le menu Démarrer.

Le moteur vocal local est inclus. Bun et Docker servent uniquement à compiler depuis les sources. Les premières versions Windows ne sont pas signées.

Les versions Linux ne sont pas encore disponibles.

## Découvrir Astra

[![Démonstration vocale réelle d’Astra en anglais](.github/assets/film-poster.png)](.github/assets/astra-demo-en.mp4)

**Votre assistant. Vos outils. À votre façon.** Demandez un tableau de bord pour votre journée, écoutez la réponse d’Astra, puis utilisez ses priorités et son minuteur de concentration. Trente secondes dans la vraie application, en anglais, avec les temps de génération raccourcis. [Voir la démo](.github/assets/astra-demo-en.mp4).

- **Parlez naturellement.** Discutez avec Astra, ou écrivez quand vous préférez.
- **Créez vos mini-apps.** Un suivi de projet, un programme de voyage, un quiz, ou le petit outil dont vous avez besoin.
- **Faites-les évoluer en demandant.** Un bouton en plus, une vue plus simple, une autre façon de travailler : Codex adapte l’app avec vous.
- **Retrouvez vos outils.** Rouvrez les apps sauvegardées et utilisez leurs commandes locales.
- **Continuez sur votre téléphone.** En option, reliez-le à votre ordinateur, allumé et connecté à votre réseau privé.

Essayez : **« Crée une mini-app pour suivre mon projet et ses prochaines étapes. »** Puis : **« Ajoute une vue plus simple pour me concentrer. »**

## Accès et données

Astra donne actuellement à Codex un **accès complet aux fichiers et aux commandes de votre ordinateur, sans confirmation**. Les mini-apps s’affichent dans des cadres isolés ; cela ne limite pas les outils système de Codex.

Stockage local par défaut :

| Plateforme | Apps et journal | Fichiers créés |
| --- | --- | --- |
| macOS | `~/Library/Application Support/Astra/` | `~/.astra/` |
| Windows | `%APPDATA%\Astra\` | `%USERPROFILE%\.astra\` |

Les requêtes passent par votre fournisseur Codex. Votre authentification existante reste en place. La voix dépend d’interfaces expérimentales de Codex, susceptibles de changer selon sa version.

<details>
<summary>Compiler depuis les sources</summary>

Installez [Bun](https://bun.sh/docs/installation) et Codex CLI, puis connectez-vous à Codex. Sur macOS, installez Homebrew, les outils en ligne de commande Apple et les outils de compilation du moteur vocal :

```sh
brew install autoconf automake libtool
```

Sur Windows, utilisez Bun x64 et Docker Desktop avec les conteneurs Linux pour compiler le moteur vocal. Puis, sur les deux plateformes :

```sh
git clone https://github.com/witong42/Astra.git
cd Astra
bun install --frozen-lockfile
bun start
```

Pour la voix en temps réel, utilisez la [distribution officielle complète de Codex](https://github.com/openai/codex/releases/latest/download/install.sh), avec ses ressources vocales. Le chemin de l’exécutable peut être indiqué avec ASTRA_CODEX_PATH.

</details>

## Accès téléphone

La configuration téléphone est documentée et testée sur macOS : reliez le Mac et le téléphone par Tailscale. Le Mac doit rester allumé, avec Astra ouverte. Le site de présentation public ne donne aucun accès à votre instance personnelle. [Configuration détaillée en anglais](README.md#phone-access).

## Contribuer

Testez Astra sur macOS ou Windows, signalez un problème reproductible ou proposez un changement ciblé. Consultez [CONTRIBUTING.md](CONTRIBUTING.md). Ne partagez jamais votre authentification, votre journal privé ou un fichier de sauvegarde complet.

Astra est un projet indépendant, sans affiliation avec OpenAI. Code original sous [licence MIT](LICENSE). Les licences tierces et les [crédits Solar Icons / 480 Design](THIRD_PARTY_NOTICES.md) sont conservés.

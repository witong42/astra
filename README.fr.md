<p align="center"><img src=".github/assets/banner-fr.png" alt="Astra — Votre Jarvis personnel, propulsé par Codex" width="100%" /></p>

<p align="center"><a href="README.md">English</a> · <strong>Français</strong></p>
<p align="center">Un assistant vocal pour votre Mac, avec des mini-apps que vous créez et faites évoluer par la conversation.</p>
<p align="center"><a href="https://getastra.halcytron.chatgpt.site/?lang=fr">Site web</a> · <a href="#installation">Installer</a> · <a href="#découvrir-astra">Voir la démo</a> · <a href="CONTRIBUTING.md">Contribuer</a></p>

## Installation

```sh
curl -fsSL https://getastra.halcytron.chatgpt.site/install.sh | bash
```

Pour les **Mac Apple Silicon sous macOS 14 ou ultérieur**. Une version Windows est en développement. Astra utilise votre [Codex CLI](https://developers.openai.com/codex/cli/) et votre connexion ChatGPT ; les limites de votre abonnement restent applicables. Autorisez les accès macOS nécessaires au premier lancement. Les premières versions sont signées localement, sans notarisation Apple.

[Télécharger directement](https://github.com/witong42/Astra/releases) · [Lire le script d’installation](install.sh)

## Découvrir Astra

[![Démonstration vocale réelle d’Astra en anglais](.github/assets/film-poster.png)](.github/assets/astra-demo-en.mp4)

**Votre assistant. Vos outils. À votre façon.** Demandez un tableau de bord pour votre journée, écoutez la réponse d’Astra, puis utilisez ses priorités et son minuteur de concentration. Trente secondes dans la vraie application, en anglais, avec les temps de génération raccourcis. [Voir la démo](.github/assets/astra-demo-en.mp4).

- **Parlez naturellement.** Discutez avec Astra, ou écrivez quand vous préférez.
- **Créez vos mini-apps.** Un suivi de projet, un programme de voyage, un quiz, ou le petit outil dont vous avez besoin.
- **Faites-les évoluer en demandant.** Un bouton en plus, une vue plus simple, une autre façon de travailler : Codex adapte l’app avec vous.
- **Retrouvez vos outils.** Rouvrez les apps sauvegardées et utilisez leurs commandes locales.
- **Continuez sur votre téléphone.** En option, reliez-le au même Mac, allumé et connecté à votre réseau privé.

Essayez : **« Crée une mini-app pour suivre mon projet et ses prochaines étapes. »** Puis : **« Ajoute une vue plus simple pour me concentrer. »**

## Accès et données

Astra donne actuellement à Codex un **accès complet aux fichiers et aux commandes de votre Mac, sans confirmation**. Les mini-apps s’affichent dans des cadres isolés ; cela ne limite pas les outils système de Codex.

Les apps et le journal sont stockés dans ~/Library/Application Support/Astra/. Les fichiers créés vont par défaut dans ~/.astra/. Les requêtes passent par votre fournisseur Codex. Votre authentification existante reste en place. La voix dépend d’interfaces expérimentales de Codex, susceptibles de changer selon sa version.

<details>
<summary>Compiler depuis les sources</summary>

Installez [Bun](https://bun.sh/docs/installation), les outils en ligne de commande Apple et Codex CLI. Connectez-vous à Codex, puis :

```sh
git clone https://github.com/witong42/Astra.git
cd Astra
bun install --frozen-lockfile
bun start
```

Pour la voix en temps réel, utilisez la [distribution officielle complète de Codex](https://github.com/openai/codex/releases/latest/download/install.sh), avec ses ressources vocales. Le chemin de l’exécutable peut être indiqué avec ASTRA_CODEX_PATH.

</details>

## Accès téléphone

Reliez le Mac et le téléphone par Tailscale. Le Mac doit rester allumé, avec Astra ouverte. Le site de présentation public ne donne aucun accès à votre instance personnelle. [Configuration détaillée en anglais](README.md#phone-access).

## Contribuer

Testez Astra sur votre Mac, signalez un problème reproductible ou proposez un changement ciblé. Consultez [CONTRIBUTING.md](CONTRIBUTING.md). Ne partagez jamais votre authentification, votre journal privé ou un fichier de sauvegarde complet.

Astra est un projet indépendant, sans affiliation avec OpenAI. Code original sous [licence MIT](LICENSE). Les licences tierces et les [crédits Solar Icons / 480 Design](THIRD_PARTY_NOTICES.md) sont conservés.

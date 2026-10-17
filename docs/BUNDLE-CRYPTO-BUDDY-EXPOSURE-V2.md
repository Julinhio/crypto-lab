# Bundle `crypto-buddy-exposure-v2`

Données du banc d'exposition v1.3 de `crypto-buddy` (protocole
`docs/PROTOCOLE-EXPOSITION-v1.3.md` dans ce dépôt-là). Ce bundle remplace le v1, qui
contenait physiquement la fenêtre de validation scellée.

## Trois parties, trois configurations

| Partie | Configuration | Univers | Bornes | Où |
|---|---|---|---|---|
| calibration, cœur | `config/crypto-buddy-exposure-v2-core.json` | BTC, ETH, BNB, XRP | `[2020-01-01, 2024-07-01)` | `data/bundles/crypto-buddy-exposure-v2-core/` |
| calibration, SOL | `config/crypto-buddy-exposure-v2-sol.json` | SOL | `[2020-08-11T04:00, 2024-07-01)` | `data/bundles/crypto-buddy-exposure-v2-sol/` |
| validation scellée | `config/crypto-buddy-exposure-v2-validation.json` | les cinq | `[2024-06-30T20:00, 2026-06-01)` | **hors dépôt** |

**Aucune bougie ouverte à partir du `2024-07-01` n'est dans ce dépôt.** La borne
`as_of_exclusive` des deux parties de calibration est le `2024-07-01T00:00:00.000Z`, et la
règle d'admissibilité du vérificateur la re-juge ligne par ligne.

### Pourquoi SOL est une partie à part

SOL n'est coté sur Binance qu'à partir du 11/08/2020 (première bougie 4h ouverte à 04:00
UTC, première journalière le 11/08 à 00:00, journée partielle). Le producteur refuse, à
raison, une série qui commence après `fetch_start`. Deux voies existaient : modifier le
producteur pour accepter un début déclaré, ce qui change `producer_source_sha256` et fait
échouer la vérification du bundle v1 déjà publié ; ou donner à SOL sa propre
configuration. La seconde ne touche à aucun fichier source. Le `fetch_start` de SOL est
posé à 04:00 : la journalière partielle du jour de cotation n'est donc pas incluse, ce qui
est sans effet sur le régime (qui ne lit que des bougies closes, à partir de la cinquantième).

Le cœur garde son amorce depuis le 2020-01-01, nécessaire à une SMA200 journalière valide
avant le 2021-01-01.

### La partie scellée

Produite avec le même code, sans aucun calcul autre que les contrôles d'intégrité du
producteur (admissibilité, ordre, doublons, trous). Ses fichiers sont écrits dans
`C:\Users\julin\OneDrive\Documents\Claude\crypto-buddy-sealed\exposure-v2-validation\`.
Seule son empreinte est commitée :
`data/bundles/crypto-buddy-exposure-v2-validation.fingerprint.json` (`bundle_sha256`,
SHA-256 du manifeste, SHA-256 de chaque fichier).

Son `fetch_start` est la dernière barre 4h de calibration (`2024-06-30T20:00`). Ce
chevauchement d'une barre est voulu : il sert au test de préfixe du banc à l'ouverture.
Cette barre est une donnée de calibration, déjà présente dans le cœur.

### Ce que le sceau garantit, et ce qu'il ne garantit pas

**Il garantit l'absence de mesure et de réglage sur `[2024-07-01, 2026-06-01)`** : aucun
chemin de calibration ni de mesure du banc v1.3 ne lit ces bougies, et le chargeur de
calibration de `crypto-buddy` refuse tout bundle qui en contient une. C'est une garantie de
procédure, prouvée par le code et par les tests.

**Il ne garantit pas l'ignorance du marché.** Les expositions connues, sans les minimiser :

- ces bougies sont des données publiques de Binance ;
- le bundle `crypto-buddy-exposure-v1` les contient (BTC, ETH, BNB, XRP jusqu'au
  2026-08-20). Il reste dans l'arbre et l'historique de ce dépôt, et dans l'historique de
  `crypto-buddy` ;
- la PR #36 de `crypto-buddy` (21/08/2026) a calculé des indicateurs de régime sur toute la
  durée de ce bundle, fenêtre scellée comprise. Aucun résultat de stratégie n'a été calculé
  ni publié sur cette fenêtre : l'ouverture hors-échantillon de cette PR n'a jamais eu lieu ;
- l'évolution générale du marché sur 2024-2026 est connue de toute l'équipe.

La fenêtre est donc « non mesurée », pas « jamais vue ». Le seul hors-échantillon
réellement inédit reste le futur.

## Vérification

```bash
node src/exposure-bundle.mjs verify --config config/crypto-buddy-exposure-v2-core.json --bundle data/bundles/crypto-buddy-exposure-v2-core
node src/exposure-bundle.mjs verify --config config/crypto-buddy-exposure-v2-sol.json --bundle data/bundles/crypto-buddy-exposure-v2-sol
```

`npm test` vérifie les deux parties de calibration, l'absence de toute bougie ouverte à
partir du `2024-07-01` dans ce dépôt pour le v2, et la forme de l'empreinte scellée.

## Ce que ce bundle ne contient pas

Ni funding, ni série longue pour l'ATH (arbitrage du protocole v1.3, point 3).

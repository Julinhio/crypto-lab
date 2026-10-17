# Crypto Lab — harness auditable du council Bot B

Ce dépôt fige le harness utilisé pour les mesures du council sur le Bot B. Il ne
contient aucun appel à un LLM et n'écrit dans aucune base. Les données viennent de
l'API publique Binance, sont arrêtées sur une borne horaire exclusive, puis
contrôlées par SHA-256.

## État canonique

- `as_of` exclusif : `2026-07-26T15:00:00.000Z`
- historique principal : du `2025-07-26T15:00:00.000Z` inclus à l'`as_of`
- corridor initial : du `2026-06-08T15:00:00.000Z` inclus à l'`as_of` (48 jours)
- amorce indicateurs/téléchargement : `2025-07-08T15:00:00.000Z`
- intervalle : bougies `1h`
- coût aller-retour `k` : `0,003`, soit `0,3%` du notionnel
- référence du plancher de bruit : `d` calculé au déclenchement, comparé à
  `1,5 × ATR%` observé sur la barre de setup
- univers : `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `XRPUSDT`, `SOLUSDT`,
  `DOGEUSDT`, `ADAUSDT`, `TRXUSDT`, `LINKUSDT`, `AVAXUSDT`, `LTCUSDT`,
  `BCHUSDT`, `DOTUSDT`, `NEARUSDT`, `SUIUSDT`
- témoin de sélection : `20 000` tirages, seed `123456789`
- permutations exploratoires : `20 000`, seed `246813579`
- bootstrap préenregistré pour le protocole suivant : `50 000`, seed
  `975318642`, blocs de `4` semaines. Il n'est pas utilisé pour fabriquer les
  chiffres de ce replay.

La source d'autorité de tous les paramètres est
[`config/measurements.json`](config/measurements.json). L'absence de
`Date.now()` dans le moteur est volontaire.

Chaque paire possède aussi une raison terminale explicite :
`replay-cutoff` ou `pair-death`. La première produit une censure technique
publiée ; la seconde valorise la position à zéro et conserve la perte dans les
résultats.

## Reproduction complète

Pré-requis : Node.js 22. Aucune dépendance npm n'est requise.

```powershell
npm test
node src/cli.mjs download --config config/measurements.json --data data/frozen
node src/cli.mjs run --config config/measurements.json --data data/frozen --out results/current
```

Pour prouver la reproductibilité depuis deux états propres indépendants :

```powershell
node src/clean-room.mjs --root repro/mon-audit
```

Le dossier indiqué doit être absent. Le script refuse tout dossier préexistant,
télécharge deux jeux, exécute deux replays et compare tous les SHA-256 des
sorties. Il sort avec un code non nul au moindre écart.

## Où retrouver chaque chiffre

Une exécution de `run` recalcule toutes les mesures. Chaque ligne est brute et
recalculable sans lire le résumé.

| Mesure du council | Sortie |
|---|---|
| corridor selon le plancher d'ATR | `corridor-by-atr-floor.csv` |
| témoin sans edge : cible / stop / péremption à 24h | ligne `alphaAtr=1.5`, `stopMode=recent-swing` du même CSV |
| trailing selon le seuil d'armement | `trailing-by-arm.csv` |
| objectif `1R` à `2R`, brut et exécutable | `target-sweep.csv` |
| portefeuille à 2, 3 et 4 emplacements | `capacity-slots.csv` |
| sélection aléatoire, 20 000 tirages | `random-selection-control.csv` |
| oracle sous deux emplacements | `oracle.csv` |
| neuf caractéristiques exploratoires et diagnostic ATR% préenregistré | `feature-tertiles.csv` |
| corrélations entre caractéristiques | `feature-correlations.csv` |
| compteurs du scanner breakout | `breakout-plan-stats.csv` |

Exemple PowerShell :

```powershell
Import-Csv results/current/target-sweep.csv |
  Where-Object { $_.family -eq "breakout" }
```

## Séparation anti-fuite

Les 44 candidats breakout `2R` sont exposés sous trois formes :

- `breakout-2r-candidate-snapshots.csv` : uniquement ce qui était observable à
  l'armement ;
- `breakout-2r-candidate-outcomes.csv` : issue réalisée, séparée ;
- `breakout-2r-candidates-joined.csv` : jointure explicite réservée à
  l'évaluation indépendante.

Une future politique ou un futur prompt ne doit lire que le fichier de
snapshots. Le CSV joint ne doit jamais être utilisé comme entrée d'un
sélectionneur.

## Découpage du code

- `src/data.mjs` : téléchargement, normalisation, manifeste et contrôles SHA ;
- `src/indicators.mjs` : ATR, moyennes, volume et plausibilité ;
- `src/engine.mjs` : setups, gate, entrées et sorties ;
- `src/portfolio.mjs` : capacité, hasard et oracle ;
- `src/analysis.mjs` : mesures du council ;
- `src/output.mjs` : CSV et manifeste de résultats ;
- `src/runner.mjs` : orchestration sans réseau ;
- `src/cli.mjs` et `src/clean-room.mjs` : commandes reproductibles.

Acquisition partagée, utilisée par le harness et par les bundles :

- `src/binance-source.mjs` : source verrouillée et préflight ;
- `src/timeframe.mjs` : pas de curseur par timeframe et règle d'admissibilité ;
- `src/candle.mjs` : validation des charges utiles, partagée acquisition/vérification ;
- `src/klines.mjs` : pagination et contrôles de continuité ;
- `src/exposure-config.mjs`, `src/producer-source.mjs` et
  `src/exposure-bundle.mjs` : production du bundle `crypto-buddy-exposure-v1`.

## Données et manifestes

`data/frozen/manifest.json` donne, pour chaque paire, le nombre de lignes, la
première et la dernière heure et le SHA-256 du fichier brut. Le chargeur refuse
un fichier altéré, une bougie à ou après l'`as_of`, ou un manifeste produit avec
une autre configuration.

`results/canonical/results-manifest.json` contient les SHA-256 de toutes les
sorties. Le rapport de l'audit propre est dans
`audit/REPRODUCTION-2026-07-26.md`.

La proposition fail-closed pour les coûts historiques par paire et par époque
est dans `docs/COST-MODEL-PROPOSAL.md`. Elle doit être signée avant le replay de
falsification ; le `k=0,3%` actuel ne doit pas être étendu aux anciennes
altcoins.

## Bundles pour `crypto-buddy`

`data/bundles/crypto-buddy-exposure-v1/` fige les bougies `4h` et `1d` de BTC,
ETH, BNB et XRP entre 2020 et 2026, pour que `crypto-buddy` recalibre sa bande
d'exposition ailleurs que sur un seul mois haussier. Le contrat de consommation,
les preuves de provenance et le trou Binance du 19 février 2020 sont documentés
dans `docs/BUNDLE-CRYPTO-BUDDY-EXPOSURE-V1.md`.

`data/bundles/crypto-buddy-exposure-v2-core/` et `data/bundles/crypto-buddy-exposure-v2-sol/`
forment le bundle v2 de **calibration seule** : uniquement les bougies ouvertes avant le
`2024-07-01`, SOL compris. La partie de validation est écrite hors de tout dépôt ; seule
son empreinte est commitée, dans
`data/bundles/crypto-buddy-exposure-v2-validation.fingerprint.json`. Voir
`docs/BUNDLE-CRYPTO-BUDDY-EXPOSURE-V2.md`, y compris ce que ce sceau ne garantit pas :
la fenêtre est non mesurée, pas jamais vue (le v1 ci-dessus la contient).

Aucune logique de régime, de transition ou de porte ne vit dans ce dépôt : elle
reste dans `crypto-buddy`.

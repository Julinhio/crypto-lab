# Relecture croisée du harness — Claude Code, 26 juillet 2026

Relecture indépendante du moteur par un agent qui n'a pas écrit le code, après
les trois corrections déjà appliquées (retrait du `forwardMfe` des objets
bougie, séparation censure technique / mort de paire, garde anti-réarmement).
Aucune correction n'est appliquée par ce document : il consigne les findings,
les chiffres de sensibilité mesurés, ce qui a été vérifié comme sain, et le
découpage proposé du chantier coûts.

## Chiffres de sensibilité mesurés

Les deux compteurs qui décident de la suite, sur le scan breakout `2R`
canonique (`high-first`, TTL 24 h) :

- `sameBarTriggerAndInvalidation` : **2** (publié dans
  `breakout-plan-stats.csv`). En comptant chaque cas écarté comme un `-1R`
  vraisemblable, l'exécutable passe de `+6,858607R` à environ `+4,86R` : le
  signe survit largement au stress.
- bougies en collision stop+cible dans le scan `2R` : **0**. Mesuré en
  rejouant le scan sous `high-first` et `pessimistic` puis en comparant les 44
  candidats un à un : aucune divergence d'issue ni d'`exitR`, les deux
  politiques produisent des résultats identiques (`+16,756312R` brut,
  `+6,858607R` exécutable sur 30 trades dans les deux cas). Le choix
  `high-first` du sweep n'a donc aucun impact sur les chiffres canoniques `2R`.
  Réserve : ce zéro vaut pour `2R` ; aux cibles plus courtes du sweep, des
  collisions restent possibles et le compteur n'est pas publié.

## Findings

Classés par importance. Aucun ne renverse les conclusions canoniques ; les deux
premiers touchent des chiffres publiés.

### 1. Politique de collision `high-first` sur les chiffres canoniques

`measurements.targetSweepCollisionPolicy` vaut `high-first` : quand une même
bougie touche le stop et la cible, `simulateOpenedTrade` résout en cible
atteinte, la branche optimiste. Le scan `breakout:2` du target sweep est la
source de tous les chiffres phares (capacité, contrôle aléatoire, oracle,
tertiles), alors que le témoin corridor et le trailing utilisent `pessimistic`.
Mesure ci-dessus : impact nul sur `2R`. Reste à faire : publier un compteur de
collisions dans `planStats` et documenter ou unifier la politique.

### 2. Lookahead intra-bougie dans le stop suiveur

Dans `simulateOpenedTrade` (mode `trailing`, à l'armement comme en régime
armé), le pic est mis à jour avec le high de la bougie courante, le stop
suiveur est remonté à partir de ce pic, puis testé contre le low de la même
bougie. Cela suppose que le high précède le low dans chaque bougie. Cas biaisé
optimiste : si le low touche l'ancien stop, le réel sort à l'ancien niveau,
le simulé sort au niveau gonflé par un high potentiellement postérieur.
Affecte `trailing-by-arm.csv`, dont la sortie moyenne des trades armés.
Correctif proposé : tester le low contre le stop tel qu'il était à la clôture
de la bougie précédente, puis ratcheter.

### 3. `sameBarTriggerAndInvalidation` écarté au lieu de compté en perte

Un plan dont la bougie de déclenchement touche à la fois le trigger et le stop
est abandonné. En réalité, un ordre stop d'entrée résident aurait
vraisemblablement été exécuté puis stoppé : un `-1R` probable est retiré de la
population. Compteur publié (valeur actuelle : 2), donc bornable ; devrait
exister en scénario stress comptant ces cas à `-1R`.

### 4. La collision pessimiste ignore le gap sous le stop

La branche collision retourne `exitR = -1` exactement, même si la bougie ouvre
sous le stop, alors que le chemin stop simple remplit à l'open en cas de gap.
Sur une bougie qui gappe sous le stop et touche la cible, la collision paie
mieux que le stop simple. Rare, incohérent dans le sens optimiste.

### 5. Aucune vérification de continuité horaire

Le chargeur vérifie SHA, `as_of` et raison terminale, mais jamais que les
bougies sont contiguës heure par heure. Toute l'arithmétique temporelle du
moteur est en indices (`elapsedHours`, TTL, expiry, fenêtres de plausibilité) :
un trou de données étire silencieusement toutes les fenêtres en temps réel. Le
téléchargeur a le même angle mort : `page.length < 1000` comme condition
d'arrêt peut masquer une troncature au milieu de l'historique.

### 6. Défauts mineurs

- Les champs `ema84`, `sma200`, `priorHigh20`, `medianVolume20` codent en dur
  des valeurs de config pourtant paramétrables : changer `emaHours` laisse un
  champ nommé `ema84`.
- `planStats` est asymétrique entre familles : `setupRuns`, `gateRejected*`,
  `invalidated` ne sont incrémentés que pour le breakout, le pullback rejette
  au gate en silence, mais `technicalCensored` et `pairDeathsMarkedToZero`
  sont partagés. Les lignes trailing publient ces compteurs pour les deux
  familles avec des sémantiques différentes.
- Pas de validation par schéma de la configuration : une clé mal orthographiée
  produit `undefined` puis des NaN silencieux. `corridorEvaluationStartMs`
  n'est pas inclus dans l'invariant d'ordre des dates.
- `rowsWithPercentDates` dans `output.mjs` est un no-op : code mort trompeur.
- `recentSwingStopDistance` retourne NaN si le premier pivot confirmé donne une
  distance non positive, au lieu d'essayer un pivot plus profond : choix de
  population défendable mais non documenté.
- Le LCG 32 bits sert au shuffle des permutations avec un léger biais modulo :
  acceptable pour un contrôle exploratoire, à documenter.

## Vérifié comme sain

Chemins explicitement inspectés pour du lookahead et trouvés corrects :

- `priorPlausible24` : la fenêtre forward la plus récente utilisée se termine
  exactement à la bougie de setup incluse, jamais au-delà ; observable à la
  clôture.
- `priorHigh20` et `medianVolume20` excluent la bougie courante ; ATR, EMA et
  SMA incluent la clôture courante, ce qui est correct pour une décision à la
  clôture.
- Entrée pullback à la clôture du setup, simulation démarrant à la bougie
  suivante.
- Entrée breakout à `max(trigger, open)` avec gate évalué au moment du
  déclenchement : implémentable en production (surveiller le trigger, évaluer,
  entrer au marché).
- Warm-up EMA : résidu du seed initial d'environ `3e-5` au début de
  l'évaluation, négligeable.
- Cohérence de l'occupation des slots : `exitTime == entryTime` occupe le slot
  dans `selectByCapacity` et dans l'oracle, mêmes conventions.
- Garde anti-réarmement : couvert y compris pour un setup né avant
  `evaluationStart`.

## Recommandations d'industrialisation

1. Gate de régression bit à bit : `data/frozen` étant commité, un job peut
   exécuter les tests, rejouer le run et comparer le `results-manifest.json`
   produit au canonique. C'est la protection prioritaire ; le clean-room
   réseau reste manuel.
2. Tests : couvrir gap fills, expiry, trailing (ordre high/low intra-bougie),
   les deux politiques de collision, la libération de slots, l'oracle contre
   une énumération brute sur petit cas, `percentile`/`ranks`.
3. Validation d'entrée : schéma de config strict avec rejet des clés
   inconnues ; contrôle de continuité horaire au chargement ; détection de
   troncature au téléchargement.
4. `// @ts-check` + JSDoc sur `src/`, sans build ni dépendance.
5. Documentation : conventions du repo (pas de `Date.now()`, pas de dépendance
   npm, tout chiffre passe par un manifeste), sémantique exacte de chaque
   compteur `planStats`, flux données → indicateurs → scan → portefeuille →
   sorties.

## Découpage proposé du chantier coûts

- **Lot 0 — préenregistrement (le goulot).** Signer les cinq décisions
  ouvertes avant de regarder un seul résultat. Points durs : l'estimateur de
  spread (proposition : fenêtres courtes contenant au moins un trade
  taker-buy et un taker-sell via `isBuyerMaker`, spread effectif estimé par
  `VWAP(buys) − VWAP(sells)`, agrégé par paire et par mois avec seuil
  d'observations) ; le barème de frais historique, avec décision explicite sur
  l'époque zéro-fee des paires BTC de juillet 2022 à mars 2023, promotion
  universelle et démontrable ; le multiplicateur de stress.
- **Lot 1 — acquisition.** Downloader `data.binance.vision` (aggTrades avec
  les fichiers `.CHECKSUM` officiels). Deux problèmes pratiques : les archives
  sont des ZIP et Node n'a pas d'unzip natif, il faut trancher entre une
  première dépendance et un outil shell ; et le volume, qui se compte en Go
  par mois sur les grosses paires. Parade : ne pas conserver les archives,
  échantillonner des fenêtres par époque avec tirage seedé plus les fenêtres
  autour des instants d'armement, archiver uniquement les tranches extraites
  avec le checksum de l'archive source dans `evidence`. Bonne nouvelle : les
  archives des paires délistées restent disponibles.
- **Lot 2 — estimateur et tests synthétiques.** Injecter un flux artificiel à
  spread connu et vérifier que l'estimateur le retrouve, y compris en flux
  unilatéral, chemin « données insuffisantes » compris.
- **Lot 3 — builder de snapshots.** JSON par paire et fenêtre, non
  chevauchants, commités, avec compteurs de couverture par paire et par année.
- **Lot 4 — intégration moteur.** Refactor non trivial : `k` est aujourd'hui
  un scalaire global lu une fois dans `scanFamily` et il entre dans le gate
  (`requiredMove = gate × (d + k) + k`), donc un `k` par paire et par époque
  change la population de candidats, pas seulement le P&L. `k` doit devenir
  une résolution `(symbole, instant d'armement) → snapshot | stress |
  inéligible` traversant tout le moteur. L'itération de taille converge
  trivialement (contraction). Le runner refuse tout verdict tant que le lot 0
  n'est pas signé.
- **Lot 5 — audit.** Extension du clean-room et rapport de reproduction.

Risque résiduel principal : sur les vieilles altcoins, le chemin « données
insuffisantes » tirera souvent ; c'est voulu, mais si la couverture tombe trop
bas, le replay de falsification perd sa puissance. Le rapport de couverture du
lot 3 le dira tôt.

## Ordre de reprise convenu

1. Gate de régression bit à bit.
2. Correctifs de collision (compteur publié, politique documentée ou unifiée),
   puis les findings 2 à 5, avec republication auditée.
3. Lot 0 du chantier coûts.

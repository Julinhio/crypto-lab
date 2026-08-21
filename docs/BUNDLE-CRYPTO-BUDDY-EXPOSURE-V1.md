# Bundle `crypto-buddy-exposure-v1`

Faits historiques figés, produits par `crypto-lab` et consommés par
`crypto-buddy`. Ce dépôt ne produit que les bougies. Le calcul de régime,
l'hystérésis, la transition collante et la porte d'exposition vivent dans
`crypto-buddy` et n'ont aucune contrepartie ici.

## Pourquoi ce bundle existe

Le journal du bot ne couvre qu'un mois, et ce mois est haussier. Calibrer une
bande d'exposition dessus produirait un réglage sur-ajusté à une seule phase de
marché. Le régime et la porte étant des fonctions déterministes des bougies,
`crypto-buddy` peut les recalculer sur plusieurs années, marchés baissiers
compris, à condition de disposer de faits stables. C'est ce que fige ce bundle.

## Paramètres

| Paramètre | Valeur |
| --- | --- |
| Source | `https://data-api.binance.vision`, verrouillée |
| Univers | `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `XRPUSDT` |
| Timeframes | `4h` et `1d`, natifs Binance, aucune agrégation |
| `fetch_start` | `2020-01-01T00:00:00.000Z` |
| `evaluation_start` | `2021-01-01T00:00:00.000Z` |
| `as_of_exclusive` | `2026-08-21T00:00:00.000Z` |

Les trois bornes sont distinctes et publiées séparément dans le manifeste.
`fetch_start` sert à l'amorce des indicateurs, SMA200 comprise ;
`evaluation_start` est la borne à partir de laquelle `crypto-buddy` évalue.
`crypto-lab` ne fait qu'écrire `evaluation_start` dans le manifeste, il ne
tronque rien avec.

## Règle d'admissibilité

Une bougie est retenue si et seulement si les trois conditions sont vraies :

- `openTime >= fetchStart`
- `openTime < asOfExclusive`
- `closeTime < asOfExclusive`

La clôture s'évalue contre la borne historique, jamais contre l'heure à laquelle
tourne le téléchargement. Le nombre de bougies écartées est publié par série.

Avec les bornes ci-dessus, ce compteur vaut `0` sur les huit séries :
`as_of_exclusive` tombe sur `00:00:00Z`, une frontière alignée pour `4h` comme
pour `1d`, donc toute bougie satisfaisant la deuxième condition satisfait
mécaniquement la troisième. Ce `0` est le résultat correct, pas un contrôle
mort : la troisième condition est couverte par un test unitaire sur bougie
synthétique, la donnée réelle ne l'exerçant jamais à ces bornes.

## Validation des charges utiles

`Number()` transforme un champ malformé en `NaN`, et `JSON.stringify` transforme
`NaN` en `null`. Sans garde-fou, une réponse invalide de la source se figerait
donc dans un fichier de données sous la forme d'un prix `null` — ou d'un `0`,
puisque `Number(null)` vaut `0` et qu'un volume nul est parfaitement légal.

`src/candle.mjs` porte la règle, partagée par les deux consommateurs :
l'acquisition, qui convertit les lignes brutes de l'API, et la vérification, qui
relit un bundle écrit. Une ligne est refusée si l'une de ces conditions manque :

- au moins onze champs dans la ligne API ;
- chaque champ brut est un nombre ou une chaîne non vide, avant toute
  conversion — c'est ce qui attrape `null`, qui se convertirait sinon en zéro
  crédible ;
- tous les champs convertis sont finis ;
- `openTime` et `closeTime` sont des entiers positifs ;
- ouverture, haut, bas et clôture sont strictement positifs ;
- volume, volume quote, nombre de transactions et volumes taker sont supérieurs
  ou égaux à zéro ;
- `closeTime >= openTime` ;
- cohérence interne : `l <= min(o, c)` et `max(o, c) <= h`. Fini et strictement
  positif ne suffit pas — un haut sous l'ouverture décrit une bougie qui n'a pas
  pu exister, et les mesures de range et de volatilité en aval s'en nourriraient.

Un volume nul reste accepté, et une bougie plate aussi : l'absence de mouvement
est un fait, pas un défaut. À l'acquisition, une ligne invalide arrête le run ;
à la vérification, elle est comptée et rapportée sous le label `invalid_rows`.

## Contrôle des doublons

`duplicate_open_times_returned_by_source` compte les ouvertures que la source a
renvoyées plus d'une fois, mesurées **à l'ingestion**. C'est délibéré : la série
écrite est indexée par `openTime`, donc compter les doublons après coup
répondrait toujours `0` et publierait une tautologie plutôt qu'un contrôle.

Deux charges utiles différentes pour une même ouverture ne sont pas
arbitrables : le run s'arrête au lieu de laisser le dernier arrivé l'emporter.

## Contenu

```
data/bundles/crypto-buddy-exposure-v1/
  manifest.json
  raw/{SYMBOL}-{TIMEFRAME}.json
```

Chaque fichier de données est un tableau JSON compact, une bougie par entrée,
ordre chronologique strict, clés stables, newline final. Le consommateur fait un
`JSON.parse` et rien d'autre.

| Clé | Sens |
| --- | --- |
| `t` | `openTime`, ms epoch UTC |
| `o` `h` `l` `c` | ouverture, haut, bas, clôture |
| `v` | volume base |
| `closeTime` | ms epoch UTC, dernière ms incluse dans la bougie |
| `qv` | volume quote |
| `trades` | nombre de transactions |
| `takerBuyBase` `takerBuyQuote` | volumes taker acheteur |

## Preuves de provenance

`producer_source_sha256` est le hash canonique des fichiers d'acquisition qui
ont produit le bundle, calculé en parcourant le graphe d'imports statiques
depuis `src/exposure-bundle.mjs`. Le détail fichier par fichier est publié dans
`producer_source_files`.

`generation_git_commit` est **informatif et n'est jamais une preuve
d'autorité**. Le bundle et son manifeste entrent dans le commit qui les produit,
puis la branche est squashée : le SHA final n'existe pas au moment de la
génération et change encore au merge. Le raisonnement est circulaire, d'où
`producer_source_sha256`, qui est stable et vérifiable après coup.

`bundle_sha256` porte sur une représentation canonique et ordonnée de
`bundle_id`, de `source`, des trois bornes, de `producer_source_sha256`, de
`acquisition_config_sha256` et de la liste triée des huit fichiers avec leur
SHA-256. Il ne porte pas sur `manifest.json`, qui le contient.

## Vérifier le bundle, hors ligne

```bash
node src/exposure-bundle.mjs verify --config config/crypto-buddy-exposure-v1.json --bundle data/bundles/crypto-buddy-exposure-v1
```

Sortie `0` si tout passe, `2` sinon. Les dix contrôles sont indépendants :

- `schema_version_supported` : `verify` est lui-même un consommateur du
  manifeste, il refuse une version de protocole qu'il ne sait pas lire ;
- `files_intact` : les huit fichiers ont le SHA-256 annoncé ;
- `bundle_sha256_consistent` : le manifeste est cohérent avec lui-même ;
- `producer_source_unchanged` : les sources d'acquisition actuelles hashent
  toujours à la valeur enregistrée ;
- `acquisition_config_unchanged` : la configuration n'a pas bougé ;
- `controls_clean` : ni doublon, ni rupture d'ordre ;
- `series_complete` : l'ensemble des séries du manifeste correspond exactement à
  `universe × timeframes` de la configuration, sans manquante, sans intruse,
  sans doublon ;
- `metadata_matches_config` : `bundle_id`, `source` et les trois bornes du
  manifeste sont comparés champ par champ à la configuration ;
- `series_reach_cutoff` : chaque série atteint le dernier créneau de son
  timeframe avant `as_of_exclusive` ;
- `controls_recomputed` : nombre de lignes, bornes, ordre et trous sont
  **recalculés depuis les fichiers de données** et confrontés à ce que le
  manifeste annonce ; la règle d'admissibilité est réappliquée à chaque bougie,
  le nom de fichier doit correspondre au couple `symbol`/`timeframe` sous lequel
  la série est classée, et chaque bougie repasse la validation de charge utile.

Les trois derniers contrôles ne sont pas redondants avec les hashes, parce que
la cohérence de hash ne prouve que la cohérence interne, jamais l'exactitude.

- Retirer une série et son fichier puis recalculer `bundle_sha256` sur ce qui
  reste produit un manifeste parfaitement cohérent avec lui-même. Seule la
  comparaison à la configuration distingue un bundle complet d'un bundle
  tronqué.
- Le hash de la configuration prouve que le fichier de configuration n'a pas
  changé ; il ne dit rien sur le fait que le manifeste soit toujours d'accord
  avec lui. Un manifeste re-scellé peut annoncer une autre fenêtre d'évaluation
  ou une autre identité, et `source` peut même être modifié sans re-sceller
  quoi que ce soit.
- Une valeur comme `strictly_ordered` ou `gap_count` est une affirmation sur la
  donnée : elle est recalculée, jamais crue sur parole. `duplicates_ok` est
  dérivé du compteur authentifié, pas lu comme booléen.
- Recalculer des compteurs et des bornes ne remarquerait pas une bougie clôturant
  au-delà de la coupure. L'admissibilité est donc réappliquée ligne par ligne,
  contre les bornes de la configuration : un bundle ne peut pas déplacer sa
  propre coupure pour légitimer les lignes qu'il transporte.
- Recalculer confirme que le manifeste décrit fidèlement le fichier qu'il
  désigne, jamais que ce fichier va assez loin. Sans `series_reach_cutoff`,
  amputer la fin d'une série puis réajuster compteurs, bornes et SHA certifie un
  bundle auquel il manque des mois de fenêtre d'évaluation. La règle suppose que
  chaque paire cote encore à la coupure, ce qui est vrai de cet univers ; une
  paire délistée échouerait ici, et c'est délibéré — elle demanderait une raison
  terminale déclarée, pas une série silencieusement plus courte.
- `symbol` et `timeframe` font partie du preimage et le nom de fichier est
  vérifié contre eux. Sans cela, échanger deux symboles entre deux entrées du
  même timeframe passait tous les autres contrôles et faisait lire des bougies
  BTC comme de l'ETH.

Chacun de ces scénarios de forge est reproduit tel quel par un test, re-scellage
du manifeste compris.

Aucun accès réseau, aucune dépendance vivante vers `crypto-buddy`.

## Régénérer

```bash
node src/exposure-bundle.mjs build --config config/crypto-buddy-exposure-v1.json --bundle data/bundles/crypto-buddy-exposure-v1
```

Un préflight sur `data-api.binance.vision` précède tout téléchargement. S'il
échoue, le run s'arrête. Il n'y a ni proxy, ni VPN, ni source alternative, et
`api.binance.com` n'est ni testé ni utilisé : changer de source est un
arbitrage, pas un contournement pris en cours de route. Le verrou est appliqué
par `src/binance-source.mjs` et couvert par des tests.

## Trou connu, non comblé

Les quatre séries `4h` présentent un trou unique et identique : la bougie
ouvrant le `2020-02-19T12:00:00.000Z` est absente. Elle correspond à l'arrêt de
négociation Binance du 19 février 2020, entre 12:00Z et environ 17:00Z. En `1h`
la même interruption efface les heures 12:00 à 16:00 ; en `4h` elle n'efface que
la bougie de 12:00, celle de 16:00 existant grâce à la reprise à 17:00. La
bougie `1d` du 19 février existe, avec un volume amputé cohérent avec cinq
heures d'arrêt.

Ce trou est antérieur à `evaluation_start`, il ne touche donc que l'amorce des
indicateurs. Il est documenté et **non comblé** : le bundle publie les faits, il
ne les lisse pas.

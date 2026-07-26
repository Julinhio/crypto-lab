# Mandat Bot B — le chasseur

Spec de **comportement**, pas d'implémentation.

Version 2, 26/07/2026. Synchronisée après deux rounds de council Claude + GPT. La doctrine du scanner fait l'objet d'un document séparé et **n'est pas encore validée**.

**Convention** : tout chiffre est écrit avec son assiette. `% capital` = pourcentage de la NAV du bot. `% actif` = pourcentage du prix de l'instrument. Les deux confusions les plus coûteuses des deux premiers rounds venaient de l'absence de cette convention.

---

## Contexte

Le bot A tourne depuis le 08/06 sur testnet Binance, passé en Stratégie V2 le 25/07 après un diagnostic sans appel : 785 décisions `hold` sur 787, 99,5% d'ordres rejetés sous le minimum, +1,88% strictement équivalent à un buy-and-hold.

Le bot B est son opposé : chasseur de profit, concentré, avec une cible chiffrée.

**L'objectif est d'apprendre, pas de gagner.** Sur quelques semaines et 1000 dollars, c'est la direction du marché qui décidera du résultat, pas la finesse du mandat. On cherche à éliminer les comportements cassés et à observer des différences de conduite.

---

## 1. Le principe fondateur : pas d'objectif calendaire à rattraper

Le point de départ était « +1% par jour ». **Retiré du mandat.** Une cible quotidienne crée une pathologie précise : il est 18h, le bot est en retard, il devient plus agressif pour rattraper. C'est un bot qui mise plus fort quand il perd.

**Le 1% appartient au trade, pas au jour.** Pas de minuit, pas de compteur, pas de retard possible. Le rythme quotidien devient une **mesure**, pas une consigne.

Le bot utilise bien des horloges, pour les expirations, les pauses et les réveils. Ce qu'on refuse, c'est la pression du retard.

**Test à appliquer à toute règle future** : une règle qui ne peut que **réduire** l'activité est sans danger. Une règle qui peut l'**augmenter** quand le bot est en retard est dangereuse.

---

## 2. Tout est exprimé en net, et en multiples de R

**Les objectifs et le risque sont NETS**, après frais, spread et glissement. Un risque maximal annoncé qui ne l'est pas vaut moins qu'un risque plus élevé mais honnête.

**`1R = 0,5% du capital, net.`** C'est l'unité de compte de tout le mandat.

Notations : `d` = distance au stop technique, en % actif. `k` = coût aller-retour, en % de la position, environ 0,2%.

| Grandeur | Formule | Assiette |
|---|---|---|
| Taille de position | `1R / (d + k)` | % capital |
| Mouvement requis pour 2R net | `2d + 3k` | % actif |
| Risque par position | `1R = 0,5%` | % capital, net |
| Risque ouvert cumulé | `2R = 1%` | % capital, net |

Le moteur calcule l'exact depuis les cashflows, les frais d'entrée et de sortie ne portant pas sur des notionnels identiques.

Illustration, avec `k = 0,2% actif` :

| Stop `d` | Taille | Mouvement requis |
|---|---:|---:|
| 1% actif | 41,7% capital | +2,6% actif |
| 2% actif | 22,7% capital | +4,6% actif |
| 4% actif | 11,9% capital | +8,6% actif |

**Note importante sur les frais** : ils portent sur la valeur de la position, jamais sur le capital total. Une position à 22,7% du capital coûte 0,045% de capital en aller-retour, pas 0,2%.

---

## 3. La taille se déduit, elle ne se choisit pas

1. Le bot identifie où le stop **technique** doit se placer (structure, support, plus bas récent).
2. Le risque est fixe : **1R net**.
3. La taille suit : `1R / (d + k)`.

Conséquences directes :

- **Le stop proposé par le modèle DOIT être validé par le code** contre la structure et une mesure de volatilité. Sinon le modèle contrôle indirectement la taille : un stop artificiellement serré lui donne une grosse position, un stop très large lui évite de s'engager.
- **Le liquide n'est jamais vide.** Avec un stop à 2% actif, la position mobilise 22,7% du capital, donc 77% restent en cash. La formulation « le cash est un état de passage » du round 1 était fausse et disparaît.
- **Plus de plancher de liquide obligatoire.** La protection est active (stop, trailing, coupe-circuit), plus passive.

**Le code refuse un plan quand** : le stop est trop proche du bruit normal ou du spread, le stop est trop large et produit une position dérisoire, la cible requise est implausible sur 24h, le prix a déjà traversé le stop au déclenchement, ou le glissement ferait dépasser 1R.

**Bornes de portefeuille** : deux positions ouvertes maximum, 1R par position, 2R de risque ouvert cumulé, **spot long-only**, sans levier ni vente à découvert.

---

## 4. Les sorties

**Trois sorties, et l'IA n'en fait pas partie.**

1. **Armement de la cible à +2R net**, puis trailing.
2. **Stop technique touché.**
3. **Péremption à 24h**, uniquement **avant** armement.

**Le trailing suit la distance technique initiale `d`, pas un pourcentage fixe.** À l'armement le stop monte à environ `+1R`, puis il suit à `d` sous le plus haut atteint et ne redescend jamais.

Un trailing fixe de 0,5% actif aurait été quatre fois plus serré que le stop initial sur une position à 25%, et aurait tué la queue de distribution sur les actifs nerveux — c'est-à-dire précisément ce qui fait vivre la stratégie. Le trailing en multiples de `d` s'échelonne tout seul avec la volatilité et donne un curseur réellement unique.

**Formulation prudente exigée** : à l'armement, le trailing verrouille **de l'ordre de +1R en conditions normales de remplissage**. Jamais une garantie : un gap peut donner moins.

**La péremption ne s'applique pas après armement**, sinon elle couperait les positions gagnantes en pleine course.

**Vocabulaire** : une position périmée sort à son P&L courant, elle ne « rapporte rien ». Un piège non déclenché rapporte exactement zéro.

**Après l'entrée, la position est déterministe.** Le stop technique porte toute l'invalidation. L'IA ne réécrit pas l'histoire toutes les deux heures : on mesure la qualité du plan qu'elle a posé.

**Seule exception** : une réévaluation exceptionnelle déclenchée par un événement de régime, qui ne peut que **réduire** le risque — annuler un piège non déclenché, resserrer un stop, sortir. Jamais desserrer, jamais augmenter.

---

## 5. Cycle de vie du piège

La péremption de 24h concerne une position ouverte. Il faut la péremption **du plan** qui attend son déclencheur.

Chaque piège porte : heure de création, déclencheur d'entrée, stop technique, date d'expiration, conditions d'annulation, et le snapshot de marché qui l'a justifié.

**Au déclenchement, le code recalcule la taille** avec le capital et le prix réellement observés. Il annule si le stop est déjà dépassé, si le risque ne tient plus, ou si le plan est trop ancien.

**Collision intrabougie** : si entrée, cible et stop sont touchés dans la même bougie d'une minute, l'ordre réel est inobservable. **Résolution conservatrice obligatoire : on prend l'issue la moins favorable.**

---

## 6. Cadences

**Le code surveille, l'IA arme des pièges.**

- **Code** : toutes les minutes, sur les hauts et bas des bougies avec résolution conservatrice. Ou WebSocket pendant les positions ouvertes. « Toutes les minutes » n'est pas du continu, et il faut le traiter comme tel.
- **IA, cadencée par les emplacements libres** : un emplacement libre → scan et réflexion toutes les 30 minutes. Tous les emplacements occupés → **aucune réflexion**, la position est déterministe.

Cette inversion par rapport au bot A est ce qui rend le trailing possible.

---

## 7. Coupe-circuits

Trois niveaux, tous conformes au test du point 1 : ils ne peuvent que réduire l'activité.

1. **Trois stops consécutifs** → pause. Contournable par une péremption perdante intercalée, d'où le niveau suivant.
2. **P&L net des cinq derniers trades fermés** sous un seuil → pause.
3. **Drawdown de 10% sur la NAV du bot B depuis son plus haut** → **arrêt manuel obligatoire**, aucune reprise automatique.

Justification du 10% : environ 20R perdus malgré toutes les protections. L'atteindre suppose soit une stratégie durablement sans avantage, soit des gaps répétés, soit une plomberie cassée. Les trois justifient un regard humain. Ce n'est **pas** comparable au -9,97% du bot A, qui était du bêta de marché sur un portefeuille sans stop.

**Reprise après pause** : six heures minimum, tous les pièges en attente annulés, puis nouveau scan complet. Jamais de reprise sur un ancien plan.

---

## 8. Univers

**Une quinzaine de paires, gelées au lancement de l'expérience.** Les modifier après avoir vu les résultats introduirait un biais.

**Portes d'éligibilité déterministes** : paires spot en USDT, liquidité minimale, spread maximal, ancienneté minimale depuis le listing, exclusion des tokens à levier et des stablecoins, taille minimale compatible avec les filtres de marché, mouvement attendu suffisant par rapport aux coûts.

**Pas de garde-fou contre la volatilité** : c'est ce que le bot cherche. Le garde-fou porte sur les **déchets** — un actif qui bouge beaucoup avec un spread large et des mèches erratiques n'est pas une bonne opportunité.

Les quatre paires du bot A (BTC, ETH, BNB, XRP) restent dans l'univers pour garder un terrain commun.

---

## 9. Infrastructure

**Flux de prix : `publicMainnetClient`, le même que le bot A.** Vérifié dans le dépôt — `src/exchanges/binance.ts` sépare déjà `publicMainnetClient()` pour les prix et `testnetAccountClient()` pour le compte et les ordres, et `build.ts` journalise `marketData: binance-public-mainnet`. Le bot A décide donc déjà sur des données de production. Point de comparabilité fermé sans modifier le bot A.

**Pas de plateforme d'échange pour le bot B.** Un compte GitHub ne donne accès qu'à un seul portefeuille testnet, partagé par toutes ses clés. Et le testnet est remis à zéro périodiquement sans préavis. Surtout, un simulateur garantit que tous les bots de laboratoire voient les mêmes prix à la même seconde, donc que **seule la stratégie diffère**.

**Le bot A garde le testnet** et son rôle : valider la vraie plomberie. Un bot de laboratoire prometteur devra repasser par cette case avant tout argent réel, le simulateur ne reproduisant ni les remplissages partiels ni le glissement.

**Le simulateur est à construire.** Le harness de replay du bot A fait le sizing et les rejets, mais pas le cycle de vie d'un plan, ni le moteur de remplissage, ni le trailing, ni la collision intrabougie, ni les frais complets. C'est une brique, pas la moitié du travail.

**Tables `lab_*` séparées, dans le même projet Supabase** : `lab_bots`, `lab_plans`, `lab_positions`, `lab_fills`, `lab_equity_snapshots`, `lab_runs`. Plus une vue de comparaison qui réunit les séries normalisées du bot A et du laboratoire.

**Pourquoi pas un `bot_id` sur les tables du bot A** : `bot_state` est un singleton, `position_state` est clé par actif, et les fonctions SQL, contraintes d'idempotence et verrous supposent une boucle unique. Ajouter une colonne ne suffirait pas, il faudrait transformer le moteur d'un bot vivant en système multi-tenant. La vue de comparaison donne la requête unique sans ce coût.

---

## 10. Évaluation

**Point zéro commun créé au lancement de B**, toutes les courbes normalisées à 100. Deux capitaux à 1000 dollars ne suffisent pas : le bot A a démarré en juin.

**Définir précisément le buy-and-hold de référence** : BTC seul, allocation du bot A au point zéro, ou panier égal des quinze. À trancher.

Métriques minimales : rendement brut et net, frais et spread et glissement simulé, drawdown, taux de réussite, gain moyen en R, excursion favorable et défavorable maximale, temps passé en position, exposition moyenne, **rendement du capital effectivement engagé**, rendement conditionnel pendant les périodes exposées, sensibilité approximative au marché, nombre de pièges annulés ou périmés, déclenchements de coupe-circuit.

**Le découpage exposition / sélection est obligatoire.** Le bot B étant long-only, il passera les baisses en liquide pendant que le bot A les traversera en portefeuille. Il paraîtra donc excellent dans un marché baissier. C'est une source de performance légitime, mais elle ne prouve rien sur la qualité de ses entrées. « B gagne parce qu'il sait rester liquide » et « B choisit de bonnes entrées » doivent rester deux conclusions distinctes.

---

## 11. Deux écrans

Le HUD actuel reste la **console d'exploitation** du bot sur testnet : est-il vivant, qu'a-t-il décidé, où en est le capital.

À côté, un écran **laboratoire** : courbes normalisées superposées plus le buy-and-hold, mouvements réels par bot, différences de conduite. Des onglets ne conviendraient pas — dans une expérience, la question n'est jamais « comment va le bot B » mais « lequel fait quoi ».

---

## 12. Ouvert, à trancher avant le brief

**La doctrine du scanner**, document séparé. Ce n'est pas de la plomberie déléguable au dev : le scanner **est** le mandat. Deux points structurants déjà identifiés :

- **Le multiplicateur d'ATR du plancher de bruit est LE paramètre du bot.** Le score de classement `mouvement plausible 24h / (2d + 3k)` a un numérateur indépendant de `d` et un dénominateur croissant en `d` : il pousse donc mécaniquement vers les stops les plus serrés autorisés. Le bot vivra collé contre ce plancher. Le multiplicateur doit être en tête du document et validé sur données, pas enfoui dans les gates.
- **Le scanner ne contient aucune notion de direction.** Il mesure une faisabilité, pas un avantage. La volatilité est symétrique. C'est peut-être la bonne répartition des rôles — le code filtre le faisable, le modèle apporte le directionnel — mais il faut alors écrire que **la totalité de l'avantage vient du modèle**, faute de quoi on lira mal les résultats : un bot à l'équilibre voudra dire « le modèle n'a pas d'avantage directionnel », pas « le scanner est mauvais ».

**Mesure préalable à faire sur les 48 jours de données existantes** : combien de couples actif-instant présentent un corridor non vide entre le plancher de bruit et la plausibilité de la cible sur 24h. Si la réponse est « quelques-uns par jour », le concept tient. Si c'est « trois par semaine », le bot ne trouvera rien et on le saura avant l'expérience, pas après.

Restent aussi : le seuil de P&L net sur cinq trades, la liste précise des quinze paires, la définition du buy-and-hold de référence, et le niveau de réalisme du simulateur sur le glissement et les remplissages partiels.

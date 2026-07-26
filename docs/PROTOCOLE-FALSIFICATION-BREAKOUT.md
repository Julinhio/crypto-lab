# Protocole de falsification historique — breakout `2R`

Document de préenregistrement. Consolidé par Claude après onze rounds de council avec GPT, le 26/07/2026.

**À signer par Claude, GPT et Julien. Aucune archive n'est ouverte avant signature.**

---

## 0. Pourquoi ce document existe

Tout ce que nous croyons savoir sur cette stratégie vient d'**un seul échantillon** : une année, quinze actifs encore listés aujourd'hui, un seul régime de marché. Sur cet échantillon nous avons pris au moins sept décisions successives — objectif à `2R`, exclusion du pullback, TTL à 24h, plancher à `1,5 ATR`, sortie sèche plutôt que trailing, deux emplacements, classement par plausibilité.

Chacune est défendable. Ensemble, elles peuvent n'être que la mémoire de cet échantillon.

Le jeu de données de conception est **consommé**. Il ne peut plus rien valider. Ce protocole organise un test unique sur des données que nous n'avons jamais regardées, avec le verdict écrit à l'avance.

**Si le test échoue, il n'y a pas de laboratoire à construire.** C'est le test le moins cher et le plus décisif du projet.

---

## 1. La règle du jeu unique

- Le moteur est **gelé** avant toute ouverture d'archive.
- **Une seule exécution.** Aucun résultat ne peut servir à modifier le baseline puis relancer.
- Aucun seuil, aucun filtre, aucune variable n'est ajouté après lecture.
- Toute la période déjà observée (l'année de conception) est **exclue** du jeu de falsification.
- Les deux hypothèses du point 6 sont testées **en parallèle** et ne modifient jamais les ordres du baseline.

---

## 2. Le moteur gelé

**Famille unique : breakout pré-cassure.** Le pullback est exclu de la production, conservé comme témoin sans exécution.

| Élément | Valeur gelée |
|---|---|
| Déclencheur | piège posé au niveau de cassure, armé quand le prix est sous le plus haut des 20 dernières heures et à moins de `0,5 × ATR1h` du déclencheur |
| Structure requise | tendance haussière |
| Stop | dernier pivot bas 1h confirmé dans les 24h, tampon `0,25 × ATR1h` |
| Plancher de bruit | distance au stop ≥ `1,5 × ATR14(1h)` |
| Objectif | `+2R` net, **sortie totale**, pas de trailing |
| Stop de sortie | `−1R` net |
| Péremption de position | 24h, avant objectif uniquement |
| TTL du piège | 24h |
| Emplacements | 2 maximum, une position par actif |
| Risque | `1R = 0,5% du capital`, plafond ouvert `2R` |
| Direction | spot long-only, sans levier |
| Classement | marge de plausibilité, **baseline sans avantage revendiqué** |
| Collision intrabougie | résolution pessimiste, issue la moins favorable |

**Le trailing a été réfuté** par le contrôle de cohérence : sortie sèche à `+0,354R/trade` contre `+0,229R` avec trailing sur le breakout, la MFE moyenne plafonnant à `2,50R` sans queue au-delà de `4R`.

Le mouvement requis pour atteindre l'objectif vaut `2d + 3k`, et la taille vaut `1R / (d + k)`. Comme `k` dépend de la taille via le glissement, le moteur résout le couple par itération jusqu'à convergence, de façon déterministe.

---

## 3. Univers point-in-time

**Le biais de survivant est l'objet principal du test.** Tester la liste d'aujourd'hui sur le passé sélectionne mécaniquement des gagnants.

- Une paire USDT devient admissible après une période de warm-up, sur des informations **disponibles à cette date** : ancienneté, volume passé, statut observable. Aucune liste actuelle rétroprojetée.
- **Les paires mortes restent dans l'univers jusqu'à leur dernière bougie tradable.** Une position encore ouverte est liquidée au dernier prix disponible avec un coût stressé. Leur disparition future n'est jamais connue à l'avance par le scanner.
- Stablecoins, fiat, tokens à levier, migrations et renommages sont traités par une **liste versionnée**, jamais en retirant après coup un actif qui a mal fini.

---

## 4. Modèle de coûts par paire et par époque

**Sans ce point, le test s'inverse.** Un coût uniforme à `0,3%`, calibré sur quinze majors liquides, appliqué à des altcoins fines de 2021, ferait participer ces paires à taux plein alors que leur spread réel et leur glissement auraient fermé le corridor. Corriger le biais de survivant tout en gardant des coûts optimistes **fabriquerait** un avantage au lieu d'en tester un.

`k(paire, date, taille) = frais aller-retour + spread estimé + glissement stressé`

- Tout est calculé sur des données **antérieures à l'armement**. Jamais sur la bougie d'entrée.
- Spread estimé depuis les transactions passées, glissement fonction du notional prévu relativement au volume historique.
- **Plancher à `0,3%`** même si l'estimateur donne moins.
- Un actif dont les données ne permettent pas d'estimer honnêtement le coût est **inéligible**.
- Scénario de stress séparé, avec coût multiplié. Interdit de choisir ensuite le scénario qui arrange.

### Publication obligatoire de l'exclusion pour données insuffisantes

La clause d'inéligibilité peut **restaurer en silence le biais qu'on veut supprimer** : les paires aux données les plus pauvres sont précisément les vieilles altcoins peu liquides que l'on ajoute pour tuer le biais.

Le rapport doit donc publier, **ventilé par époque** : nombre de paires et de candidats écartés pour insuffisance de données, et part qu'ils représentent dans l'univers admissible de la période. Si une fraction majeure d'une époque disparaît pour cette raison, le verdict doit le dire : le test n'est alors pas sans biais, il est biaisé autrement.

---

## 5. Régime et témoins

**Le régime sert à l'évaluation, jamais de gate.** Un éventuel filtre BTC deviendra plus tard un challenger séparé et ne pourra pas être ajouté au baseline après lecture.

- `risk_on` : dernière clôture journalière BTC **complètement terminée** au-dessus de sa SMA200 journalière.
- `risk_off` : clôture précédente sous ou égale.
- La journée en cours n'est jamais utilisée.

**On n'exige pas un P&L positif dans les deux régimes.** Un breakout long-only peut légitimement être conditionnel aux marchés haussiers. La vraie question est :

> Le breakout apporte-t-il quelque chose **au-delà de l'exposition longue** qu'il prend dans chaque régime ?

Par régime : candidats, trades exécutés, R/trade, R total, exposition en heures, drawdown, comparaison à des entrées longues aléatoires de mêmes fréquence, durée et risque, et comparaison au buy-and-hold pendant les seules périodes d'exposition.

S'il gagne uniquement en `risk_on` mais bat son témoin d'exposition, il a un avantage conditionnel. S'il reproduit le bêta du marché, il n'en a pas.

---

## 6. Deux hypothèses préenregistrées, testées en parallèle

Elles ne modifient pas les ordres du baseline. Elles sont testées en continu, sans nouveau seuil.

**H1 — géométrie du stop.** Antérieure aux données : au round 3, le score `mouvement plausible / (2d + 3k)` a été identifié comme poussant mécaniquement vers les stops les plus serrés autorisés, d'où l'alerte sur le rôle central du multiplicateur.

> L'issue nette s'améliore lorsque `stop structurel / ATR14(1h)` s'éloigne du plancher de `1,5`.

Relation continue. On ne teste ni `2 ATR`, ni un tiers inférieur, ni un nouveau gate.

**H2 — l'échelle annulée par le ratio.** La marge de plausibilité vaut `mouvement plausible / (2d + 3k)`, où `d` est lui-même adossé à l'ATR. La volatilité apparaît donc au numérateur et au dénominateur et se simplifie largement, ce qui expliquerait qu'elle n'ajoute que `+0,50R` au hasard.

> Un classement **décroissant** par `ATR14(1h) / prix à l'armement` produit davantage de R exécutable sous deux emplacements qu'un classement par marge de plausibilité.

**Le signe est commis, et voici sa raison** : volume élevé et stop/ATR élevé pointent tous deux vers l'expansion, et une cassure a besoin de suite pour parcourir `2d + 3k` en 24 heures. Si l'ordre croissant l'emportait, H2 serait fausse dans une direction inattendue, et ce serait à consigner comme tel plutôt qu'à réinterpréter.

**Ni H1 ni H2 ne peut être promue dans le baseline sur la base de ce test.** Elles deviennent au mieux des challengers du laboratoire.

---

## 7. Séparation stricte des caractéristiques et des issues

Deux enregistrements, et **deux droits d'accès distincts**. Mettre les features et l'issue dans le même objet est la façon la plus courante de fabriquer une fuite : une politique, un prompt ou une requête finit par voir la colonne d'à côté.

**`candidate_snapshot`** — écrit à l'armement. Uniquement les caractéristiques disponibles à cet instant, avec horodatage de disponibilité par feature. Immuable. Lisible par les politiques runtime.

**`candidate_outcome`** — écrit après résolution. P&L, chemin, stop/objectif/péremption, MFE/MAE. Lié par `candidate_id`. **Techniquement illisible depuis le runtime.**

La jointure appartient à un troisième rôle, réservé à l'évaluation offline.

---

## 8. Seuils d'échantillon

Conditions conjointes, comptées en **trades réellement exécutables** par le portefeuille à deux emplacements, pas en candidats bruts :

- au moins **200 trades exécutables** ;
- au moins **quatre années calendaires** couvertes ;
- au moins **50 trades en `risk_on`** ;
- au moins **50 trades en `risk_off`**, répartis sur au moins **trois épisodes distincts**.

Le dernier point est nécessaire parce que BTC est resté au-dessus de sa moyenne longue pendant de très longues périodes : cinquante trades `risk_off` concentrés dans un seul marché baissier ne sont pas cinquante observations indépendantes.

Les incertitudes sont calculées par **bootstrap temporel par blocs**, regroupées par semaine ou par épisode de marché, jamais comme si chaque crypto était indépendante.

---

## 9. Verdicts, écrits avant l'exécution

### Le verdict sur l'avantage est séparé du verdict sur le dimensionnement

Un drawdown de 12% à `0,5% du capital/R` ne dit rien sur l'existence de l'avantage : il dit que R est trop grand. Le même avantage à `0,4%/R` tiendrait le plafond. Mélanger les deux jetterait un avantage réel pour une raison de paramètre.

**PASS sur l'avantage**, toutes conditions réunies :

- seuils d'échantillon du point 8 atteints ;
- R exécutable total positif ;
- borne basse à 95% du bootstrap par blocs **strictement supérieure à zéro** ;
- résultat positif après retrait du meilleur actif ;
- résultat positif après retrait de la meilleure année ;
- avantage positif contre le témoin d'exposition ;
- avantage total non annulé par le comportement hors `risk_on` ;
- résultat non inversé par le scénario de coût central.

**FAIL sur l'avantage**, l'un des cas suivants :

- R exécutable total inférieur ou égal à zéro ;
- résultat entièrement expliqué par le meilleur actif ou la meilleure année ;
- aucun avantage par rapport au témoin d'exposition ;
- positif uniquement sous coûts optimistes, négatif sous le coût historique central.

**INDÉTERMINÉ** :

- moins de 200 trades exécutables ;
- couverture insuffisante d'un régime ou d'un nombre d'épisodes ;
- moyenne positive mais intervalle du bootstrap traversant zéro ;
- résultat sensible sans être détruit par un actif, une année ou le scénario de coût.

### Conclusion de dimensionnement, produite séparément

Le rapport indique la valeur maximale de R telle que le 95e percentile du drawdown simulé du portefeuille reste **sous la moitié du coupe-circuit de 10%**, avec marge pour l'incertitude d'estimation.

Si cette valeur descend sous un plancher opérationnel à définir avant l'exécution, le verdict devient FAIL **pour cause de dimensionnement**, motif nommé distinctement.

---

## 10. Suite de chaque verdict

**FAIL** → pas de laboratoire runtime. Retour à la recherche d'une autre famille.

**PASS** → construction du laboratoire vivant : baseline déterministe, challengers d'abstention, famille complémentaire de retour à la moyenne, LLM en shadow. Aucune promotion du LLM sans victoire prospective contre les témoins simples, coût compris.

**INDÉTERMINÉ** → passage direct en papier prospectif, baseline strictement gelée, aucun nouveau seuil, aucune promotion de H1 ni H2. Résultats intermédiaires visibles pour la sécurité seulement, sans décision stratégique.

Historique et prospectif s'agrègent, puisque la stratégie est figée avant les deux. **Le prochain checkpoint est déterminé par le nombre de trades manquants, pas par une date choisie après coup** : 160 trades historiques signifient exactement 40 trades papier avant le verdict suivant.

---

## 11. Reproductibilité

À produire **avant** toute donnée : spécification du moteur, règle point-in-time, modèle de coûts, définition du régime, témoins, critères de verdict, séparation snapshots/issues, seed de tous les contrôles aléatoires.

À produire **avec** les données : `as_of` immuable, exclusion de la bougie en cours, univers exact enregistré, périodes disponibles par actif, manifeste et checksums des fichiers, UTC partout, gestion du changement d'unité de timestamp des données spot à partir de 2025.

**Deux exécutions doivent être identiques au bit près.** Entre deux replays précédents, le pullback est passé de 504 à 503 observations parce que le cutoff glissait avec l'heure courante : c'est la raison concrète de cette exigence.

---

## 12. Interdits explicites

- Ouvrir les archives avant signature des trois parties.
- Modifier un paramètre du moteur après lecture d'un résultat.
- Promouvoir H1 ou H2 dans le baseline sur la base de ce test.
- Ajouter le filtre de régime au baseline après lecture.
- Choisir le scénario de coût le plus favorable.
- Décider après coup qu'un nombre d'observations était « suffisant ».
- Relancer le test sur les mêmes données après un verdict, quel qu'il soit.

# Proposition — coûts par paire et par époque

Statut : **à signer avant le replay de falsification**. Ce document ne modifie
pas encore les résultats canoniques, qui restent la reproduction du council avec
`k = 0,3%` du notionnel aller-retour.

## Constat sur les données disponibles

L'archive Spot officielle Binance fournit les klines, les trades et les
`aggTrades`, mais pas d'historique Spot du carnet ou du `bookTicker`. Les bougies
horaires ne permettent pas d'estimer honnêtement le spread : leur amplitude
confond spread et volatilité. Un coût « mesuré » devra donc utiliser les trades
horodatés et leur indicateur `isBuyerMaker`, ou une source externe d'archives
top-of-book dont la provenance et le checksum seront publiés.

Références officielles :

- https://github.com/binance/binance-public-data
- https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md

## Principe fail closed

Chaque candidat doit recevoir, à son instant d'armement, un enregistrement de
coût identifié par `(symbole, début inclus, fin exclusive)`. Il n'existe aucun
fallback global dans le replay historique.

Trois issues sont possibles :

1. snapshot mesuré : le candidat est évalué avec ce coût ;
2. snapshot stressé explicitement : le candidat est évalué dans le scénario de
   stress séparé, jamais mélangé au scénario central ;
3. données insuffisantes : candidat inéligible, avec compteur publié par paire
   et par époque.

Les paires exclues pour données insuffisantes restent dans le dénominateur du
rapport de couverture afin que cette exclusion ne reconstitue pas silencieusement
un biais de survivant.

## Décomposition proposée

Pour une entrée et une sortie toutes deux traitées comme taker :

`k = frais_entrée + frais_sortie + demi_spread_entrée + demi_spread_sortie + impact_entrée + impact_sortie`

Tous les termes sont des fractions du notionnel de position. Une sortie target
reste traitée comme taker tant que l'implémentation de production ne garantit pas
un fill maker.

### Frais

Le scénario central utilise le barème standard valide à l'époque, sans remise
BNB, VIP ou promotion non démontrée pour le compte. Chaque époque porte sa source.

### Spread effectif

Ordre de préférence :

1. bid/ask historique observé ;
2. estimateur construit sur les trades Spot, par fenêtres courtes contenant des
   transactions initiées des deux côtés, en utilisant `isBuyerMaker` ;
3. données insuffisantes.

Le range d'une kline, même `1m`, n'est pas un estimateur admissible du spread.

### Impact et taille

Le coût doit être résolu avec la taille du trade, qui dépend elle-même de `k` :

`notionnel = capital × risque_par_R / (d + k)`

La résolution est itérative jusqu'à convergence. Un snapshot doit publier la
liquidité de référence, la méthode d'impact et le nombre d'itérations. Un candidat
qui ne converge pas ou dont la participation dépasse la borne préenregistrée est
inéligible et compté.

## Schéma minimal d'un snapshot

```json
{
  "symbol": "ALTUSDT",
  "validFromInclusive": "2021-05-01T00:00:00.000Z",
  "validToExclusive": "2021-06-01T00:00:00.000Z",
  "feeEntryFraction": 0.001,
  "feeExitFraction": 0.001,
  "effectiveSpreadRoundTripFraction": 0.004,
  "impactModel": "to-be-preregistered",
  "evidence": {
    "source": "binance-spot-trades",
    "sourceChecksum": "...",
    "observations": 12345,
    "coverageFraction": 0.92
  }
}
```

Les fenêtres ne doivent ni se chevaucher ni laisser un candidat utiliser le
snapshot d'une époque future.

## Sorties obligatoires

- candidats admis et écartés pour coût ;
- paires et candidats sans données suffisantes, par année ;
- distribution de `k` par paire et par année ;
- différence de population entre `k=0,3%`, modèle central et stress ;
- nombre d'échecs de convergence ou de participation ;
- R brut, R exécutable et borne bootstrap pour chaque scénario.

## Décisions encore à préenregistrer

1. estimateur exact du spread à partir des trades si aucun top-of-book historique
   n'est acquis ;
2. modèle d'impact et borne maximale de participation ;
3. seuil minimal d'observations et de couverture par snapshot ;
4. multiplicateur du scénario stressé ;
5. barème historique des frais et traitement des promotions.

Tant que ces cinq points ne sont pas signés, le runner historique doit refuser de
produire un verdict PASS/FAIL.


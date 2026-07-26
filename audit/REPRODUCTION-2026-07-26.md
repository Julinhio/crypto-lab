# Audit de reproduction — 26 juillet 2026

## Protocole

Deux téléchargements indépendants ont été réalisés depuis l'API publique
Binance. Chaque téléchargement partait d'un dossier absent. Les deux replays ont
ensuite été exécutés séparément avec la configuration
`f8be1dfa8f5997a2c9fd27e32944e526d3917acbaf13c8cd38e2267dd65c7a47`.

- manifeste de données A :
  `b3b9b6c13c0e683737f588f40e78a27fd6c3b32472c5bee98925669f871816ae`
- manifeste de données B : même SHA-256
- manifeste de résultats A :
  `d13da22932eb6f3c8d0b017fd758cf1bea34368a49c92bf3e7b5f0aa2bd6967d`
- manifeste de résultats B : même SHA-256
- fichiers de résultats différents : `0`

Verdict : les deux runs propres sont identiques bit à bit.

Ce second audit a été exécuté après la revue du moteur : séparation
`pair-death`/`replay-cutoff`, retrait du `forwardMfe` des objets bougie,
correction du garde de réarmement et explicitation de la référence ATR. Ces
corrections ne modifient aucun des chiffres canoniques sur les quinze paires
actives. Les compteurs publiés valent ici `0` censure technique et `0` paire
morte, ce qui est cohérent avec cette population ; les deux branches sont
couvertes par les tests unitaires.

## Chiffres qui se reproduisent à l'identique

- pullback, armement `2R` : `503` observations, EV `-0,114887R`, sortie
  moyenne des trades armés `+1,649852R`, MFE armée `2,503046R` ;
- balayage breakout : à `1R`, `-26,694864R` exécutables ; à `1,25R`,
  `-24,110895R` ; à `1,5R`, `-7,626742R` ; à `1,75R`, `+0,754989R` ;
  à `2R`, `+6,858607R` ;
- breakout `2R` : `44` candidats bruts, `30` exécutables, `14` écartés par
  capacité, `+16,756312R` brut et `+6,858607R` exécutable ;
- sélection aléatoire : moyenne `+6,357086R`, probabilité de battre le
  classement `37,14%` ;
- emplacements : `2` donnent `+6,858607R`; `3` donnent `+9,234680R` brut,
  soit `+6,156453R` à budget de risque constant ; `4` donnent le même brut,
  soit `+4,617340R` à budget constant ;
- oracle sous deux emplacements : `+24,578307R` ; somme brute des seules issues
  positives : `+35,558127R` ;
- les tertiles et corrélations discutés au council, notamment volume,
  stop/ATR et marge de plausibilité, sont identiques ;
- les deux téléchargements contiennent chacun `137 880` bougies au total.

## Chiffres qui ne se reproduisent pas au libellé historique

### Le `504` du pullback

Il ne se reproduit pas. Avec la borne fixe, le résultat est `503` dans les deux
runs. Le `504` provenait du premier script, dont le cutoff était calculé avec
`Date.now()`. Le passage ultérieur à `503` était donc bien une dérive de fenêtre,
pas une variation du moteur.

### Le corridor des « 48 jours »

Les chiffres arrondis du council étaient environ `5,34%` d'heures-actifs
éligibles, `0,80` actif par heure, `39%` des heures avec au moins un candidat et
`11` nouveaux corridors par jour. Avec la fenêtre désormais définie exactement
(`2026-06-08T15:00Z` à `2026-07-26T15:00Z`, borne finale exclusive), on obtient :

- `5,4167%` d'heures-actifs éligibles ;
- `0,8125` actif éligible par heure ;
- `39,4965%` des heures avec au moins un candidat ;
- `11,125` nouveaux corridors par jour ;
- témoin 24h : `11,3229%` cible, `64,2377%` stop, `24,4395%` péremption.

La conclusion qualitative se reproduit, mais pas les anciens arrondis à
l'identique. La cause est traçable : l'ancien début et la dernière bougie
glissaient avec l'heure d'exécution. Ces anciens chiffres ne doivent plus servir
de référence canonique.

## Conclusion

Le cœur des conclusions breakout, portefeuille, hasard, oracle et
caractéristiques est stable. Les deux seules divergences retrouvées concernent
précisément les fenêtres temporelles qui n'étaient pas figées : `504 → 503` et
les légers écarts du corridor 48 jours.

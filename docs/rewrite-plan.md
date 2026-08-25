# Plan de réécriture de `ai-decision.js` (base : arbre v3)

Contexte : `ai-decision.js` v2 a accumulé trop de rustines ponctuelles
(continuation de mouvement à l'entrée, timing du tir selon la branche,
valeurs de danger de bordure...) au fil des corrections. Mayrik a
redessiné l'arbre de décision complet à zéro (v3, audité en détail,
jugé cohérent — voir `docs/Automa ThundeRoadVendetta - arbre de
décision pour chaque tour de jeu.pdf`, document consolidé qui
remplace les deux anciens PDF séparés dés/trajectoire). Plutôt que de
continuer à patcher, on repart d'un fichier neuf, en suivant l'arbre
v3 branche par branche.

Ce fichier est le suivi de cette réécriture. Une nouvelle conversation
peut reprendre directement ici sans tout réexpliquer : cocher les
étapes terminées, noter l'état courant en bas.

## Principe d'ordre

On construit dans l'ordre des **dépendances de l'arbre**, pas dans
l'ordre où les bugs ont été rencontrés. La trajectoire est utilisée
par toutes les branches → elle vient en premier. Le tir est devenu
une étape générique post-mouvement identique partout → il sort de
`ai-decision.js` et devient un point unique côté orchestrateur. Les
branches du tour viennent ensuite, de la plus isolée à la plus
dépendante.

## Méthode par étape

Pour chaque branche : traduire chaque question de l'arbre v3 en test
unitaire concret (plateau/voitures contrôlés, résultat attendu)
*avant* d'écrire le code — l'arbre étant audité, on code pour
satisfaire les tests plutôt que d'auditer après coup. Une fois la
branche testée isolément : revalidation par self-play à grande
échelle (comme pour la trajectoire lors de sa réécriture), puis
passage à l'étape suivante. Ne jamais deviner une valeur ou un
comportement — toujours vérifier avec le moteur/les tests. Corriger
et documenter clairement toute erreur trouvée, y compris les
siennes.

## Étapes

- [x] **0. Correction `dangerValueOfCell`** — différencier bord avant
      (=0) de bord gauche/droite/arrière (=9), au lieu de la valeur
      unique actuelle. Petit, isolé, testable seul. La fonction vit en
      réalité dans `ai-decision.js` (pas `engine.js` comme indiqué
      ici à l'origine — `engine.js` n'a pas eu besoin d'être touché,
      il distinguait déjà avant/arrière/latéral via `getSpace()`).
      12 tests dédiés ajoutés (105/105 IA, 212/212 moteur).
- [x] **1. Trajectoire** — réécrite en une fonction UNIFIÉE,
      `chooseBestTrajectory` (remplace `chooseGeneralTrajectory` ET
      `chooseEntryTrajectory`, laissées en place mais plus utilisées).
      Pas un simple portage : l'audit de l'arbre v3 a révélé 3 écarts
      réels avec l'ancien code, corrigés avec Mayrik le 24/08/2026 —
      (a) le palier racine (route 100%) est désormais une pure
      présence, sans comparaison ("strictement plus proche par
      rapport aux autres...") — clause retirée du document source en
      cours de route ; (b) les paliers 2 à 6 (route-mixte → off-road →
      mud → tout-terrain-propre → hazard-propre) se comparent
      seulement au palier ADJACENT suivant, jamais à une comparaison
      globale (confirmé avec un exemple chiffré) — ancien code
      (`pickByTerrainPreference`) comparait à un cumul, donc
      incorrect ; (c) le bonus route est une cascade à 4 paliers en
      présence seule (route/off-road/mud + refus explicite), plus
      strict que l'ancien "extension si progression meilleure" ; (d)
      le Slam en arc arrière se recalcule désormais sur la
      destination FINALE (bonus ou non) — suppression de la limite
      "jamais si bonus utilisé" de l'ancien code — et seulement contre
      un adversaire STRICTEMENT plus petit (pas de cas d'égalité ici).
      24 tests dédiés ajoutés (105→129 tests IA), 212/212 moteur
      inchangés (fichier non touché).
      **Correctifs ultérieurs (trouvés en implémentant l'étape 3, cf.
      son entrée ci-dessous)** : (1) le Slam arc arrière inventait une
      destination inatteignable (vérifiait le plateau brut au lieu du
      pool de candidats réellement atteignables par un chemin avant —
      corrigé pour chercher dans ce pool, comme le faisait l'ancien
      code) ; (2) `entryRow` se perdait sur le chemin bonus route lors
      d'une entrée (pool d'extension jamais un pool d'entrée) — perte
      corrigée en le reportant explicitement depuis la destination de
      base.
- [x] **2. Tir sorti de `ai-decision.js`** — nouveau point d'entrée
      unique, `computeShotTargetForDecision(decision, allCars)`,
      appelé une fois par tour par l'orchestrateur (aujourd'hui
      `tools/run-shadow-legality.js`) et par `tools/
      generate-review-cases.js` (qui appelle `decideAssignAndCommand`
      directement, hors orchestrateur). Retiré des branches qui le
      calculaient chacune de leur côté (`decideNoFinishLine`,
      `decideFinishLineRush`, `chooseBestTrajectory`) — la Section 3B
      legacy (`chooseGeneralTrajectory`/`chooseEntryTrajectory`, plus
      utilisée depuis l'étape 1) n'a pas été touchée.
      **Bug réel trouvé en cours de route** : un tour Coast calculait
      bien une cible de tir côté décision, mais elle n'était JAMAIS
      transmise au moteur (`playTurnCoastWithProgression` ne
      recevait pas l'option `shootTarget`, contrairement au mouvement
      normal) — un tir valide était donc silencieusement perdu à
      chaque Coast. Vérifié concrètement par comparaison avant/après
      sur 200 parties : 121 tours Coast avec cible calculée → 0 tirs
      réellement exécutés AVANT correctif ; 123 → 119 APRÈS (l'écart
      restant est attendu, mêmes garde-fous que le mouvement normal
      — round 1 sans armes actives, etc.).
      4 tests dédiés ajoutés (129→133 tests IA), 212/212 moteur
      inchangés. Self-play 500 parties/31515 décisions : 0 crash, 0
      décision illégale ; 1 état incohérent, artefact préexistant
      déjà présent sur le dépôt AVANT cette étape (confirmé par
      comparaison directe, sans rapport avec le tir).
- [x] **3. Branche "Premier round"** — nouvelle fonction dédiée
      `decideFirstRound`, câblée en PREMIER dans `decideAssignAndCommand`
      (avant même le test `finishLineTile`).
      **Bug réel confirmé (celui pointé par le plan comme "source de
      bugs la plus concrète")** : le dispatcher ne testait jamais
      `roundState.roundNumber === 1` — le round 1 tombait donc dans
      `decideNoFinishLine`, le sous-arbre Command/Lot bien plus riche
      pensé pour les rounds SUIVANTS (évaluation Repair/Nitro/Drift/
      Airstrike selon la situation), jamais dans sa propre branche
      dédiée et bien plus simple.
      Séquence implémentée (validée avec Mayrik après mise à jour du
      document le 24/08/2026, qui a aussi résolu une ambiguïté du
      document — "la voiture la plus à l'arrière de l'équipe", sans
      sens pour des voitures toutes hors plateau — remplacée par "la
      plus GROSSE") : lots de dés équilibrés par somme (réutilise
      `partitionIntoBalancedLots`, Section 4) → lot à la plus forte
      somme pour le véhicule opérable non encore activé le plus gros
      → lot à 1 dé : entrée simple ; lot à 2 dés : Nitro avec le plus
      gros dé éligible (1-3) si au moins un l'est, sinon Airstrike
      avec le plus petit dé du lot (chopper devant l'adversaire
      opérable le plus avancé) — l'autre dé partant toujours au
      mouvement.
      **Deux correctifs à `chooseBestTrajectory` (étape 1) trouvés en
      cours de route** — voir le post-scriptum ajouté à l'entrée de
      l'étape 1 ci-dessus pour le détail complet.
      27 tests dédiés ajoutés au total (133→160 tests IA) : 8 pour le
      correctif Slam arc arrière de l'étape 1 (candidats réellement
      atteignables, séparation chemin base/bonus), 19 pour
      `decideFirstRound` lui-même (dont la régression `entryRow`).
      212/212 moteur inchangés. Self-play 800 parties/~49000
      décisions : 0 crash, 0 décision illégale ; taux d'état
      incohérent identique au dépôt AVANT cette étape (confirmé par
      comparaison directe, même artefact préexistant près de la ligne
      d'arrivée, sans rapport avec le round 1). Vérifié concrètement
      hors self-play global : 600/600 entrées réussies sur 100
      parties, ordre Large→Medium→Small systématiquement respecté,
      Nitro et Airstrike tous deux observés en conditions réelles.
- [x] **4. Branche "Commande déjà jouée" (pas de Finish Line)** —
      nouvelle fonction dédiée `chooseCommandAlreadyUsedRecipient`,
      câblée en tête de `decideNoFinishLine` (avant tout
      partitionnement en lots) dès que `commandUsedThisRound[playerName]`
      est vrai.
      **Écart confirmé en relisant le PDF en détail** : le code
      utilisait auparavant `chooseLotRecipient` (pensé pour la branche
      "lot pas encore attribué") pour CE cas aussi — donc appliquait à
      tort la nuance "adversaire à moins de 6 cases" et un
      partitionnement en lots (`partitionIntoBalancedLots`) alors que
      le document source ne les mentionne à aucun moment ici.
      Logique confirmée par lecture fine du schéma (arbre dédié,
      entièrement séparé du sous-arbre "lot") : "La voiture la plus à
      l'arrière de l'équipe [parmi les non-encore-activées] est-elle
      sur la tuile Rear ?" → OUI **ou** (NON + "Ce joueur IA a-t-il un
      véhicule en tête de la course ?" = OUI) → le plus gros dé
      DISPONIBLE DANS LE POOL ENTIER (jamais un lot) va à la voiture
      non-encore-activée la plus à l'arrière — les deux flèches vertes
      convergent bien vers la même case sur le document source, à
      vérifier avec attention car contre-intuitif au premier abord.
      → NON + NON → le plus gros dé va au véhicule jouable le plus en
      avant (seul cas qui bascule vers l'avant). Aucun Drift/Command à
      évaluer (déjà joués ce round, cohérent avec le code existant qui
      les court-circuitait déjà via `commandAlreadyUsed`).
      8 tests dédiés ajoutés (160→168 tests IA) : 3 unitaires sur
      `chooseCommandAlreadyUsedRecipient` (Rear=oui, pas-Rear+en-tête,
      pas-Rear+pas-en-tête) + 5 d'intégration sur `decideNoFinishLine`
      (dé = max du pool entier et non un lot, `command: null`,
      sélection Rear, sélection "pas en tête" vers l'avant). 212/212
      moteur inchangés.
      Self-play 800 parties/48090 décisions : 0 crash, 0 décision
      illégale ; 2 états incohérents, même artefact préexistant déjà
      documenté (Blast Off atterrissant sur la Finish Line, juste
      après une victoire) — confirmé par comparaison directe contre le
      code AVANT cette étape (baseline 500 parties/30272 décisions :
      3 états incohérents, même signature) : taux comparable, aucune
      régression attribuable à cette étape. Branche vérifiée
      effectivement empruntée en conditions réelles (comptage
      instrumenté temporaire, retiré après coup) : 922 activations sur
      5937 décisions (~15,5%) sur 100 parties dédiées — donc bien
      exercée par le self-play, pas un chemin mort.
- [ ] **5. Branche Lot + Command (pas de Finish Line)** — la plus
      grosse (Repair/Nitro/Drift/Airstrike), mais conceptuellement
      déjà correcte et confirmée par l'audit — portage rigoureux plus
      que redécouverte.
- [ ] **6. Branche Finish Line Rush** — dépend de la trajectoire
      (étape 1) et réutilise les concepts de Command de l'étape 5.
- [ ] **7. Validation globale** — self-play à grande échelle toutes
      branches confondues (`tools/generate-full-game.js` ou
      équivalent), revue qualitative au viewer si besoin.

## État courant

Étapes 0, 1, 2, 3 et 4 terminées (168/168 tests IA, 212/212 tests moteur).
Prochaine action : étape 5 (branche "Lot + Command", pas de Finish
Line).

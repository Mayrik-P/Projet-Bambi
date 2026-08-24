# Plan de réécriture de `ai-decision.js` (base : arbre v3)

Contexte : `ai-decision.js` v2 a accumulé trop de rustines ponctuelles
(continuation de mouvement à l'entrée, timing du tir selon la branche,
valeurs de danger de bordure...) au fil des corrections. Mayrik a
redessiné l'arbre de décision complet à zéro (v3, audité en détail,
jugé cohérent — voir `docs/Arbre de décision Répartition dés TRV.pdf`
et `docs/Arbre de décision trajectoires TRV.pdf`). Plutôt que de
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

- [ ] **0. Correction `dangerValueOfCell` (`engine.js`)** — différencier
      bord avant (=0) de bord gauche/droite/arrière (=9), au lieu de
      la valeur unique actuelle. Petit, isolé, testable seul.
- [ ] **1. Trajectoire** — portage quasi tel quel de la cascade
      existante (`chooseGeneralTrajectory`, déjà validée, le nouvel
      arbre n'y change que la table de danger via l'étape 0). Pas de
      réécriture conceptuelle ici.
- [ ] **2. Tir sorti de `ai-decision.js`** — "mouvement → cible de tir
      → tir" est désormais identique dans toutes les feuilles de
      l'arbre. Le déplacer dans l'orchestrateur (aujourd'hui
      `tools/run-shadow-legality.js`) comme étape générique
      post-mouvement (`chooseShootTarget(car.col, car.row, car.owner,
      allCars)` après tout mouvement réel), plutôt que porté par
      chaque branche de décision.
- [ ] **3. Branche "Premier round"** — autonome, ne recoupe aucune
      autre branche. Historiquement la source de bugs la plus
      concrète (entrée en jeu).
- [ ] **4. Branche "Commande déjà jouée" (pas de Finish Line)** —
      petite, isolée. Un seul écart connu à corriger : sélection du
      véhicule via une sous-logique dédiée (Rear ? → en tête ? →
      arrière/avant, SANS le partitionnement en lots ni la nuance
      "<6 cases").
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

Aucune étape commencée. Prochaine action : étape 0.

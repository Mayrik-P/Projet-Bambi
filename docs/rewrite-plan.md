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
- [x] **5. Branche Lot + Command (pas de Finish Line)** — CONTRAIREMENT
      à l'attente initiale ("conceptuellement déjà correcte, portage
      rigoureux plus que redécouverte"), la relecture détaillée du PDF
      a révélé que Drift seul était déjà fidèle à l'arbre ; Repair et
      Nitro avaient des écarts réels, et l'Airstrike de repli (quand
      Nitro n'est pas éligible) était ENTIÈREMENT ABSENTE du code.
      **Écart 1 — Repair** : l'ancien code cherchait un 6 dans les dés
      RESTANTS DU LOT COURANT (`dicePoolRemaining.includes(6)`),
      évalué après construction des lots. Le document réserve en fait
      le 6 au niveau du POOL ENTIER, AVANT tout partitionnement
      (`Il y a-t-il un véhicule inopérable dans l'équipe ET un 6
      disponible ?` → `Un dé 6 est sorti virtuellement du pôle de dés
      disponible`) : ce 6 n'entre PAS dans le partitionnement en lots,
      et alimente Repair indépendamment de la taille du lot du
      véhicule activé (contrairement à Nitro/Airstrike, qui ont
      besoin d'un deuxième dé DANS le lot). Nouvelles fonctions
      `reserveRepairSix` (check pool entier, avant les lots) et
      `decideRepairTarget` (cible : inopérable en tête de course,
      sinon le plus en arrière — logique de ciblage inchangée).
      **Écart 2 — Airstrike de repli, absente** : quand Nitro n'est
      pas éligible (véhicule ni sur Rear ni le plus en arrière, ou
      aucun dé 1-3 disponible), l'ancien code retournait simplement
      `null` (aucune Command). L'arbre prévoit en réalité toute une
      cascade : `Un adversaire est-il premier de la course ?` →
      `Un véhicule de CET adversaire est-il sur la tuile de Lead ?` →
      OUI : Airstrike IMMÉDIAT (le "dernier tour du round ?" n'est
      même pas regardé) ; NON → `Dernier tour du round ?` → OUI :
      Airstrike quand même (petit dé en Command, gros dé au
      mouvement) ; NON : **report** — le gros dé retourne
      (virtuellement) dans le pool, seul le petit dé sert au
      mouvement, aucune Command ce tour-ci. Nouvelle fonction
      `decideNitroOrAirstrikeForLot` (Nitro → Airstrike immédiat via
      Lead → Airstrike dernier tour → report), nouveaux helpers
      `isOnLeadTile` et `isLeadingOpponentOnLeadTile`.
      `decideCommandForActivatedCar` (ancienne fonction, signature
      basée sur `dicePoolRemaining`) est retirée, remplacée par ces
      briques plus fidèles à l'arbre — câblées dans
      `decideNoFinishLine` : réservation du 6 avant
      `partitionIntoBalancedLots`, puis après le pré-check Drift
      (inchangé) : Repair si réservé, sinon la cascade Nitro/Airstrike
      /report.
      16 tests dédiés ajoutés (168→184 tests IA) : `reserveRepairSix`
      et `decideRepairTarget` (7), `decideNitroOrAirstrikeForLot`
      seul — Nitro/Airstrike-Lead-immédiat/Airstrike-dernier-tour
      /report (4), intégration complète via `decideNoFinishLine` —
      Repair/Airstrike-dernier-tour/report (5). 212/212 moteur
      inchangés.
      Self-play 1000 parties/40670 décisions (800 sans
      instrumentation + 200 avec, comptage temporaire retiré après
      coup) : 0 crash, 0 décision illégale, **0 état incohérent** (pas
      même l'artefact Blast Off/Finish Line habituel sur cet
      échantillon). Les 4 sous-branches vérifiées effectivement
      empruntées en conditions réelles sur 200 parties dédiées
      (11779 décisions) : Repair 164, Nitro 2644, Airstrike 463,
      Report 2564 — aucune n'est un chemin mort.
- [x] **6. Branche Finish Line Rush** — `decideFinishLineRush` était en
      réalité du code v2 légataire (jamais réaudité contre l'arbre v3,
      malgré des commentaires affirmant le contraire à deux reprises —
      voir écarts 1 et 2 ci-dessous) : réécrite intégralement.
      **Écart 1 — Coast, voiture ciblée (⚠️ À CONFIRMER AVEC MAYRIK)** :
      l'ancien code sélectionnait la voiture opérable la plus EN AVANT
      (`frontmostEligibleCar`), avec un commentaire affirmant "Cas
      particulier formalisé avec Mayrik". Relecture à 600 dpi du
      document (fichier inchangé, hash MD5 identique vérifié avant et
      après l'étape 5) : le libellé de ce nœud Coast est MOT POUR MOT
      identique à celui de la branche "Finish Line pas en place" —
      "le véhicule opérable le plus en ARRIÈRE de l'équipe"
      (`rearmostEligibleCar`). Implémenté selon cette lecture directe,
      qui contredit un commentaire affirmant une confirmation
      antérieure de Mayrik — donc explicitement signalé pour
      vérification plutôt que résolu silencieusement.
      **Écart 2 — Coast, Slam sur l'arc avant, absent** : un second
      commentaire ("MISE À JOUR DE L'ARBRE... recherche la case la
      moins dangereuse") décrivait une heuristique de recherche de
      case la moins dangereuse, absente du document tel que relu.
      L'arbre prévoit en réalité un nœud "Un véhicule adverse opérable
      strictement plus petit est-il dans l'arc avant ?" -> Slam direct
      délibéré (sauf si cet adversaire est déjà à moins de 2 cases de
      la ligne d'arrivée, pour ne pas le pousser encore plus près).
      Ce même nœud existe aussi pour le Coast de "Finish Line pas en
      place" (jamais implémenté non plus jusqu'ici) — corrigé aux DEUX
      endroits avec un helper partagé (`findFrontArcSlamTarget`,
      nouvelle Section 7ter).
      **Reste de la branche** (voiture = la plus en avant non-encore-
      activée, dé = le plus gros du pool sans lot, trajectoire de base
      -> "Atteindra-t-on la ligne d'arrivée ?" -> si non et Command pas
      encore jouée : essai Nitro avec re-vérification, repli Airstrike
      si le Nitro ne suffit finalement pas ; si Command déjà jouée et
      un adversaire opérable à moins de 10 cases de l'arrivée :
      recherche d'une trajectoire alternative permettant de le tirer)
      fidèle à l'arbre — mais **écart 3** trouvé au passage : l'ancien
      code tentait aussi un Drift de secours entre l'échec du Nitro et
      l'Airstrike (avec son propre test dédié) — ce nœud n'existe pas
      dans le document ; supprimé, test corrigé en conséquence.
      12 tests dédiés ajoutés/corrigés (184→187 tests IA) : 5 anciens
      tests désormais faux corrigés (Drift inexistant, voiture Coast
      arrière vs avant, Slam vs "moins dangereuse" ×2), 4 nouveaux
      (Airstrike sans Drift, Coast+Slam loin de l'arrivée, Coast+Slam
      annulé près de l'arrivée). 212/212 moteur inchangés.
      Self-play 800 parties/48358 décisions : 0 crash, 0 décision
      illégale, 0 état incohérent (pas même l'artefact Blast Off/
      Finish Line habituel). Toutes les branches vérifiées
      effectivement empruntées sur 300 parties dédiées (17258
      décisions, comptage temporaire retiré après coup) : Coast+Slam
      14, Coast normal 365, atteinte directe 35, Nitro réussi 42,
      Airstrike joué 249, cas "Command déjà jouée + adversaire proche"
      12 trajectoires alternatives trouvées sur 165 évaluations.
      **Suivi post-livraison (allers-retours avec Mayrik)** :
      1. Écart 1 (Coast, voiture ciblée) : confirmé — erreur de
         copier/coller dans le document à ce nœud précis. C'est bien
         la voiture opérable la plus EN AVANT (comme l'ancien code v2
         le faisait déjà), pas la plus en arrière. Code et tests
         corrigés en conséquence, PDF corrigé par Mayrik de son côté.
      2. Écart 2 (Slam sur l'arc avant du Coast) : confirmé comme ajout
         volontaire de cette version de l'arbre — rien à changer.
      3. Écart 3 (Drift absent de la cascade "commande pas encore
         jouée") : confirmé comme un vrai manque de l'arbre d'origine.
         Mayrik a repris l'arbre en plusieurs passes successives
         (chacune relue en détail avant tout correctif code, jamais de
         rustine à la va-vite) :
         - 1ʳᵉ passe : ajout du nœud Drift-bloqué ("L'arc avant... est-il
           composé de 3 cases impassables/occupées ?" → "Dans le
           lot/pôle de dé y a-t-il un 3-4-5 ?" → Drift), MAIS un nœud
           "Le dé attribué au véhicule est-il un 1 ?" y était
           structurellement inatteignable : gated par "le pôle contient
           un 3/4/5", cette condition impose déjà que le plus gros dé
           du pôle (= le dé attribué) vaille au moins 3, donc ne peut
           jamais valoir 1. Repéré et signalé avant tout code.
         - 2ᵉ passe : incohérence de terminologie "lot" vs "pôle" (cette
           branche ne construit plus de lot depuis toujours, contrairement
           à l'autre) — repérée et signalée, pas encore le nœud "=1".
         - 3ᵉ passe (finale) : Mayrik a supprimé le nœud "=1" plutôt que
           de le reformuler — structure finale à 3 branches, TOUTES
           réellement atteignables : "pôle a un 3-4-5 ?" → OUI : Drift
           direct (dé mouvement inchangé) ; NON → "dernier tour du
           round ?" → OUI : Airstrike (plus petit dé du pôle, mouvement
           inchangé) ; NON : report — dé assigné retiré, le plus petit
           dé du pôle devient le nouveau dé de mouvement, aucune
           Command. Confirmée cohérente après relecture complète et
           comparaison pixel-par-pixel avec la version précédente
           (aucun autre changement caché).
      Implémenté avec `isFrontArcFullyBlocked` (réutilisé tel quel) et
      les mêmes helpers Airstrike (`findFrontmostCar`,
      `findAiAirstrikePlacement`) que le reste du fichier — aucun
      nouveau helper nécessaire, cette branche ne raisonnant jamais sur
      un lot. 7 tests dédiés ajoutés/corrigés (187→194 tests IA) : 3
      nouveaux pour la cascade Drift-bloqué (Drift direct, Airstrike
      dernier tour, report), 1 test Coast corrigé (avant, pas arrière),
      2 commentaires de tests mis à jour pour refléter les échanges
      avec Mayrik. 212/212 moteur inchangés.
      Self-play 800 parties/46315 décisions : 0 crash, 0 décision
      illégale, 0 état incohérent. Le blocage de l'arc avant s'est
      révélé rare dans ce contexte précis (le véhicule en tête de la
      course a naturellement de l'espace devant lui, contrairement à
      la branche "pas de Finish Line" où les voitures restent
      groupées) — confirmé réellement atteignable et correctement géré
      sur un échantillon élargi (500 parties/250 tours max : 1
      occurrence réelle capturée, routée vers Drift sans anomalie) ;
      les 3 sous-branches sont chacune couvertes avec certitude par un
      test dédié construit spécifiquement pour les déclencher.
- [x] **7. Validation globale** — la validation à grande échelle a
      tout de suite révélé un vrai bug, resté invisible aux 194 tests
      dédiés jusqu'ici : dans `decideFinishLineRush` (branche arc avant
      bloqué, étape 6), quand le SEUL dé de valeur 3-4-5 du pôle est
      justement celui déjà assigné au mouvement (ex. pool `[4,1,2,2]`,
      dé de mouvement = 4), le code réutilisait cette même valeur pour
      la Command Drift — deux usages de la même valeur alors qu'un seul
      dé physique de cette valeur existe dans le pôle. 1 décision
      illégale détectée sur 116552 (soit sur ~2000 parties) avant
      correctif.
      **Corrigé** en appliquant la même discipline que partout ailleurs
      dans le fichier (`poolMinusOne`, déjà utilisé pour Nitro juste à
      côté) : le pôle "restant" (hors dé déjà assigné) est calculé
      AVANT de chercher un 3-4-5 pour Drift ou un plus petit dé pour
      Airstrike/report — pas seulement le pôle brut. Nouveau cas
      limite couvert explicitement : si after exclusion il ne reste
      plus aucun dé (pool réduit au seul dé déjà assigné), on conserve
      simplement le mouvement bloqué d'origine, sans Command (aucune
      ressource disponible) — comportement sûr, non explicitement
      dessiné dans l'arbre mais cohérent avec les autres impasses
      similaires du fichier.
      2 tests dédiés ajoutés (194→196 tests IA), reproduisant exactement
      le pool capturé par le harnais de robustesse. 212/212 moteur
      inchangés.
      **Validation à grande échelle post-correctif** : 10500 parties
      (~615000 décisions rejouées), 0 crash, **0 décision illégale**,
      taux d'état incohérent conforme à l'artefact préexistant déjà
      documenté (Blast Off/Finish Line, jamais lié à l'IA elle-même) —
      confirmé par inspection du détail de plusieurs occurrences.
      **Revue qualitative** (`tools/generate-full-game.js`, 5 parties
      complètes générées, 265 tours cumulés) : 4 parties sur 5 se
      terminent par une victoire "finish-line" (la branche de l'étape 6
      est régulièrement décisive, pas un cas marginal). Bonne diversité
      de Command observée : Nitro 71, Coast 28, Airstrike 18, Repair 1,
      Drift 1 — Repair et Drift restent rares par nature de leurs
      conditions de déclenchement, mais confirmés non nuls sur cet
      échantillon.
      Le module `ai-decision.js` est désormais considéré
      **entièrement réaligné avec l'arbre de décision v3 à jour**,
      toutes branches confondues.

- [x] **8. Correctif post-rewrite — cible de tir figée avant un Slam**
      (trouvé par Mayrik en relisant une partie complète au viewer, pas
      par le harnais automatisé — le motif est rare et discret dans un
      simple compte de décisions légales/illégales).
      **Bug** : `decision.shotTarget` était calculé UNE SEULE FOIS par
      l'IA, à la décision, à partir de la destination *prévue*
      (`computeShotTargetForDecision`, étape 2). Or un Slam résout ses
      propres dés (dé de slam + dé de direction) PENDANT l'exécution du
      mouvement — après la décision de l'IA, qui ne peut donc pas
      connaître à l'avance la case d'arrivée réelle. `resolveShootStep`
      (engine.js) utilisait pourtant cette cible figée telle quelle :
      dès que le rebond envoyait le véhicule ailleurs que prévu, la
      cible prévisionnelle n'était plus dans l'arc avant réel → tir
      refusé ("X n'est pas dans l'arc avant de Y → tir impossible"),
      alors qu'une autre cible, bien réelle, se trouvait dans l'arc
      avant de la case d'arrivée effective (typiquement la victime du
      Slam elle-même, projetée à proximité immédiate).
      **Corrigé** dans `engine.js` (`resolveShootStep`) : nouveau
      paramètre optionnel `options.shootTargetFn(car, allCars)`,
      appelé — s'il est fourni — avec le véhicule dans son état FINAL
      (mouvement et Slam entièrement résolus), en priorité sur
      `options.shootTarget` (conservé comme repli, nécessaire pour
      l'Airstrike — tir fixe depuis un chopper, jamais affecté par un
      Slam de voiture — et pour ne rien casser des tests déjà en
      place). Câblé une seule fois dans
      `tools/run-shadow-legality.js` (`shootTargetFn:
      (currentCar, cars) => ai.chooseShootTarget(...)`), sur les DEUX
      chemins concernés (mouvement normal et Coast) — ils partagent
      déjà `resolveShootStep` comme point d'entrée unique (étape 2),
      donc un seul correctif suffit ; `tools/generate-full-game.js` et
      `tools/generate-review-cases.js` en héritent automatiquement via
      `playOneShadowTurn`, sans y toucher.
      1 test dédié ajouté dans `test-engine.js` (Test 72bis),
      reproduisant fidèlement le cas capturé par Mayrik au viewer
      (Slam qui recule le tireur, cible prévue devenue invalide,
      nouvelle cible correctement visée et touchée). 212/212 moteur,
      196/196 IA — aucune régression.
      **Audit ciblé à grande échelle** (400 parties self-play,
      instrumentation temporaire retirée après coup) : 1592 tours
      contenant un Slam, dont 472 avec une tentative de tir dans la
      foulée — 239 touchés, **0 "tir impossible"** sur cet échantillon
      (le motif exact du bug signalé par Mayrik n'apparaît plus).
      Complète également la validation self-play standard : 1000
      parties supplémentaires post-correctif, 0 crash, 0 décision
      illégale.

- [x] **9. Correctif post-rewrite — Nitro gâché quand le terrain
      plafonne le mouvement** (trouvé par Mayrik en revue qualitative
      d'une partie : un véhicule gardait une Command Nitro avec un dé
      1 alors que le tour se terminait dans de la boue — le mouvement
      n'allait pas plus loin, la Command était gâchée pour rien).
      Mayrik a mis à jour l'arbre en conséquence, en plusieurs passes
      relues avant tout correctif code (jamais de rustine à la
      va-vite) :
      - Branche **1er round** (lot à 2 dés, Nitro éligible) : tente
        désormais le **PLUS PETIT** dé 1-2-3 (coût minimal, contre le
        plus gros avant), avec un nouveau test explicite "cette
        trajectoire va-t-elle plus loin vers l'arrivée qu'avec le seul
        gros dé du lot, sans Nitro ?" — si non, Command abandonnée, le
        petit dé n'est jamais consommé (retourne disponible), le gros
        dé seul part au mouvement.
      - Branche **pas de Finish Line, commande pas encore jouée**
        (généralisation demandée par Mayrik, PAS à toutes les branches
        Nitro — "certaines ont une autre logique") : même test, mais
        le dé Nitro reste le **PLUS GROS** ≤3 (différence assumée,
        contexte différent du 1er round — lot déjà équilibré
        différemment). Si le test échoue, impasse TERMINALE (pas de
        repli vers Airstrike, contrairement au cas "position
        inéligible").
      **Un aller-retour utile pendant la relecture** : une première
      version de l'arbre intercalait par erreur une vraie "Phase de
      Mouvement" entre le calcul de trajectoire et le nouveau test —
      repéré avant tout code (une Phase de Mouvement représente une
      exécution réelle, impossible à "annuler" proprement une fois les
      hazards/Slams résolus), corrigé par Mayrik sur le document avant
      implémentation.
      Implémenté en réutilisant `chooseBestTrajectory`/
      `chooseGeneralTrajectory`/`chooseEntryTrajectory` déjà en place
      pour comparer les deux trajectoires (avec/sans Nitro) via
      `destination.col`, avec un `precomputedTraj` transmis à
      l'appelant pour éviter un recalcul redondant quand le Nitro est
      conservé.
      6 tests dédiés ajoutés/corrigés (196→199 tests IA) : 2 pour le
      1er round (Nitro conservé sur plateau ouvert avec le petit dé,
      Nitro abandonné sur un mur bloquant identique avec ou sans
      boost), 2 pour `decideNitroOrAirstrikeForLot` (idem, plus gros
      dé), et les 2 tests existants (choix "plus gros" au 1er round)
      corrigés pour refléter le nouveau comportement "plus petit".
      212/212 moteur inchangés.
      Self-play 2500 parties post-correctif : 0 crash, 0 décision
      illégale. **Audit ciblé** (400 parties, instrumentation
      temporaire retirée après coup) : 5295 évaluations Nitro (3907
      conservées, 1388 abandonnées) — **0 incohérence** : jamais un
      Nitro conservé sans progression réelle constatée, jamais un
      Nitro abandonné alors qu'il aidait réellement.

- [x] **10. Correctif outillage — voitures éliminées "fantômes" sur le
      plateau des viewers** (trouvé par Mayrik en relisant une partie
      complète au viewer : deux véhicules affichés sur la même case,
      ce qui est mécaniquement impossible dans le jeu).
      **Ce n'est PAS un bug de Slam manqué côté moteur/IA** — vérifié
      en premier lieu : les données de partie confirment que la
      voiture concernée était déjà correctement marquée `eliminated`
      au moment du tour signalé. Le bug est purement dans l'outillage
      de visualisation : une voiture éliminée conserve ses dernières
      coordonnées connues dans les données (jamais remises à `null`),
      et les trois templates HTML (`full-game-viewer-template.html`,
      `assign-command-viewer-template.html`, `review-cases.html`)
      dessinaient TOUTE voiture dont `col !== null` sans exclure le
      statut `eliminated` — seule la liste de badges de dégâts
      appliquait déjà ce filtre, jamais le rendu du plateau lui-même.
      Son icône "fantôme" restait donc affichée indéfiniment sur sa
      case de mort, se superposant à toute voiture y atterrissant
      ensuite par la suite de la partie.
      **Corrigé** dans les trois templates : la même garde utilisée
      pour les badges (`car.status !== "eliminated"`) est désormais
      appliquée aussi à la boucle de rendu SVG du plateau.
      **Validation directe sur données réelles** (pas de test unitaire
      ajouté ici — correctif d'affichage pur, sans logique de jeu) :
      rejoué le filtre corrigé sur les 3 parties déjà générées pour la
      revue qualitative de l'étape 7 (81, 42 et 63 tours). Occurrences
      de superposition fantôme AVANT correctif : 28, 14 et 5
      respectivement (47 au total) — **0 après correctif**, sur les
      trois parties et tous les tours, pas seulement celui initialement
      signalé.

## État courant (rewrite d'ai-decision.js)

Étapes 0 à 10 terminées — le rewrite du moteur de décision est complet
(deux bugs post-rewrite trouvés en revue qualitative et corrigés :
cible de tir figée avant un Slam, Nitro gâché quand le terrain
plafonne le mouvement), et un bug d'affichage de l'outillage de
visualisation (voitures éliminées fantômes) est également corrigé.
**199/199 tests IA, 212/212 tests moteur.** Plus aucune étape au plan
sur ce volet ; toute évolution future partirait d'un nouveau besoin
(pas d'un correctif de ce rewrite).

---

# Phase 2 — Prototype jouable (humain vs IA)

Le rewrite ci-dessus a rendu le moteur (`engine.js`) et l'IA
(`ai-decision.js`) solides et validés à l'échelle — mais jusqu'ici,
AUCUN humain ne pouvait réellement jouer une partie : tout n'existait
que via simulation programmatique (self-play) ou outils de revue en
lecture seule. Phasage retenu (le plus proche du terrain, le moins
coûteux à corriger, avant tout investissement mobile) :
1. Couche d'interface joueur ↔ moteur — **fait, voir ci-dessous**.
2. Rendu interactif minimal (web/desktop, formes simples).
3. Boucle de jeu complète, un round entier, humain vs IA.
4. Retour d'usage (UX, pas les règles — déjà validées).
5. Seulement ensuite : vraies images, mobile, packaging.

## 1. Couche d'interface joueur ↔ moteur — TERMINÉ

**Point de départ, vérifié dans le livret de règles (p.7-8) avant tout
code** : les conditions de position que l'IA applique pour choisir SES
propres Commands (tuile Rear, adversaire à moins de 6 cases, "arc
avant bloqué" pour Drift, ciblage Repair "en tête/en arrière"...) sont
des HEURISTIQUES DE L'AUTOMATE, PAS des règles du jeu. Un humain doit
rester entièrement libre de ses choix stratégiques ; seules les
contraintes mécaniques réelles s'appliquent : Nitro (dé 1-3), Drift
(dé 3-5, utilisable à tout moment pour traverser sans Slam — pas
seulement si bloqué), Repair (dé 6, cible n'importe laquelle de ses
voitures inopérables), Airstrike (n'importe quel dé, case vide au
choix), une seule Command par round, jamais sur un tour de Coast.

**Refactor préalable** : la logique d'exécution d'une décision
(tirage des dés du pool, résolution de Command, mouvement/Coast/
entrée, avancement de tour) était jusqu'ici *inlinée* dans
`tools/run-shadow-legality.js`, écrite spécifiquement pour le harnais
self-play IA vs IA. Extraite dans un nouveau fichier partagé
`turn-executor.js` (`checkDecisionLegality` + `executeDecision`),
utilisable par N'IMPORTE QUELLE source de décision — IA ou humain —
sans aucune branche spécifique côté moteur. `run-shadow-legality.js`
mis à jour pour utiliser ce module ; self-play réexécuté à l'identique
(500 parties, 0 crash/illégal/incohérence) pour confirmer un refactor
pur, sans aucun changement de comportement.

**Nouveau module `human-decision.js`** — symétrique de
`ai-decision.js` mais SANS AUCUNE politique stratégique :
- `getTurnContext` : que peut faire ce joueur ce tour (mode
  assign/coast, voitures activables, Command disponible ou non) —
  sans présélectionner quoi que ce soit, contrairement aux fonctions
  équivalentes côté IA.
- `getReachableOptions` : délègue à `computeReachableDestinations` /
  `computeReachableEntryDestinations` (déjà exportées par
  `ai-decision.js`, pure géométrie/règles de terrain, aucune
  heuristique) — renvoie TOUTES les cases atteignables, au joueur de
  choisir, jamais UNE seule "meilleure" comme le ferait
  `chooseGeneralTrajectory`.
- `getAvailableCommands` : légalité pure livret (plages de dé,
  Repair ouvert à toute voiture inopérable vivante) — zéro condition
  de position.
- `isValidAirstrikePlacement` / `listValidAirstrikePlacements` :
  mêmes conditions que `engine.placeChopperAirstrike`, mais en pure
  consultation (ne mute jamais le chopper, contrairement à la
  fonction moteur qui le positionne réellement dès validation).
- `buildHumanDecision` : assemble le choix du joueur dans EXACTEMENT
  la même forme que `ai.decideAssignAndCommand` — c'est ce qui permet
  à `turn-executor.js` de l'exécuter sans distinguer humain et IA.

**47 tests dédiés** (`test-human-decision.js`) : contexte de tour
(assign/coast/impossible), délégation fidèle des trajectoires
atteignables, légalité des Commands strictement conforme au livret
(notamment : Repair propose bien TOUTES les voitures inopérables, pas
seulement celle que l'IA aurait choisie ; Airstrike accepte n'importe
quel dé), placements Airstrike, construction de la décision, et
surtout deux tests d'intégration bout en bout démontrant qu'une
décision humaine s'exécute via le MÊME `executeDecision` que l'IA
(dont un test Repair où le joueur choisit délibérément la cible
OPPOSÉE à celle que l'IA aurait retenue, pour bien vérifier l'absence
de toute politique cachée). 212/212 moteur et 199/199 IA inchangés,
self-play 800 parties post-changement : 0 crash, 0 décision illégale,
0 état incohérent.

## 2. Rendu interactif minimal — TERMINÉ

**Objectif** : un humain doit pouvoir réellement jouer un tour, via
de vrais clics, à travers le même moteur que l'IA — formes simples,
zéro artwork, zéro animation (volontairement hors scope à ce stade).

**Défi technique principal** : `engine.js`/`ai-decision.js`/
`human-decision.js`/`turn-executor.js` sont des modules CommonJS
(Node.js) ; aucun n'utilise d'API Node en dehors du système de
modules lui-même (vérifié : aucun `fs`/`path`/`vm` dans leur propre
logique, seulement dans les outils de chargement de tuiles). Un
script de bundling dédié (`tools/build-bundle.js`) concatène les 4
fichiers + les 10 fichiers de données de tuiles en un seul script
navigateur : les lignes `require(...)` et leurs destructurations sont
retirées (les noms deviennent directement globaux par concaténation
dans le même scope), une seule collision de nom trouvée et résolue
(`SIZE_RANK`, défini deux fois avec la même valeur dans `engine.js`
et `ai-decision.js` — la déclaration d'`ai-decision.js` est retirée
du bundle), et `loadRealTiles()` est réécrite pour collecter les
variables globales déjà présentes plutôt que lire le système de
fichiers. Le script régénère aussi directement `prototype.html`
(assemblage de `template.html` + le bundle + `ui-script.js`).

**Validation du bundle** : rejoué 50 parties complètes IA vs IA à
travers le bundle navigateur (via `vm.runInContext`, en dehors de
tout DOM) — 0 crash, résultats mécaniquement identiques à la version
Node.

**Interface construite** (`template.html` + `ui-script.js`) : plateau
SVG interactif (même géométrie que les viewers de debug), panneau de
choix pas à pas pour le tour humain (voiture → dé → Command
éventuelle → destination cliquée sur le plateau → placement Airstrike
si besoin → confirmation), bouton unique pour déclencher le tour de
l'IA. Chaque décision humaine passe par `checkDecisionLegality` puis
`executeDecision` — exactement le chemin déjà emprunté par l'IA.

**Test réel avec jsdom** (pas une simple relecture de code) :
installation d'un DOM headless pour simuler de VRAIS clics et
vérifier les mises à jour réelles de l'interface. Un bug a été trouvé
et corrigé de cette façon : l'étape de placement Airstrike était
sautée (la vérification testait `sel.command.type`, pas encore
construit à ce stade du flux, au lieu de `sel.commandType`, déjà
connu) — invisible à la simple lecture, découvert uniquement en
cliquant réellement le chemin Airstrike de bout en bout. Une fois
corrigé, les 5 chemins de tour ont chacun été rejoués par de vrais
clics simulés jusqu'à exécution réussie : mouvement simple, Nitro,
Repair (avec cible choisie par le joueur), Airstrike (cible et
placement), Coast — puis une partie humain vs IA complète jusqu'à une
victoire réellement déclarée et affichée (itération 52-69 selon les
graines aléatoires testées).

## 2bis. Correctif — Nitro et bonus Road manquants dans le prototype

Trouvés par Mayrik en jouant réellement le prototype (round 1, dé 5 +
Nitro 3, cases proposées limitées à 3-5 au lieu des 8 attendues).

**Bug 1 (Nitro)** : `ui-script.js` calculait les cases atteignables à
partir du seul dé de mouvement, sans jamais ajouter la valeur du dé
Nitro choisi juste avant. Corrigé : la distance utilisée pour
`getReachableOptions` inclut désormais `dieValue + commandDieValue`
quand une Command Nitro est sélectionnée.

**Bug 2 (bonus Road), plus profond** : entièrement absent de
`human-decision.js` — pas une case oubliée dans une liste, une
fonctionnalité qui n'existait tout simplement pas côté couche
humaine. Le mécanisme (p.7, "optionnel, mais si utilisé, le montant
plein doit être pris") est une SECONDE application du mouvement,
distincte de la première (voir `engine.js`,
`playTurnAssignMoveWithProgression` : un second appel à
`moveCarWithProgression` avec le dé Road comme distance, APRÈS le
mouvement principal) — jamais une simple extension de distance comme
le Nitro. Ajout de `isRoadBonusEligible` (éligible si le trajet de
base est resté 100% route, sans case dangereuse, et qu'un dé Road a
été tiré ce round) et `getRoadBonusOptions` (destinations atteignables
pour l'extension, distance imposée = pile le dé Road, jamais moins —
l'extension elle-même n'a pas besoin de rester sur route) dans
`human-decision.js`. `buildHumanDecision` corrigée pour transmettre
`roadBonusPath` séparément (le chemin de l'EXTENSION seule, jamais
fusionné dans `destination`) — cohérent avec la façon dont le moteur
consomme cette option.
Côté interface (`ui-script.js`) : nouvelle étape "Voulez-vous utiliser
le bonus Road (+X) ?" (Oui/Non) après le choix de la destination de
base, quand éligible — jamais un ajout automatique, le joueur garde
le choix comme l'exige le livret.
4 tests dédiés ajoutés (dont un test d'intégration Nitro+Road combinés,
exécuté via le vrai moteur) + le test Repair déjà existant adapté pour
inclure un second joueur factice (un artefact "dernier joueur en jeu"
se déclenchait à tort dans un test à un seul joueur, repéré en
creusant l'échec initial du nouveau test) — 62/62 tests
`test-human-decision.js`, 199/199 IA et 212/212 moteur inchangés.
**Revalidé par de vrais clics simulés (jsdom)**, pas seulement les
tests unitaires : Nitro seul (8 cases obtenues, plus de plafond à
3-5), Nitro + bonus Road accepté (log confirme "BONUS ROAD disponible"
et le mouvement complet), et bonus Road refusé (aucune mention dans
le log, arrêt à la destination de base) — puis une partie complète
rejouée jusqu'à victoire (itération 54) avec la nouvelle étape gérée
à chaque case 100% route rencontrée, sans blocage.

## Point 3 (mouvement/tir case par case) — TERMINÉ

Retour d'usage de Mayrik après avoir joué sur `tools/prototype.html` :
le joueur humain veut choisir lui-même chaque case de destination une
par une (case par case dans l'arc avant courant, effets appliqués à
chaque case avant de proposer la suivante) et choisir librement sa
cible de tir en fin de mouvement (y compris ne pas tirer) — remplace
complètement l'ancien système (destination précalculée d'un coup +
`shootTargetFn` automatique), sans mode "auto" à conserver.

Aucune modification du moteur nécessaire pour le principe de base :
`moveCar`/`moveCarWithProgression` acceptaient déjà un `chosenPath`
d'une seule direction et appliquent cette case unique (effets compris)
sans aller plus loin — restructuration entièrement côté orchestration
(`turn-executor.js`/`human-decision.js`/`tools/ui-script.js`) pour
boucler un pas à la fois piloté par les clics du joueur, plus une
nouvelle fonction de liste de cibles de tir valides (`getShootTargetOptions`,
basée sur `getFrontArc`) à la place du choix automatique.

Décisions actées par Mayrik au fil de l'implémentation :
- Le Bonus Road devient lui aussi case par case (même boucle que le
  mouvement principal).
- Quand un Slam/hazard fait perdre des mouvements restants, un message
  explicite s'affiche (style "reste des mouvements perdus à cause de
  [raison]") avec un bouton Continuer, plutôt qu'un enchaînement
  automatique.
- Ordre de sélection UX : le joueur choisit d'abord le DÉ puis le
  VÉHICULE (jamais l'inverse), pour coller à l'expérience physique du
  dashboard en carton.
- Règle de relance de Slam (p.9, propriétaire de la voiture plus
  grande peut relancer les 2 dés une fois) implémentée côté moteur
  (`engine.js` : `resolveSlam` décomposé en `rollSlamDice`/
  `finalizeSlam` pour permettre une vraie pause interactive) et câblée :
  le joueur humain est interrogé en direct quand SA voiture est la
  plus grande ; politique de simplification pour l'IA — elle relance
  TOUJOURS quand sa propre voiture est celle qui bougerait suite au
  Slam et qu'une relance est possible, jamais de calcul de probabilité.

Câblé dans `tools/ui-script.js` (mouvement/entrée/tir/Bonus Road case
par case, popup de mouvements perdus, décalage de tuile annoncé à
l'écran avant de laisser choisir la vraie case suivante) — validé par
clics réels via jsdom (jamais juste relire le JS).

## 2ter. Correctifs — deux écarts remontés en jouant contre l'IA

Remontés par Mayrik (captures d'écran, parties réelles sur
`tools/prototype.html`), tous deux dans `tools/ui-script.js`
uniquement (aucune règle, aucun bug moteur en cause) :

**Écart 1 (tir proposé sans aucune cible)** : `proceedToShootPhase()`
passait systématiquement à l'étape "shoot" après avoir calculé
`getShootTargetOptions`, même quand ce tableau était vide (aucun
véhicule adverse dans l'arc avant). Corrigé : si
`sel.shootTargets.length === 0`, le tour se termine directement
(`finishHumanTurn()`), avec un log explicite ("Aucune cible à
portée... → tir automatiquement passé"), sans jamais afficher l'étape
de choix.

**Écart 2 (bonus Road proposé après un Slam)** : un Slam force
`remaining` à 0 (p.9) et met donc fin à la phase de mouvement
COMPLÈTE, pas seulement au mouvement programmé par le dé — mais comme
la case percutée reste une case route, `sel.roadEligible` restait vrai
et `proceedAfterMovement()` offrait quand même le bonus Road. Corrigé
par un nouveau drapeau `sel.hadSlam` (accumulé pas à pas comme
`sel.roadEligible`, réinitialisé à chaque nouveau tour dans
`commitAssignAndCommand`, positionné dans `handleStepResult` dès qu'un
pas — mouvement ou entrée en jeu — renvoie un `slam`), qui bloque
désormais l'offre du bonus Road dès qu'un Slam a eu lieu à n'importe
quel moment du mouvement.

**Validation** : 212/212 tests moteur, 203/203 tests IA, 99/99 tests
couche humaine inchangés (aucun de ces trois fichiers modifié). 4
tests dédiés via jsdom (vrais appels sur le bundle navigateur réel
généré par `build-bundle.js`, pas une relecture de code) : tir non
proposé sans cible (avec vérification du log et de la fin de tour) ;
bonus Road bloqué après Slam ; non-régression — bonus Road toujours
proposé normalement en l'absence de Slam ; détection du Slam
directement depuis un résultat réaliste de `handleStepResult` (forme
exacte de `moveCarWithProgression`/`moveCarEnteringBoard`), isolée du
reste de l'enchaînement pour vérifier précisément le point de
détection.

## 2quater. Correctif — dégât reçu en mouvement (pas seulement Slam) bloque aussi le bonus Road

Suite du correctif 2ter : Mayrik a fait remarquer que la même logique
(fin de la phase de mouvement complète) doit s'appliquer à un dégât
reçu pendant le mouvement, pas seulement à un Slam — exemple donné :
Mine → dégât → Blast Off → atterrissage sur une case route → plus de
mouvement, mais dégât reçu donc pas de bonus Road non plus.

**Vérification dans le livret** (p.9 : *"A car loses its remaining
moves when it takes damage."*, p.12 : *"If your car was moving, it
loses any remaining moves"*) : c'est bien une règle générale,
indépendante de la source du dégât — pas une règle spécifique au Slam.

**Constat sur le code existant** : dans le jeu de base (v1), le seul
hazard qui inflige un dégât à la voiture qui bouge est la Mine (le
Wreck ne fait qu'un Slam, sans dégât — vérifié p.7 et dans
`resolveHazard`). La Mine forçait déjà correctement `remaining: 0`
dans `engine.js` (rien à corriger côté moteur), mais rien côté
`tools/ui-script.js` ne bloquait l'offre du bonus Road pour cette
raison — exactement la même faille que le Slam, juste pour une autre
cause.

**Correctif** (uniquement `tools/ui-script.js`) : nouveau drapeau
`sel.hadDamage`, initialisé à `false` à chaque tour comme
`sel.hadSlam`. Plutôt que de faire remonter une information dédiée
depuis le moteur à travers plusieurs couches (`moveCar` →
`resolveHazard` → `applyDamage`) rien que pour ce besoin,
`executeMoveStepNow`/`executeEntryRowNow` comparent simplement
`car.damageTokens.length` avant/après le pas (`car` est le même objet
muté en place par le moteur, jamais une copie) — fiable quelle que
soit la source du dégât, y compris si une extension future en ajoute
d'autres. `proceedAfterMovement()` bloque désormais l'offre du bonus
Road si `sel.hadSlam` OU `sel.hadDamage` est vrai.

**Validation** : 212/212 tests moteur, 203/203 tests IA, 99/99 tests
couche humaine inchangés (aucun de ces trois fichiers touché). 2 tests
dédiés supplémentaires via jsdom sur le vrai bundle navigateur : bonus
Road bloqué après un dégât (drapeau forcé) ; et surtout une vraie Mine
posée sur le plateau réel puis une vraie case cliquée (`pickMoveStep`),
avec un jeton de dégât forcé à `dent` pour isoler le test d'un effet
d'élimination parasite (Blast Off) — confirme que `sel.hadDamage` est
détecté automatiquement depuis le vrai moteur, pas seulement en le
forçant à la main.

## 2quinquies. Correctif — relance de Slam non proposée pour un Slam révélé par un Wreck ; retrait de tout affichage UI des épaves

Remonté par Mayrik (cas 3, capture d'écran) : une voiture humaine entrant sur une case dont le hazard face cachée s'avère être un Wreck subit un Slam contre l'épave créée — la relance (p.9) part alors automatiquement sur la politique de l'IA, sans jamais demander au joueur, alors que sa voiture est la plus grande.

**Diagnostic confirmé avec Mayrik** : c'est une règle générale, pas spécifique au Wreck — *"Le joueur doit pouvoir décider lui-même s'il souhaite relancer le Slam ou pas"*, pour tout Slam impliquant une voiture de joueur. Le mécanisme de prévisualisation existant (`beginSlamSequence`/`previewSlam`) ne se déclenchait que pour un occupant DÉJÀ VISIBLE sur la case ciblée (`option.outcome === "slam"`, connu à l'avance par `getMovementStepOptions`/`getEntryRowOptions`) — un Slam révélé par un hazard face cachée (Wreck) n'est jamais marqué ainsi, puisqu'un jeton caché n'est pas un "occupant" aux yeux de ces fonctions, et retombait donc silencieusement sur `ai.decideSlamRerollDefault`, y compris pour la voiture du joueur.

**Point clé qui rend le correctif possible** : contrairement aux dés de Slam (vraiment aléatoires), la présence d'un Wreck sur une case est une donnée déjà connue du plateau (`cell.hazard`), et une épave a une taille TOUJOURS connue à l'avance (Small, Inopérable — p.7). On peut donc déterminer qui sera "plus grand" avant même d'exécuter le pas, exactement comme pour un occupant déjà visible — sans tricher sur le hasard.

**Correctif** (`tools/ui-script.js` uniquement) :
- `buildPredictedSlamOpponent(col, row)` : renvoie l'occupant réel s'il y en a un, sinon — si la case porte un hazard Wreck non révélé — une épave HYPOTHÉTIQUE construite avec exactement les mêmes propriétés que celle que `resolveHazard` (engine.js) créera réellement (Small, Inopérable, `isWreck`).
- `maybeBeginSlamSequence` remplace le test `option.outcome === "slam"` dans `pickEntryRow`/`pickMoveStep` : démarre la prévisualisation dès qu'un adversaire de Slam est prévisible, occupant réel ou Wreck.
- `matchesPreviewedSlam` généralise le raccord entre la prévisualisation et la vraie exécution : par identité d'objet pour un occupant déjà réel (comportement inchangé), ou par (voiture active persistante + `isWreck` sur l'autre + lancer forcé identique) pour un Wreck — l'épave réelle créée à l'exécution est un NOUVEL objet, jamais celui prévisualisé, donc l'identité seule ne suffit plus dans ce cas.
- Reste hors de portée (limitation assumée, déjà documentée) : un Slam EN CHAÎNE consécutif (nouvelle paire de voitures révélée en poussant un véhicule sur une case déjà occupée) — impossible de mettre le moteur en pause une seconde fois dans le même appel.

**Nettoyage de l'affichage des épaves** (demande de Mayrik, un problème connexe repéré dans la même capture — le badge `null small : 0 dégât(s) [INOPÉRABLE]`) — **corrigé une première fois trop largement** (épave entièrement masquée du plateau), Mayrik a signalé qu'une épave est un vrai pion physique sur le plateau (p.7) qui doit rester visible. Portée finale : les épaves (`car.isWreck`) restent affichées sur le plateau (`renderBoard`), avec une couleur neutre dédiée et un repère "W" au lieu de la couleur de propriétaire habituelle (`OWNER_COLOR[null]` produisait auparavant une case noire, invisible/confuse) ; seuls le badge de dégâts (`damageRow`, qui les traitait à tort comme une "équipe" à part) et le libellé de tir "brut" ("null small" → "l'épave") sont retirés. Mécaniquement, les épaves restent entièrement fonctionnelles (Slam, tir, blocage de case) dans tous les cas.

**Validation** : 212/212 tests moteur, 203/203 tests IA, 99/99 tests couche humaine inchangés. 4 tests dédiés via jsdom sur le vrai bundle navigateur : relance proposée au joueur pour un Slam révélé par un vrai Wreck posé sur le plateau réel ; choix de relance du joueur appliqué à la vraie résolution bout en bout (dés forcés identiques à l'aperçu, log confirmant la relance) ; non-régression complète du chemin pré-existant (occupant déjà visible, pas un Wreck) ; épave confirmée toujours visible sur le plateau ET absente du badge de dégâts (portée finale après le correctif du correctif).

**État courant** : Phase 2, point 3 toujours fonctionnellement complet et stabilisé sur tous les écarts remontés jusqu'ici (2ter, 2quater, 2quinquies). Mayrik continue à jouer des parties complètes sur `tools/prototype.html`.

## 2sexies. Simplification — Airstrike : suppression du double choix (cible séparée + placement)

Retour de Mayrik : le flux Airstrike demandait d'abord une "cible visée" dans une liste (facultative), PUIS un placement du chopper sur le plateau — un double choix redondant, puisque la cible n'a de sens qu'une fois le chopper posé (son arc avant dépend de sa position).

**Nouveau flux demandé et implémenté** (uniquement `tools/ui-script.js`, aucun changement moteur ni `human-decision.js` — `sel.command = {type:"airstrike", dieValue, target, placement}` garde exactement la même forme consommée par `executeAssignAndCommand`) :
1. Choisir Airstrike → directement le placement du chopper sur le plateau (case surlignée cliquable, comme avant).
2. Une fois posé, si son arc avant contient au moins un adversaire : nouvelle étape "airstrike-shoot-arc" — les 3 cases de l'arc avant du chopper (celles présentes sur le plateau affiché) deviennent surlignées et cliquables, exactement comme pour un déplacement. Cliquer une case OCCUPÉE par un adversaire = tirer dessus ; cliquer une case VIDE = ne pas tirer. Un bouton "Ne pas tirer" reste disponible en secours (utile si l'arc est entièrement occupé par des adversaires mais que le joueur veut quand même décliner, ou si une case de l'arc tombe hors du plateau affiché).
3. Si l'arc avant du chopper ne contient AUCUN adversaire dès le placement : aucune étape n'est proposée, passage direct à `commit` avec `target: null` — même philosophie que le correctif du tir normal sans cible (2ter).

Techniquement : `getShootTargetOptions`/`getFrontArc` (déjà génériques, ne lisent que `owner`/`col`/`row`) sont réutilisés tels quels sur un chopper HYPOTHÉTIQUE (copie, jamais muté) placé à la case choisie, pour calculer par avance qui serait dans son arc — le vrai placement n'a lieu qu'à l'exécution réelle (`commitAssignAndCommand`).

**Validation** : 212/212 tests moteur, 203/203 tests IA, 99/99 tests couche humaine inchangés (aucun des trois fichiers touché). 4 tests dédiés via jsdom sur le vrai bundle navigateur : placement puis visée d'une case occupée de l'arc (cible correctement identifiée) ; case vide de l'arc cliquée (décline) ; bouton "Ne pas tirer" toujours disponible malgré une cible existante ; aucune étape intermédiaire quand l'arc avant est entièrement vide dès le placement.

## 3. Chantier générateurs JS — Étape 1 (chaîne MOUVEMENT) : relance de Slam pendant le tour de l'IA impliquant une voiture du joueur

Reprise du chantier reporté en fin de section précédente (écart signalé
par Mayrik le 25/08 : un Slam déclenché PENDANT le tour de l'IA — ex.
tir → dégât → cascade Dazed qui pousse une voiture du joueur sur une
AUTRE voiture du joueur, plus grosse — ne proposait jamais la relance
au joueur, retombant silencieusement sur la politique par défaut de
l'IA). Solution retenue : convertir la chaîne de résolution du moteur
en générateurs JS (`function*`/`yield*`), avec un `yield` UNIQUEMENT
au point de `decideReroll` dans `resolveSlamGen`, et seulement si la
voiture plus grande appartient à un joueur marqué "humain"
(`options.isHumanOwner`).

**Séquencement confirmé par Mayrik** : chaîne mouvement d'abord (couvre
Slam direct + Wreck), chaîne tir/dégâts ensuite (cascade Dazed —
`resolveShoot`/`resolveDamageToken`/`applyDamage`, toujours
synchrones pour l'instant). Le nettoyage du hack Wreck de
prévisualisation (2quinquies, `buildPredictedSlamOpponent`/
`matchesPreviewedSlam`) est reporté à une 3e étape séparée, une fois
les deux chaînes de générateurs en place — décision de Mayrik : ne
pas mélanger les chantiers.

**Fonctions converties en générateurs** (`engine.js`) : `forceMoveOneSpaceGen`,
`resolveSlamGen`/`finalizeSlamGen`, `resolveHazardGen`,
`resolveOilSlickSlideGen`, `enterAdjacentSpaceGen`, `moveCarGen`,
`moveCarWithProgressionGen`, `moveCarEnteringBoardGen`,
`playTurnCoastWithProgressionGen`, `playTurnAssignMoveWithProgressionGen`,
`playTurnAssignEnterWithProgressionGen`. Chaque niveau délègue avec
`yield*` au niveau suivant (indispensable en JS : un `yield` ne
traverse pas un appel de fonction normale). Les anciennes fonctions
synchrones du même nom sont conservées à l'identique dans leur
signature et deviennent de simples pilotes (`driveSync`) qui font
tourner le générateur jusqu'au bout — tant qu'aucun appelant ne
fournit `options.isHumanOwner`, le `yield` unique de `resolveSlamGen`
ne peut jamais se produire, donc **aucun changement de comportement**
pour tout code existant (tests, self-play IA vs IA, tour humain propre
déjà géré par sa propre UI pas à pas via le mécanisme de
prévisualisation 2quinquies, inchangé).

Portée assumée pour cette étape : `resolveHazard`, cas MINE, continue
d'appeler `applyDamage()` de façon synchrone (pas de générateur) — la
chaîne tir/dégâts reste pour l'étape 2.

**`turn-executor.js`** : nouvelle fonction `executeDecisionGen`
(mirroir générateur d'`executeDecision`, comportement identique sauf
la capacité de pause — y compris un gap pré-existant repéré au passage
et volontairement PAS corrigé pour rester bit-à-bit fidèle à l'existant :
le tour Coast ne transmettait déjà pas `decideReroll`/`isHumanOwner`
avant ce chantier) + `driveInteractive(gen, sentValue)` (pilote
générique pause/reprise, réutilisable pour une pause en chaîne
ultérieure sans code spécial).

**`tools/ui-script.js`** : `playAiTurn()` utilise désormais
`executeDecisionGen`/`driveInteractive` avec
`isHumanOwner: (owner) => owner === HUMAN`. Nouvel état `G.aiPending`
(généreur en pause + contexte) et fonction `resumeAiSlamRerollChoice()`.
`renderPanel()` affiche, à la place du bouton "Jouer le tour de l'IA",
le même prompt de relance que pour le tour humain propre
(step "slam-reroll-choice") dès qu'une pause est en cours.

**Validation** :
- 212/212 tests moteur, 203/203 tests IA, 99/99 tests couche humaine :
  comparaison AVANT/APRÈS avec RNG rendu déterministe (LCG seedé) →
  **0 différence de sortie**, confirmant l'absence de tout changement
  de comportement synchrone.
- Self-play IA vs IA à grande échelle (2100 parties cumulées sur deux
  runs) : 0 crash, 0 décision illégale ; 1 état incohérent détecté sur
  1500 parties, signature identique à l'artefact déjà documenté et
  connu (jets Blast Off atterrissant sur la Finish Line, taux
  ~1/750-900) — confirmé non lié à ce chantier.
- `test-slam-reroll-generators.js` (nouveau, niveau moteur pur, sans
  navigateur) : 6 scénarios — Slam direct contre une voiture humaine
  plus grande → pause obtenue avec le bon contexte ; réponse "relancer"
  correctement appliquée (log + nouveau lancer forcé) ; Slam direct
  contre une voiture plus grande APPARTENANT À L'IA → aucune pause,
  politique IA appelée directement (non-régression) ; Slam révélé par
  un Wreck contre une voiture humaine plus grande → pause, avec la
  bonne voiture désignée comme "plus grande" (jamais l'épave) ;
  version synchrone (`moveCar`, sans `isHumanOwner`) → aucune exception,
  jamais de pause, quel que soit le propriétaire ; bout en bout via
  `executeDecisionGen`/`driveInteractive` sur un vrai plateau (tuiles
  réelles).
- `test-ui-ai-slam-reroll.js` (nouveau, jsdom sur le vrai bundle
  navigateur régénéré, VRAIS clics simulés, jamais une relecture du
  JS) : 3 scénarios — clic "Jouer le tour de l'IA" sur un Slam direct
  contre une voiture humaine plus grande → le panneau affiche bien le
  prompt SLAM avec les deux boutons de choix (pas de fin de tour
  silencieuse) ; clic "Non, garder ce résultat" → pause nettoyée, tour
  journalisé normalement, panneau revenu à l'état normal ; clic "Oui,
  relancer" → log confirmant la demande de relance ; scénario symétrique
  (voiture plus grande appartenant à l'IA) → aucune pause, tour terminé
  directement sur un seul clic (non-régression). Tuiles réelles utilisées
  (comme le prototype en jeu) : hazards face cachée neutralisés
  explicitement sur la case cible ET ses 6 voisines pour rendre le
  scénario déterministe (sinon un Slam en chaîne aléatoire — cas
  générique désormais géré nativement par le même mécanisme, sans code
  spécial — aurait pu redemander une seconde pause).

**État courant** : chaîne mouvement (Slam direct + Wreck) opérationnelle
côté tour de l'IA. Prochaine étape : chaîne tir/dégâts (cascade Dazed),
puis nettoyage du hack Wreck de prévisualisation en 3e étape séparée.

## 3bis. Correctif — le tour Coast ne transmettait pas la politique de relance de Slam

Repéré au passage pendant le chantier générateurs (section 3),
volontairement laissé de côté pour ne pas mélanger les chantiers.
Confirmé par Mayrik le 28/08 : ce N'ÉTAIT PAS un choix voulu — à
corriger, avec la même politique que pour un mouvement normal (l'IA
relance TOUJOURS quand sa propre voiture est celle qui bougerait
suite au Slam, jamais de calcul de probabilité, voir
`ai.decideSlamRerollDefault`).

**Cause** : `turn-executor.js`, la branche Coast d'`executeDecision`
(et donc aussi de la nouvelle `executeDecisionGen`) ne transmettait
AUCUNE option de Slam (`decideReroll`/`isHumanOwner`) à
`playTurnCoastWithProgression`, contrairement à la branche mouvement
normal juste à côté — un simple oubli de duplication du bloc
`slamOptions`, sans lien avec les règles elles-mêmes.

**Correctif** : les deux branches Coast (`executeDecision` et
`executeDecisionGen`) passent désormais `...slamOptions` comme la
branche mouvement normal — la politique IA est appliquée, et côté
`executeDecisionGen`, un Slam impliquant une voiture humaine plus
grande pendant un Coast met désormais aussi en pause pour demander
sa décision, exactement comme pour un mouvement normal ou une entrée
en jeu.

**Validation** : 212/203/99 tests inchangés (aucun n'exerce un tour
Coast via `executeDecision`, donc 0 différence attendue et confirmée).
1000 parties de self-play supplémentaires : 0 crash, 0 décision
illégale, 1 état incohérent — même artefact déjà documenté (Blast Off
sur Finish Line). Nouveau fichier `test-coast-slam-policy.js` (3
scénarios, avec un espion sur `ai.decideSlamRerollDefault` plutôt que
de dépendre du dé de Slam aléatoire) : la politique IA est bien
consultée pour un Slam pendant un Coast (elle ne l'était pas avant) ;
elle reçoit le bon contexte (les bonnes voitures) ; `executeDecisionGen`
met bien en pause pour une voiture humaine plus grande pendant un
Coast, comme pour un mouvement normal.

## 4. Chantier générateurs JS — Étape 2 (chaîne TIR/DÉGÂTS) : cascade Dazed

Suite directe de l'étape 1 (section 3) — couvre enfin le cas exact
signalé par Mayrik en tout début de chantier : l'IA tire sur une
voiture → dégât → jeton Dazed → la cascade pousse cette voiture sur
UNE AUTRE voiture, plus grosse, appartenant au joueur humain.

**Fonctions converties en générateurs** (`engine.js`) : `resolveDamageTokenGen`
(les 4 branches DENT/SHRAPNEL/SKID/DAZED/BLAST_OFF — SHRAPNEL délègue
à `applyDamageGen` pour la voiture touchée, SKID à `forceMoveOneSpaceGen`,
DAZED boucle sur `enterAdjacentSpaceGen`, BLAST_OFF délègue à
`resolveHazardGen`/`resolveSlamGen`/`forceMoveOneSpaceGen` dans ses
deux branches — avec ou sans `progressionState`), `applyDamageGen`
(délègue à `resolveDamageTokenGen`), `resolveShootGen` (délègue à
`applyDamageGen`), `resolveShootStepGen` (délègue à `resolveShootGen`).
Le cas MINE de `resolveHazardGen` (laissé synchrone à l'étape 1) utilise
désormais aussi `yield* applyDamageGen(...)`. Les deux points d'appel de
`resolveShootStep` dans `playTurnAssignMoveWithProgressionGen` et
`playTurnCoastWithProgressionGen` délèguent maintenant avec `yield*`.
Comme à l'étape 1, toutes les anciennes fonctions synchrones du même nom
sont conservées à l'identique et pilotent leur générateur via `driveSync`
— aucun changement de comportement sans `isHumanOwner`.

**Point notable** : le point de pause reste UNIQUEMENT celui de
`resolveSlamGen` (inchangé depuis l'étape 1) — aucune nouvelle logique
de pause n'a été nécessaire. La cascade Dazed, comme un Slam direct ou
un Wreck, finit toujours par un appel à `resolveSlamGen` dès qu'elle
percute une voiture ; le mécanisme de pause est donc resté générique,
agnostique de la CAUSE du Slam. Conséquence pratique : **aucun
changement dans `tools/ui-script.js`** n'a été nécessaire pour cette
étape — `driveAiTurnGenerator`/`G.aiPending`/le panneau de relance déjà
en place depuis l'étape 1 gèrent nativement une pause venue de la
chaîne tir/dégâts, vérifié explicitement par un test dédié (voir
ci-dessous).

**Validation** :
- 212/212 tests moteur, 203/203 tests IA, 99/99 tests couche humaine :
  comparaison AVANT/APRÈS avec RNG déterministe → **0 différence**.
- Self-play IA vs IA : 2000 parties cumulées sur deux runs après cette
  étape, 0 crash, 0 décision illégale ; 1 état incohérent détecté sur
  1000 parties (même artefact déjà documenté, Blast Off/Finish Line),
  et 0 sur le run de validation finale (1000 parties) — taux cohérent
  avec l'historique.
- `test-slam-reroll-generators.js`, tests 7 à 10 (nouveaux) : tir →
  Dazed → cascade → Slam contre une voiture humaine plus grande → pause
  obtenue, bon contexte, reprise correcte, tir bien marqué "touché" ;
  même scénario contre une voiture IA plus grande → aucune pause,
  politique IA appelée directement (non-régression) ; cascade Dazed sur
  2 étapes avec la pause survenant à la 2e étape seulement (pas la
  1ère) → fonctionne aussi ; version synchrone (`resolveShoot`, sans
  `isHumanOwner`) → aucune exception, jamais de pause.
- `test-ui-ai-slam-reroll.js`, test 5 (nouveau) : le même scénario tir
  → Dazed → cascade, piloté via `driveAiTurnGenerator` sur le vrai
  bundle navigateur (vrai clic simulé) → le panneau affiche bien le
  prompt SLAM, sans aucune modification de `tools/ui-script.js` au-delà
  de ce qui existait déjà depuis l'étape 1 — confirme que le mécanisme
  générique fonctionne de bout en bout, quelle que soit la couche
  d'origine du Slam.

**État courant** : les deux chaînes (mouvement et tir/dégâts) sont
désormais entièrement couvertes par le mécanisme de pause interactive
côté tour de l'IA. Seule étape restante du chantier générateurs :
nettoyage du hack de prévisualisation Wreck (2quinquies,
`buildPredictedSlamOpponent`/`matchesPreviewedSlam`, tour humain
propre) — devenu redondant maintenant que les deux chaînes sont
converties, mais laissé en l'état pour l'instant (décision de Mayrik :
étape 3 séparée, à traiter à part).

## 5. Chantier générateurs JS — Étape 3 : nettoyage du hack de prévisualisation Wreck

Dernière étape du chantier générateurs (voir sections 3 et 4) :
remplacement complet de l'ancien mécanisme de prévisualisation du
Slam côté PROPRE tour du joueur humain — devenu redondant maintenant
que les deux chaînes (mouvement, tir/dégâts) supportent nativement la
pause interactive — par le même mécanisme générique que côté tour de
l'IA.

**Retiré** (`tools/ui-script.js`) : `buildPredictedSlamOpponent`,
`maybeBeginSlamSequence`, `beginSlamSequence`, `matchesPreviewedSlam`,
`resolveSlamSequence`, `pickSlamRerollChoice`, `detectDamageTaken`,
`executeEntryRowNow`, `executeMoveStepNow`. Retiré aussi (devenu
inutile) : `previewSlam` (`human-decision.js`, y compris son export)
et l'import `rollSlamDice` associé, désormais sans usage dans ce
fichier.

**Ajouté** :
- `turn-executor.js` : `executeEntryStepGen`, `executeMoveStepGen`,
  `executeShootGen` — mirroirs génénérateurs des trois fonctions
  synchrones existantes (`executeEntryStep`/`executeMoveStep`/
  `executeShoot`, elles-mêmes inchangées et toujours utilisées telles
  quelles par `test-human-decision.js`, sans `isHumanOwner`).
- `tools/ui-script.js` : `driveHumanStepGenerator`/
  `resumeHumanSlamRerollChoice` — mirroir exact de
  `driveAiTurnGenerator`/`resumeAiSlamRerollChoice` (section 3), côté
  tour humain. `pickEntryRow`/`pickMoveStep`/`pickShootTarget`
  construisent directement le générateur avec
  `isHumanOwner: (owner) => owner === HUMAN` et le pilotent via cette
  fonction — plus aucun rejeu de dés forcés, plus aucune distinction
  entre Slam direct/Wreck/chaîne : un seul chemin de code pour tous
  les cas, exactement comme pour l'IA.
- `renderPanel()` : le panneau "slam-reroll-choice" lit désormais le
  contexte depuis `sel.pendingHumanSlam.ctx` (fourni par la pause du
  générateur) au lieu de `sel.slamPreview` (résultat de la
  prévisualisation retirée).

**Correctif inclus au passage** : le tir de fin de mouvement du joueur
(`pickShootTarget`) ne transmettait jusqu'ici AUCUNE option de Slam
(ni `decideReroll` ni `isHumanOwner`) à `executeShoot` — même
catégorie de gap que le correctif Coast (section 3bis), pour la même
raison (un simple oubli de branchement). Corrigé en même temps que ce
nettoyage : un Slam en chaîne déclenché par le PROPRE tir du joueur
applique désormais la bonne politique, et peut mettre en pause si la
voiture plus grande est humaine.

**Bénéfice concret** : le Slam en chaîne (une paire de voitures
DIFFÉRENTE de la première, déclenchée en poussant un véhicule sur une
case déjà occupée par autre chose), explicitement documenté comme hors
de portée de l'ancien hack ("impossible de mettre le moteur en pause
une seconde fois dans le même appel"), fonctionne désormais aussi
pour le PROPRE tour du joueur — plus symétrique avec le tour de l'IA
(déjà couvert nativement depuis l'étape 1, section 3).

**Validation** :
- 212/212 tests moteur, 203/203 tests IA, 99/99 tests couche humaine :
  RNG déterministe → **0 différence**. `test-human-decision.js` exerce
  directement `executeEntryStep`/`executeMoveStep`/`executeShoot`
  (sync, sans `isHumanOwner`) donc aucun impact attendu ni constaté.
- 1000 parties de self-play supplémentaires : 0 crash, 0 décision
  illégale, 0 état incohérent.
- `test-ui-human-slam-reroll.js` (nouveau, jsdom sur le vrai bundle
  régénéré, vrais clics) : Slam direct pendant le PROPRE mouvement du
  joueur contre une voiture IA, voiture du joueur plus grande → pause
  obtenue, panneau correct, clic "Non, garder ce résultat" → tour
  résolu jusqu'au bout (mouvement → pas de bonus Road après un Slam →
  phase de tir/fin de tour) ; même scénario avec la voiture IA plus
  grande → aucune pause (non-régression) ; Slam révélé par un Wreck
  pendant le PROPRE mouvement, voiture du joueur plus grande → pause
  obtenue, épave bien créée après résolution — sans AUCUN code dédié
  au cas Wreck (contrairement à l'ancien hack). Stable sur 8 runs
  répétés (le dé de direction du Slam n'étant pas forcé dans ce test).

**État final du chantier générateurs** : les trois étapes prévues
(mouvement, tir/dégâts, nettoyage de l'ancien hack) sont terminées. Un
seul et même mécanisme de pause interactive (`resolveSlamGen` +
`isHumanOwner`) couvre désormais tous les cas de Slam — direct, Wreck,
chaîne — pour le tour de l'IA ET pour le propre tour du joueur, sans
aucune duplication de logique entre les deux.

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

## État courant

Étapes 0 à 7 terminées — le rewrite est complet. **196/196 tests IA,
212/212 tests moteur.** Validation à grande échelle : 10500 parties
post-correctif final, 0 crash, 0 décision illégale. Plus aucune étape
au plan ; toute évolution future partirait d'un nouveau besoin (pas
d'un correctif de ce rewrite).

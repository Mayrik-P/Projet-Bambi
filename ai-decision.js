/**
 * ai-decision.js — Nouveau système de décision IA pour Thunder Road
 * In The Pocket, construit en repartant de zéro (voir l'historique
 * Git du dépôt pour la date exacte du pivot), suite à l'abandon
 * complet de l'ancien `ai-scoring.js` (Utility AI à 15 facteurs, jugé
 * trop complexe et instable après plusieurs correctifs empilés).
 *
 * MÉTHODE : ce module traduit fidèlement les deux arbres de décision
 * fournis par Mayrik — l'un pour l'attribution des dés, Command et
 * choix de véhicule ("Arbre de décision pour l'automate
 * ThundeRoad:Vendetta"), l'autre spécifiquement pour le choix de
 * trajectoire/destination ("Arbre de décision trajectoire", section
 * 3B ci-dessous) — validés main dans la main avec lui, cas par cas
 * avec un viewer visuel pour le second, avant toute implémentation.
 * Les arbres encodent déjà l'ordre des priorités stratégiques (validé
 * sur table de jeu physique et sur cas réels) — ce module ne réinvente
 * PAS la stratégie, il la rend robuste et exhaustive là où un arbre
 * papier ne peut pas tout couvrir (cas limites, égalités non dessinées).
 *
 * ARCHITECTURE EN 3 COUCHES (voir la synthèse partagée avec Mayrik) :
 *   1. REACHABILITY (ce fichier, section 1) — pour une voiture et un
 *      budget de mouvement donné, calcule l'ENSEMBLE COMPLET des
 *      cases atteignables (pas un seul chemin trouvé au hasard de
 *      l'exploration), chacune étiquetée avec ses propriétés
 *      tactiques. Le choix du chemin précis (pour l'animation) est
 *      un problème SÉPARÉ, traité après coup — jamais mélangé avec
 *      la question "quelle case est la meilleure".
 *   2. SCORE STATIQUE DE SLAM (section 2) — jamais de simulation de
 *      lancer de dé (un Slam arrête TOUJOURS le mouvement quelle que
 *      soit la direction du rebond, donc la direction exacte n'a pas
 *      besoin d'être simulée) : matchup de taille + nombre de cases
 *      dangereuses adjacentes à la case de Slam.
 *   3. ARBRE DE DÉCISION (section 3+) — traduction directe de l'arbre
 *      de Mayrik, dans l'ordre qu'il a posé.
 *
 * `engine.js` reste l'unique source de vérité pour les règles et la
 * géométrie du plateau — ce module ne réimplémente RIEN de ce qui y
 * existe déjà (front arc, rear arc, coût de déplacement...), il
 * compose ces primitives.
 */

"use strict";

const engine = require("./engine.js");
const {
  TERRAIN,
  CAR_STATUS,
  CAR_SIZE,
  HAZARD_TYPES,
  getSpace,
  getFrontArc,
  getRearArc,
  getCarAt,
  isChopperOccupied,
  computeAiStepCost,
  isAiHiddenHazard,
  findFrontmostCar,
  findAiAirstrikePlacement
} = engine;

// ===================================================================
// SECTION 1 — REACHABILITY : l'ensemble complet des cases atteignables
// ===================================================================

// Classification des hazards "dangereux" (à éviter préférentiellement
// dans le calcul de trajectoire, sans jamais bloquer le passage —
// exactement ce que ferait un joueur humain face à un jeton non
// retourné : il ne sait pas ce qu'il contient, il évite juste
// PRÉFÉRENTIELLEMENT). Liste donnée par Mayrik dans son arbre :
// "Oil, fire!, Rampe diagonale, Pit trap, Desert Glass". Seul Oil
// Slick existe dans le jeu de base actuel — les autres sont des
// hazards d'EXTENSION future (Fire/Rampe/Pit trap/Desert Glass, cf.
// profil du projet). Table volontairement conçue comme un lookup
// extensible : ajouter une extension future = ajouter une entrée
// ici, aucune logique à toucher ailleurs.
const DANGEROUS_REVEALED_HAZARD_TYPES = new Set([
  HAZARD_TYPES.OIL_SLICK
  // Extensions futures : HAZARD_TYPES.FIRE, HAZARD_TYPES.RAMP,
  // HAZARD_TYPES.PIT_TRAP, HAZARD_TYPES.DESERT_GLASS — dès qu'ils
  // existeront dans engine.js.
]);

/**
 * Une case compte-t-elle comme "case dangereuse" pour le calcul de
 * trajectoire (jetons cachés OU hazards révélés classés dangereux) ?
 * Ne bloque JAMAIS le passage — sert uniquement à compter/comparer
 * pour départager plusieurs destinations équivalentes par ailleurs
 * (cf. arbre : "Parmi ces cases y en a-t-il une qui a strictement
 * moins de case Hazard face caché et Impassable").
 */
function isDangerousCell(space) {
  if (!space) return false;
  if (isAiHiddenHazard(space)) return true;
  if (space.revealedHazard && DANGEROUS_REVEALED_HAZARD_TYPES.has(space.revealedHazard)) return true;
  return false;
}

/**
 * Calcule l'ENSEMBLE COMPLET des destinations atteignables pour une
 * voiture donnée avec un budget de mouvement donné (dieValue), en
 * respectant l'arc avant à chaque pas (front/front-left/front-right,
 * géométrie chevron déjà gérée par getFrontArc), le coût des
 * terrains, et les règles d'arrêt forcé du mouvement.
 *
 * Retourne un tableau de candidats, DÉDUPLIQUÉ par case finale (une
 * case atteignable par plusieurs chemins équivalents n'apparaît
 * qu'une fois, avec la variante ayant traversé le MOINS de cases
 * dangereuses — le chemin précis emprunté est une question
 * d'animation, pas de décision).
 *
 * Chaque candidat : {
 *   col, row,                  // case finale
 *   stepsUsed,                 // nombre de cases parcourues (peut
 *                              // être < dieValue si arrêt forcé)
 *   dangerousCellsCrossed,     // nb de cases dangereuses traversées
 *                              // EN ROUTE, case finale incluse
 *   allRoad,                   // tout le trajet est sur Road (bonus)
 *   terminalReason,            // 'normal' | 'slam' | 'eliminated-impassable'
 *                              // | 'eliminated-edge' | 'eliminated-chopper'
 *                              // | 'exits-front' (sortie avant, tuile
 *                              // suivante inconnue au moment de la
 *                              // décision — non prédictible, donc
 *                              // traité comme un point d'arrêt)
 *   slamTarget                 // voiture/épave présente sur la case,
 *                              // uniquement si terminalReason==='slam'
 * }
 *
 * Note volontaire : entrer sur une case Impassable ou un jeton
 * dangereux/caché n'est jamais EXCLU de l'ensemble des candidats —
 * seulement étiqueté. C'est à la couche de décision (section 3+) de
 * choisir de les éviter ou non, jamais à cette couche de trancher à
 * sa place.
 */
function computeReachableDestinations(board, car, dieValue, allCars, allChoppers, driftAvailable = false) {
  const explorer = createReachabilityExplorer(board, allCars, allChoppers, driftAvailable);
  explorer.visit(car.col, car.row, dieValue, 0, true, 0, [], false);
  return [...explorer.results.values()];
}

// Fabrique partagée de l'exploration de trajectoire — factorise la
// géométrie et les règles de terrain (bord, impassable, occupant,
// hazard, chopper, coût de déplacement) entre DEUX usages distincts :
//   1. computeReachableDestinations (ci-dessus) — voiture déjà sur le
//      plateau, arc avant classique à 3 cases depuis sa position.
//   2. computeReachableEntryDestinations (plus bas) — voiture qui
//      entre en jeu (p.9 : "Each car's initial move is onto one of
//      the spaces on the back edge of the rear tile"), dont le
//      "premier pas" n'est PAS un arc avant à 3 cases mais TOUTES les
//      cases de la colonne 0 (modèle de Mayrik : le hors-plateau est
//      une case virtuelle unique reliée à toute la colonne 0).
// AUCUNE règle de terrain n'est dupliquée entre les deux : seule la
// façon de produire le tout premier "pas" diffère.
function createReachabilityExplorer(board, allCars, allChoppers, driftAvailable) {
  const results = new Map(); // clé "col,row" -> meilleur candidat pour cette case

  function record(col, row, stepsUsed, dangerousCellsCrossed, allRoad, terminalReason, slamTarget, path, extra) {
    const key = `${col},${row}`;
    const candidate = { col, row, stepsUsed, dangerousCellsCrossed, allRoad, terminalReason, slamTarget: slamTarget || null, path, ...(extra || {}) };
    const existing = results.get(key);
    if (!existing) {
      results.set(key, candidate);
      return;
    }
    // Déduplication : pour un arrêt FORCÉ (Slam, élimination...), la
    // route la plus DIRECTE (moins de pas) est la seule qui a un sens
    // tactique — un détour n'a aucune raison d'être choisi avant de
    // provoquer volontairement ce même arrêt, et le nombre de pas
    // réellement nécessaire est ce dont dépend le calcul "Slam trop
    // prématuré ?" de la section 2 (une route plus longue fausserait
    // ce calcul). Pour un arrêt 'normal' (budget de dé épuisé), le
    // nombre de pas est par définition toujours égal au dé assigné
    // quelle que soit la route — seul le nombre de cases dangereuses
    // traversées différencie alors deux routes vers la même case.
    if (terminalReason !== "normal" && stepsUsed < existing.stepsUsed) {
      results.set(key, candidate);
    } else if (stepsUsed === existing.stepsUsed && dangerousCellsCrossed < existing.dangerousCellsCrossed) {
      results.set(key, candidate);
    }
  }

  // Traite UN pas déjà identifié (case candidate), quelle que soit son
  // origine. `appendToPath` distingue le pas d'ENTRÉE (jamais inclus
  // dans `path` — moveCarEnteringBoard prend la rangée d'entrée à
  // part, `path` ne liste que la CONTINUATION après l'entrée) d'un
  // pas normal d'arc avant (toujours ajouté à `path`).
  function handleStep(step, pointsRemaining, dangerousCellsCrossed, allRoad, stepsUsed, pathSoFar, driftUsed, appendToPath, extra) {
    const space = getSpace(board, step.col, step.row);
    const nextPath = appendToPath ? [...pathSoFar, step.name] : pathSoFar;

    if (space === null) {
      // Bord GAUCHE/DROIT : sortie du plateau = élimination (p.6).
      record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "eliminated-edge", null, nextPath, extra);
      return;
    }
    if (space === undefined) {
      // Bord AVANT (col >= cols) : la voiture continuerait sur la
      // tuile suivante, dont le contenu est inconnu au moment de
      // la décision (elle n'est piochée qu'à l'exécution réelle,
      // p.11) — on ne peut pas prédire plus loin, donc on
      // enregistre ce point comme un arrêt de planification, pas
      // une élimination ni une case normale.
      record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "exits-front", null, nextPath, extra);
      return;
    }

    if (space.terrain === TERRAIN.IMPASSABLE) {
      record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "eliminated-impassable", null, nextPath, extra);
      return;
    }

    const occupant = getCarAt(allCars, step.col, step.row);
    if (occupant) {
      // Entrer sur une case occupée arrête TOUJOURS le mouvement si
      // on choisit de s'arrêter LÀ (p.9) — toujours enregistré comme
      // candidat de Slam valide, Drift ou pas.
      record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "slam", occupant, nextPath, extra);

      // Avec Drift, on peut aussi CONTINUER au-delà de ce PREMIER
      // véhicule rencontré (p.8 : "peut passer à travers le premier
      // véhicule... sans le slammer, SAUF si le mouvement se
      // termine dessus" — déjà couvert par le 'record' ci-dessus
      // pour ce cas précis). Jamais un 2e véhicule (driftUsed).
      if (driftAvailable && !driftUsed) {
        const chopperHere2 = isChopperOccupied(allChoppers, step.col, step.row);
        const cost2 = computeAiStepCost(space.terrain, pointsRemaining);
        if (cost2 !== null) {
          const remainingAfter2 = pointsRemaining - cost2;
          const nextDangerous2 = dangerousCellsCrossed + (isDangerousCell(space) ? 1 : 0);
          const nextAllRoad2 = allRoad && space.terrain === TERRAIN.ROAD;
          if (remainingAfter2 === 0) {
            record(step.col, step.row, stepsUsed + 1, nextDangerous2, nextAllRoad2, chopperHere2 ? "eliminated-chopper" : "normal", null, nextPath, extra);
          } else {
            visit(step.col, step.row, remainingAfter2, nextDangerous2, nextAllRoad2, stepsUsed + 1, nextPath, true, extra);
          }
        }
      }
      return;
    }

    const chopperHere = isChopperOccupied(allChoppers, step.col, step.row);
    const cost = computeAiStepCost(space.terrain, pointsRemaining);
    const nextDangerous = dangerousCellsCrossed + (isDangerousCell(space) ? 1 : 0);
    const nextAllRoad = allRoad && space.terrain === TERRAIN.ROAD;

    if (cost === null) {
      // Terrain trop coûteux pour les points restants (boue avec
      // >1 point restant nécessaire mais insuffisant) : ce chemin
      // ne peut pas continuer par ici, mais rien n'empêche
      // d'essayer les 2 AUTRES directions de l'arc avant.
      return;
    }

    const remainingAfter = pointsRemaining - cost;

    if (remainingAfter === 0) {
      // Budget épuisé pile sur cette case : point d'arrêt normal,
      // SAUF si un chopper y est stationné (élimine la voiture qui
      // termine son tour dessus, p.6).
      record(step.col, step.row, stepsUsed + 1, nextDangerous, nextAllRoad, chopperHere ? "eliminated-chopper" : "normal", null, nextPath, extra);
      return;
    }

    // (Passer À TRAVERS un chopper est sans effet tant que ce n'est
    // pas la case d'arrêt finale, p.6 — rien à faire ici, on continue
    // d'explorer au-delà normalement.)
    visit(step.col, step.row, remainingAfter, nextDangerous, nextAllRoad, stepsUsed + 1, nextPath, driftUsed, extra);
  }

  function visit(col, row, pointsRemaining, dangerousCellsCrossed, allRoad, stepsUsed, pathSoFar, driftUsed, extra) {
    const arc = getFrontArc({ col, row });
    for (const step of arc) {
      handleStep(step, pointsRemaining, dangerousCellsCrossed, allRoad, stepsUsed, pathSoFar, driftUsed, true, extra);
    }
  }

  return { results, record, visit, handleStep };
}

/**
 * Symétrique de computeReachableDestinations pour une voiture qui
 * n'est PAS ENCORE sur le plateau (car.col === null, avant sa
 * première entrée). Traduit fidèlement p.9 : "Each car's initial
 * move is onto one of the spaces on the back edge of the rear tile"
 * — l'entrée COÛTE le premier point de mouvement (coût de terrain
 * normal, comme entrer sur n'importe quelle case), PUIS le trajet
 * continue normalement avec les points restants, exactement comme un
 * mouvement classique. AVANT ce correctif, la décision d'entrée était
 * codée en dur sur la seule case d'entrée (aucune suite de trajectoire
 * calculée), ce qui faisait perdre tout le mouvement restant à chaque
 * entrée — confirmé par Mayrik contre le texte exact de la règle.
 *
 * Modélisé comme suggéré par Mayrik : le "hors plateau" est une case
 * virtuelle unique reliée à TOUTES les cases de la colonne 0 (pas un
 * arc avant classique à 3 cases) — un dé de 1 permet donc d'entrer
 * sur N'IMPORTE QUELLE case de la colonne 0 dont le coût de terrain
 * le permet, pas seulement 3 d'entre elles.
 *
 * Chaque candidat porte un champ `entryRow` supplémentaire (la
 * rangée de colonne 0 par laquelle on est réellement entré) —
 * nécessaire pour recalculer le danger du chemin de continuation
 * plus tard (voir pathHazardDanger), puisque `path` ne liste QUE les
 * pas de continuation après l'entrée, jamais l'entrée elle-même
 * (moveCarEnteringBoard prend la rangée d'entrée séparément du
 * chemin de continuation — voir engine.js).
 */
function computeReachableEntryDestinations(board, dieValue, allCars, allChoppers, driftAvailable = false) {
  const explorer = createReachabilityExplorer(board, allCars, allChoppers, driftAvailable);
  for (let row = 0; row < board.rows; row++) {
    explorer.handleStep({ name: "entry", col: 0, row }, dieValue, 0, true, 0, [], false, false, { entryRow: row });
  }
  return [...explorer.results.values()];
}

// ===================================================================
// SECTION 2 — SCORE STATIQUE DE SLAM (jamais de simulation de dé)
// ===================================================================
// Principe de Mayrik, confirmé cette session : un Slam arrête
// TOUJOURS le mouvement quelle que soit la direction du rebond
// (dé Slam + dé Direction) — donc la direction exacte n'a besoin
// d'être ni simulée ni même connue pour juger si un Slam est une
// bonne idée. Seuls comptent : le matchup de taille et le nombre de
// cases dangereuses adjacentes à la case de Slam (proxy statique du
// risque de rebond défavorable, sans calcul de probabilité exacte).
//
// Règle d'acceptation (formulée par Mayrik, confirmée sur l'arbre) :
//   - Cible strictement PLUS PETITE que la voiture activée →
//     toujours accepter, quel que soit le nombre de cases
//     dangereuses adjacentes.
//   - Cible de taille ÉGALE → accepter seulement si au plus 1 case
//     dangereuse est adjacente à la case de Slam.
//   - Cible strictement PLUS GROSSE → toujours refuser.
//   - Dans tous les cas, un Slam n'est acceptable que sur l'AVANT-
//     DERNIER ou le DERNIER point de mouvement du dé assigné (sinon
//     trop de cases de progression sont perdues) — paramètre
//     `assignedDieValue` distinct du nombre de pas réellement
//     parcourus par CE candidat précis, car un Slam peut survenir
//     "trop tôt" par rapport au budget total alloué.
const SIZE_RANK = {
  [CAR_SIZE.SMALL]: 1,
  [CAR_SIZE.MEDIUM]: 2,
  [CAR_SIZE.LARGE]: 3
};

/**
 * Compte le nombre de cases "dangereuses" (Impassable ou hors
 * plateau) parmi les 6 cases adjacentes (arc avant + arc arrière) à
 * une case de Slam donnée — proxy statique du risque de rebond
 * défavorable, sans jamais simuler le dé Slam/Direction réel.
 */
function countDangerousAdjacentCells(board, col, row) {
  const neighbors = [...getFrontArc({ col, row }), ...getRearArc({ col, row })];
  let count = 0;
  for (const n of neighbors) {
    const space = getSpace(board, n.col, n.row);
    if (space === null || space === undefined || space.terrain === TERRAIN.IMPASSABLE) count++;
  }
  return count;
}

/**
 * Évalue si un candidat de type Slam (terminalReason === 'slam') est
 * une bonne option pour la voiture activée. Retourne { accept,
 * dangerousAdjacentCount, tooEarly } — jamais un score numérique
 * flou : la règle de Mayrik est une décision nette, pas un
 * compromis à pondérer.
 */
function evaluateSlamCandidate(candidate, assignedDieValue, myCarSize, board) {
  if (!candidate.slamTarget) {
    return { accept: false, dangerousAdjacentCount: 0, tooEarly: false };
  }
  const tooEarly = candidate.stepsUsed < assignedDieValue - 1;
  if (tooEarly) {
    return { accept: false, dangerousAdjacentCount: 0, tooEarly: true };
  }

  const dangerousAdjacentCount = countDangerousAdjacentCells(board, candidate.col, candidate.row);
  const myRank = SIZE_RANK[myCarSize];
  const targetRank = SIZE_RANK[candidate.slamTarget.size];

  let accept;
  if (targetRank < myRank) accept = true; // cible plus petite : toujours accepter
  else if (targetRank === myRank) accept = dangerousAdjacentCount <= 1; // égalité : accepter si ≤1 case dangereuse
  else accept = false; // cible plus grosse : toujours refuser

  return { accept, dangerousAdjacentCount, tooEarly: false };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DANGEROUS_REVEALED_HAZARD_TYPES,
    isDangerousCell,
    computeReachableDestinations,
    computeReachableEntryDestinations,
    SIZE_RANK,
    countDangerousAdjacentCells,
    evaluateSlamCandidate
  };
}

// ===================================================================
// SECTION 3A — TIR : cible retenue une fois le mouvement terminé
// ===================================================================
// Traduction directe de l'arbre : "Une fois le mouvement fini, y a-t-
// il plusieurs cibles de tir valides ? -> On choisit le véhicule du
// joueur ayant un véhicule le plus en avant de la course."
/**
 * Retourne la meilleure cible de tir depuis une position donnée, ou
 * null si aucune cible valide dans l'arc avant. Une cible valide =
 * voiture adverse operable, ou epave (traitee comme une Small
 * inoperable tirable, p.10) - jamais un chopper (non tirable, p.10),
 * jamais une voiture inoperable ordinaire.
 */
function chooseShootTarget(fromCol, fromRow, myOwner, allCars) {
  const arc = getFrontArc({ col: fromCol, row: fromRow });
  const candidates = allCars.filter((c) => {
    if (c.owner === myOwner) return false;
    if (c.status === CAR_STATUS.ELIMINATED) return false;
    if (c.status === CAR_STATUS.INOPERABLE && c.owner !== null) return false;
    return arc.some((a) => a.col === c.col && a.row === c.row);
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const byOwner = new Map();
  for (const c of allCars) {
    if (c.status === CAR_STATUS.ELIMINATED) continue;
    if (!byOwner.has(c.owner) || c.col > byOwner.get(c.owner).col) byOwner.set(c.owner, c);
  }
  let bestOwner = null, bestCol = -Infinity;
  for (const cand of candidates) {
    const ownerBest = byOwner.get(cand.owner);
    if (ownerBest && ownerBest.col > bestCol) { bestCol = ownerBest.col; bestOwner = cand.owner; }
  }
  return candidates.find((c) => c.owner === bestOwner) || candidates[0];
}

// Étape 2 (rewrite-plan.md) : le tir est désormais une étape
// GÉNÉRIQUE post-mouvement, identique quelle que soit la branche de
// l'arbre qui a produit la décision — plus question de la porter
// séparément dans chaque branche (decideNoFinishLine,
// decideFinishLineRush, chooseBestTrajectory...), qui divergeaient
// et ont fini par oublier un cas (Coast, jamais relié côté
// orchestrateur avant ce correctif). Point d'entrée UNIQUE : appelé
// une fois par décision, après que la destination finale est connue,
// par l'orchestrateur (ou tout outil qui rejoue une décision — cf.
// tools/generate-review-cases.js).
function computeShotTargetForDecision(decision, allCars) {
  if (!decision || decision.isEntry || !decision.destination) return null;
  return chooseShootTarget(decision.destination.col, decision.destination.row, decision.car.owner, allCars);
}

// ===================================================================
// SECTION 3B — CASCADE DE CHOIX DE TRAJECTOIRE/DESTINATION
// ===================================================================
// Traduction directe du 2e arbre de Mayrik ("Arbre de décision
// trajectoire"), clarifié point par point et validé cas par cas avec
// un viewer visuel avant implémentation (voir tools/). Remplace
// l'ancienne heuristique "plus loin, puis moins dangereux" par :
//
//   1. Parmi les destinations ATTEIGNABLES SANS TRAVERSER AUCUN
//      hazard dangereux ("propres"), si certaines restent ENTIÈREMENT
//      sur route (allRoad), on regarde si le bonus Road (dé Road,
//      mouvement supplémentaire qui n'a PAS besoin de rester sur
//      route, p.9) permet d'aller encore plus loin proprement.
//      Préférence de terrain Route > Off-Road > Mud parmi les
//      destinations "avec bonus".
//   2. Sinon, le bonus est abandonné ENTIÈREMENT (pas de nouvelle
//      tentative palier par palier) : meilleure destination "propre"
//      SANS bonus, tous terrains confondus, départagée par proximité
//      puis par danger d'arrivée GRADUÉ (table de Mayrik : somme des
//      valeurs de danger des 6 cases adjacentes — arc avant+arrière —
//      à la destination, terrain nu inclus car pertinent pour le tour
//      suivant en cas de Slam).
//   3. Si aucune destination propre n'existe (chemin forcé), la plus
//      avancée parmi les normales/Slam, départagée par le danger
//      CUMULÉ du CHEMIN traversé (hazards uniquement, terrain nu
//      exclu — déjà capturé par le coût de déplacement). En cas
//      d'égalité, priorité à un Slam contre un adversaire STRICTEMENT
//      plus petit (choix délibéré plutôt que subi — réutilise la même
//      règle de taille que le score de Slam, section 2).
//   4. Dernier recours : n'importe quelle case autre qu'Impassable ;
//      à défaut, la trajectoire la plus longue vers une Impassable.
//
// RÈGLE IMMUABLE (Mayrik) : à ce calcul, et uniquement ici, un
// véhicule adverse occupé compte comme un hazard dangereux — jamais
// recherché activement comme destination (seul le palier 3 peut y
// mener, en dernier recours). Une bonne opportunité de Slam qui se
// présente quand même est reciblée APRÈS coup, via le mécanisme
// séparé ci-dessous (arc arrière de la destination déjà choisie) —
// deux mécanismes distincts, jamais mélangés.
//
// LIMITE CONNUE, documentée plutôt que masquée : le reciblage Slam
// sur l'arc arrière ne s'applique qu'aux destinations SANS bonus Road
// — il réutilise l'ensemble `candidates` calculé pour le seul dé de
// mouvement de base, dont l'arc arrière n'a pas de sens une fois la
// voiture déplacée plus loin par le bonus. À rouvrir si besoin.

// Valeur de danger d'un HAZARD spécifiquement (véhicule adverse —
// règle immuable —, jeton face caché, ou jeton révélé classé
// dangereux) ; 0 si la case n'a aucun hazard. Le terrain nu, lui,
// est traité séparément par chaque appelant selon le contexte (une
// case Road/Off-Road/Mud pèse dans le danger d'ARRIVÉE mais pas dans
// le danger du CHEMIN traversé — cf. clarification Mayrik).
function hazardValueOfCell(board, col, row, allCars) {
  const space = getSpace(board, col, row);
  if (!space) return 0;
  if (getCarAt(allCars, col, row)) return 6;
  if (space.hazard !== null) return 6;
  if (space.revealedHazard === HAZARD_TYPES.OIL_SLICK) return space.terrain === TERRAIN.MUD ? 4 : 3;
  return 0;
}

// Table de danger (Mayrik) : seuls les types déjà implémentés dans
// engine.js (Fire!/Desert Glace/Ramp/Pit Trap attendent leurs
// extensions futures).
//
// Bordure de plateau : PAS une valeur unique — même distinction que
// getSpace()/enterAdjacentSpace() dans engine.js. Bord AVANT (sortie
// par l'avant, progression des tuiles, pas une élimination) = 0.
// Bord latéral (gauche/droite) ou ARRIÈRE (élimination dans les deux
// cas) = 9, au même niveau qu'une case Impassable.
function dangerValueOfCell(board, col, row, allCars) {
  const space = getSpace(board, col, row);
  if (space === null) return 9; // bord latéral (gauche/droite) — élimination
  if (space === undefined) return col < 0 ? 9 : 0; // arrière (élimination) vs avant (progression)
  if (space.terrain === TERRAIN.IMPASSABLE) return 9;
  const hazardValue = hazardValueOfCell(board, col, row, allCars);
  if (hazardValue > 0) return hazardValue;
  if (space.terrain === TERRAIN.ROAD) return 0;
  if (space.terrain === TERRAIN.OFF_ROAD) return 1;
  if (space.terrain === TERRAIN.MUD) return 2;
  return 0;
}

// Danger de la case d'ARRIVÉE = somme des 6 cases adjacentes (arc
// avant + arrière), terrain nu inclus (un Slam peut y repositionner
// la voiture au tour suivant).
function arrivalDanger(board, col, row, allCars) {
  const neighbors = [...getFrontArc({ col, row }), ...getRearArc({ col, row })];
  return neighbors.reduce((sum, n) => sum + dangerValueOfCell(board, n.col, n.row, allCars), 0);
}

// Danger du CHEMIN traversé = somme des cases HAZARD uniquement
// (terrain nu exclu, déjà capturé par le coût de déplacement).
// `startCol`/`startRow` est le point de départ du chemin — la
// position actuelle de la voiture pour un mouvement normal, ou la
// rangée d'entrée (colonne 0) pour un trajet d'entrée en jeu (voir
// chooseEntryTrajectory, où `path` ne liste que la CONTINUATION
// après l'entrée, jamais l'entrée elle-même).
function pathHazardDanger(board, startCol, startRow, path, allCars) {
  let col = startCol, row = startRow, sum = 0;
  for (const stepName of path) {
    const step = getFrontArc({ col, row }).find((a) => a.name === stepName);
    if (!step) break;
    col = step.col; row = step.row;
    const space = getSpace(board, col, row);
    if (space === null || space === undefined || space.terrain === TERRAIN.IMPASSABLE) continue;
    sum += hazardValueOfCell(board, col, row, allCars);
  }
  return sum;
}

const TERRAIN_PREFERENCE_ORDER = [TERRAIN.ROAD, TERRAIN.OFF_ROAD, TERRAIN.MUD];

// Parmi des candidats déjà "propres", préférence Route > Off-Road >
// Mud, chaque palier ne cédant au suivant que s'il permet une
// progression strictement meilleure (cascade de l'arbre).
function pickByTerrainPreference(candidates, board) {
  const byTerrain = { [TERRAIN.ROAD]: [], [TERRAIN.OFF_ROAD]: [], [TERRAIN.MUD]: [] };
  for (const c of candidates) {
    const space = getSpace(board, c.col, c.row);
    const terrain = space ? space.terrain : null;
    if (byTerrain[terrain]) byTerrain[terrain].push(c);
  }
  let best = null;
  for (const terrain of TERRAIN_PREFERENCE_ORDER) {
    const group = byTerrain[terrain];
    if (group.length === 0) continue;
    const bestOfGroup = group.reduce((a, b) => (b.col > a.col ? b : a));
    if (!best || bestOfGroup.col > best.col) best = bestOfGroup;
  }
  return best;
}

function chooseGeneralTrajectory(board, car, dieValue, allCars, allChoppers, driftAvailable = false, roadDieValue = 0) {
  const candidates = computeReachableDestinations(board, car, dieValue, allCars, allChoppers, driftAvailable);
  // "exits-front" (sortie par l'avant du plateau) compte comme une
  // progression valide au même titre que "normal" — en contexte
  // Finish Line, c'est le franchissement de la ligne d'arrivée
  // elle-même (l'issue la plus favorable possible) ; sinon, c'est une
  // avancée vers une tuile future encore inconnue, déjà traitée comme
  // un progrès valable par l'ancien système. Le bonus Road, en
  // revanche, ne s'applique qu'à un arrêt normal SUR la tuile (une
  // sortie de plateau termine déjà le mouvement, rien à prolonger).
  const cleanNormal = candidates.filter((c) => c.terminalReason === "normal" && c.dangerousCellsCrossed === 0);
  const cleanProgress = candidates.filter((c) => (c.terminalReason === "normal" || c.terminalReason === "exits-front") && c.dangerousCellsCrossed === 0);

  // --- Palier 1 : bonus Road, si applicable -------------------------
  let destination = null;
  let roadBonusPath = null;
  if (roadDieValue > 0) {
    const bonusEligible = cleanNormal.filter((c) => c.allRoad);
    const bonusCandidates = [];
    for (const base of bonusEligible) {
      const extCar = { ...car, col: base.col, row: base.row };
      const ext = computeReachableDestinations(board, extCar, roadDieValue, allCars, allChoppers, driftAvailable);
      for (const e of ext) {
        if ((e.terminalReason !== "normal" && e.terminalReason !== "exits-front") || e.dangerousCellsCrossed > 0) continue;
        bonusCandidates.push({ col: e.col, row: e.row, basePath: base.path, extPath: e.path });
      }
    }
    const chosenBonus = pickByTerrainPreference(bonusCandidates, board);
    if (chosenBonus) {
      destination = { col: chosenBonus.col, row: chosenBonus.row, stepsUsed: chosenBonus.basePath.length + chosenBonus.extPath.length, terminalReason: "normal", slamTarget: null, path: chosenBonus.basePath };
      roadBonusPath = chosenBonus.extPath;
    }
  }

  // --- Palier 2 : sans bonus, propre, tous terrains -----------------
  if (!destination && cleanProgress.length > 0) {
    const bestCol = Math.max(...cleanProgress.map((c) => c.col));
    const atBestCol = cleanProgress
      .filter((c) => c.col === bestCol)
      .map((c) => ({ c, danger: arrivalDanger(board, c.col, c.row, allCars) }))
      .sort((a, b) => a.danger - b.danger);
    destination = atBestCol[0].c;
  }

  // --- Palier 3 : chemin forcé (aucune destination propre) ----------
  if (!destination) {
    const anyNormalOrSlam = candidates.filter((c) => c.terminalReason === "normal" || c.terminalReason === "slam" || c.terminalReason === "exits-front");
    if (anyNormalOrSlam.length > 0) {
      const bestCol = Math.max(...anyNormalOrSlam.map((c) => c.col));
      const atBestCol = anyNormalOrSlam.filter((c) => c.col === bestCol);
      const scored = atBestCol.map((c) => ({ c, danger: pathHazardDanger(board, car.col, car.row, c.path, allCars) }));
      const minDanger = Math.min(...scored.map((s) => s.danger));
      const tied = scored.filter((s) => s.danger === minDanger);
      const preferredSlam = tied.find((s) => s.c.terminalReason === "slam" && s.c.slamTarget && SIZE_RANK[s.c.slamTarget.size] < SIZE_RANK[car.size]);
      destination = (preferredSlam || tied[0]).c;
    }
  }

  // --- Palier 4 : dernier recours ------------------------------------
  if (!destination) {
    const notImpassable = candidates.filter((c) => c.terminalReason !== "eliminated-impassable");
    destination = notImpassable.length > 0
      ? notImpassable.reduce((a, b) => (b.col > a.col ? b : a))
      : candidates.reduce((a, b) => (b.stepsUsed > a.stepsUsed ? b : a));
  }

  // --- Reciblage Slam sur l'arc arrière (mécanisme existant, INCHANGÉ,
  // limité aux destinations sans bonus Road — cf. limite documentée
  // en tête de section) ----------------------------------------------
  let slam = destination.terminalReason === "slam";
  if (destination.terminalReason === "normal" && !roadBonusPath) {
    const rearArc = getRearArc({ col: destination.col, row: destination.row });
    for (const r of rearArc) {
      const rearCandidate = candidates.find((c) => c.col === r.col && c.row === r.row && c.terminalReason === "slam");
      if (!rearCandidate || !rearCandidate.slamTarget) continue;
      if (SIZE_RANK[rearCandidate.slamTarget.size] < SIZE_RANK[car.size]) {
        const evalResult = evaluateSlamCandidate(rearCandidate, dieValue, car.size, board);
        if (evalResult.accept) {
          destination = rearCandidate;
          slam = true;
          break;
        }
      }
    }
  }

  const shotTarget = (destination.terminalReason !== "eliminated-impassable" && destination.terminalReason !== "eliminated-edge" && destination.terminalReason !== "eliminated-chopper")
    ? chooseShootTarget(destination.col, destination.row, car.owner, allCars)
    : null;

  return { destination, shotTarget, slam, roadBonusPath };
}

/**
 * Symétrique de chooseGeneralTrajectory pour une voiture qui entre en
 * jeu (car.col === null) — MÊME cascade en 4 paliers (bonus Road >
 * destination propre la plus proche > chemin forcé le moins dangereux
 * > dernier recours), appliquée aux candidats de
 * computeReachableEntryDestinations plutôt qu'à ceux d'une voiture
 * déjà en mouvement. Voir le commentaire de
 * computeReachableEntryDestinations pour le détail de la règle p.9.
 *
 * Ne calcule jamais de shotTarget : le tir n'existe pas sur un tour
 * d'entrée (voir playTurnAssignEnterWithProgression, qui ne résout
 * aucun tir — confirmé par Mayrik, "pas de tir possible au round 1").
 */
function chooseEntryTrajectory(board, car, dieValue, allCars, allChoppers, driftAvailable = false, roadDieValue = 0) {
  const candidates = computeReachableEntryDestinations(board, dieValue, allCars, allChoppers, driftAvailable);
  const cleanNormal = candidates.filter((c) => c.terminalReason === "normal" && c.dangerousCellsCrossed === 0);
  const cleanProgress = candidates.filter((c) => (c.terminalReason === "normal" || c.terminalReason === "exits-front") && c.dangerousCellsCrossed === 0);

  // --- Palier 1 : bonus Road, si applicable -------------------------
  let destination = null;
  let roadBonusPath = null;
  if (roadDieValue > 0) {
    const bonusEligible = cleanNormal.filter((c) => c.allRoad);
    const bonusCandidates = [];
    for (const base of bonusEligible) {
      const extCar = { ...car, col: base.col, row: base.row };
      const ext = computeReachableDestinations(board, extCar, roadDieValue, allCars, allChoppers, driftAvailable);
      for (const e of ext) {
        if ((e.terminalReason !== "normal" && e.terminalReason !== "exits-front") || e.dangerousCellsCrossed > 0) continue;
        bonusCandidates.push({ col: e.col, row: e.row, basePath: base.path, extPath: e.path, entryRow: base.entryRow });
      }
    }
    const chosenBonus = pickByTerrainPreference(bonusCandidates, board);
    if (chosenBonus) {
      destination = { col: chosenBonus.col, row: chosenBonus.row, stepsUsed: chosenBonus.basePath.length + chosenBonus.extPath.length + 1, terminalReason: "normal", slamTarget: null, path: chosenBonus.basePath, entryRow: chosenBonus.entryRow };
      roadBonusPath = chosenBonus.extPath;
    }
  }

  // --- Palier 2 : sans bonus, propre, tous terrains -----------------
  if (!destination && cleanProgress.length > 0) {
    const bestCol = Math.max(...cleanProgress.map((c) => c.col));
    const atBestCol = cleanProgress
      .filter((c) => c.col === bestCol)
      .map((c) => ({ c, danger: arrivalDanger(board, c.col, c.row, allCars) }))
      .sort((a, b) => a.danger - b.danger);
    destination = atBestCol[0].c;
  }

  // --- Palier 3 : chemin forcé (aucune destination propre) ----------
  if (!destination) {
    const anyNormalOrSlam = candidates.filter((c) => c.terminalReason === "normal" || c.terminalReason === "slam" || c.terminalReason === "exits-front");
    if (anyNormalOrSlam.length > 0) {
      const bestCol = Math.max(...anyNormalOrSlam.map((c) => c.col));
      const atBestCol = anyNormalOrSlam.filter((c) => c.col === bestCol);
      const scored = atBestCol.map((c) => ({ c, danger: pathHazardDanger(board, 0, c.entryRow, c.path, allCars) }));
      const minDanger = Math.min(...scored.map((s) => s.danger));
      const tied = scored.filter((s) => s.danger === minDanger);
      const preferredSlam = tied.find((s) => s.c.terminalReason === "slam" && s.c.slamTarget && SIZE_RANK[s.c.slamTarget.size] < SIZE_RANK[car.size]);
      destination = (preferredSlam || tied[0]).c;
    }
  }

  // --- Palier 4 : dernier recours ------------------------------------
  if (!destination) {
    const notImpassable = candidates.filter((c) => c.terminalReason !== "eliminated-impassable");
    destination = notImpassable.length > 0
      ? notImpassable.reduce((a, b) => (b.col > a.col ? b : a))
      : candidates.reduce((a, b) => (b.stepsUsed > a.stepsUsed ? b : a));
  }

  // --- Reciblage Slam sur l'arc arrière (mécanisme existant, INCHANGÉ,
  // limité aux destinations sans bonus Road) --------------------------
  let slam = destination.terminalReason === "slam";
  if (destination.terminalReason === "normal" && !roadBonusPath) {
    const rearArc = getRearArc({ col: destination.col, row: destination.row });
    for (const r of rearArc) {
      const rearCandidate = candidates.find((c) => c.col === r.col && c.row === r.row && c.terminalReason === "slam");
      if (!rearCandidate || !rearCandidate.slamTarget) continue;
      if (SIZE_RANK[rearCandidate.slamTarget.size] < SIZE_RANK[car.size]) {
        const evalResult = evaluateSlamCandidate(rearCandidate, dieValue, car.size, board);
        if (evalResult.accept) {
          destination = rearCandidate;
          slam = true;
          break;
        }
      }
    }
  }

  return { destination, shotTarget: null, slam, roadBonusPath };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { chooseShootTarget, chooseGeneralTrajectory, chooseEntryTrajectory, dangerValueOfCell, chooseBestTrajectory, isCleanPathToDestination, computeShotTargetForDecision });
}

// ===================================================================
// SECTION 4 — RÉPARTITION DES DÉS EN LOTS (niveau round, pas tour)
// ===================================================================
// Traduction de : "Création d'un nombre de lots de dés égal au nombre
// de véhicule Opérable non encore activé. Les lots doivent créer des
// valeurs de dé additionnées les plus équilibrées possible."
// (Coquille "non Opérable" de la version initiale de l'arbre corrigée
// par Mayrik — nombre de lots = véhicules OPÉRABLES non encore
// activés, confirmé.)
//
// Recherche EXHAUSTIVE de la meilleure partition (nombre de dés
// toujours ≤ 5 en pratique — 4 dés de round + jamais plus d'1 dé
// "en trop" possible avant la toute première activation — donc au
// plus 5^lotCount combinaisons dans le pire cas réaliste, trivial).
/**
 * Partitionne un pool de dés en `lotCount` lots dont les SOMMES sont
 * les plus équilibrées possible (écart entre le plus gros et le plus
 * petit lot minimal). Retourne un tableau de `lotCount` tableaux de
 * valeurs de dés (jamais vide : un lot peut recevoir plusieurs dés,
 * mais chaque dé du pool est utilisé exactement une fois au total).
 */
// ===================================================================
// SECTION 3C — RECHERCHE DE LA MEILLEURE TRAJECTOIRE (réécriture v3)
// ===================================================================
// Remplace conceptuellement chooseGeneralTrajectory/chooseEntryTrajectory
// (Section 3B ci-dessus, laissées en place pour l'instant le temps de
// la validation croisée — jamais réutilisées par cette nouvelle
// fonction). Traduction directe du bloc "Recherche de la meilleure
// trajectoire" de l'arbre v3 (docs/Automa ThundeRoadVendetta - arbre
// de décision pour chaque tour de jeu.pdf), validée point par point
// avec Mayrik le 24/08/2026 :
//   - Palier 1 (100% route) : simple test de présence, aucune
//     comparaison — s'il existe, on l'utilise, point final.
//   - Paliers 2 à 6 (route-mixte, off-road, mud, tout-terrain-propre,
//     hazard-dangereux-propre) : chaque palier n'est comparé QU'AU
//     PALIER IMMÉDIATEMENT SUIVANT (pas à une comparaison globale
//     tous paliers confondus) — il gagne s'il progresse STRICTEMENT
//     plus loin que ce palier suivant, sinon on descend d'un cran.
//   - Paliers 7 et 8 (hazard-dangereux même via un autre hazard,
//     n'importe quelle case non-impassable) : présence seule, comme
//     le palier 1.
//   - Dernier recours : trajectoire la plus longue vers une case
//     impassable (toujours un candidat, garantit un résultat).
//   - Cascade BONUS route (si le palier 1 OU 2 a été retenu) : même
//     principe que la cascade principale mais SANS comparaison inter-
//     palier — présence seule à chaque palier (route/off-road/mud),
//     avec refus explicite si aucun ne correspond.
//   - Égalité restante après cascade : départagée par le danger
//     d'arrivée le plus faible (somme des dangers des 6 cases
//     adjacentes, cf. dangerValueOfCell).
//   - Slam en arc arrière : recalculé sur la DESTINATION FINALE
//     (bonus ou non — plus de limitation "seulement sans bonus"),
//     seulement contre un adversaire opérable STRICTEMENT plus petit
//     (pas de cas d'égalité de taille ici, contrairement à
//     evaluateSlamCandidate qui sert à une autre étape de l'arbre).

// dangerousCellsCrossed compte AUSSI la case d'arrivée elle-même (cf.
// doc de computeReachableDestinations : "EN ROUTE, case finale
// incluse") — pour les paliers dont la destination EST un hazard
// dangereux (T6/T7), il faut exclure cette dernière case du calcul
// de "chemin propre", sinon aucune destination hazard ne passerait
// jamais le filtre alors que l'arbre dit explicitement "évitant tous
// les hazards dangereux SUR LE CHEMIN" (donc hors case d'arrivée).
function isCleanPathToDestination(board, candidate) {
  const destSpace = getSpace(board, candidate.col, candidate.row);
  const destIsDangerous = destSpace ? isDangerousCell(destSpace) : false;
  return candidate.dangerousCellsCrossed - (destIsDangerous ? 1 : 0) === 0;
}

function isValidStop(c) {
  return c.terminalReason === "normal" || c.terminalReason === "exits-front";
}

function destinationTerrain(board, c) {
  const space = getSpace(board, c.col, c.row);
  return space ? space.terrain : null;
}

function isHazardDangereuxDestination(board, c) {
  const space = getSpace(board, c.col, c.row);
  return space ? isDangerousCell(space) : false;
}

// Meilleure progression (colonne max) d'un groupe de candidats, ou
// -Infinity si le groupe est vide (permet de comparer sans casse
// particulière pour un palier vide).
function bestProgress(group) {
  if (group.length === 0) return -Infinity;
  return Math.max(...group.map((c) => c.col));
}

// Les 8 paliers de la cascade SANS bonus, dans l'ordre exact de
// l'arbre. `compareToNext: true` = palier "adjacent" (ne gagne que
// s'il bat STRICTEMENT le palier suivant) ; `compareToNext: false` =
// palier "présence seule" (gagne dès qu'il n'est pas vide).
function buildNoBonusTiers(board) {
  return [
    {
      name: "T1_route_pure",
      compareToNext: false,
      predicate: (c) => c.allRoad && destinationTerrain(board, c) === TERRAIN.ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "T2_route_mixte",
      compareToNext: true,
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "T3_offroad",
      compareToNext: true,
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.OFF_ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "T4_mud",
      compareToNext: true,
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.MUD && isCleanPathToDestination(board, c)
    },
    {
      name: "T5_tout_terrain_propre",
      compareToNext: true,
      predicate: (c) =>
        destinationTerrain(board, c) !== TERRAIN.IMPASSABLE &&
        !isHazardDangereuxDestination(board, c) &&
        isCleanPathToDestination(board, c)
    },
    {
      name: "T6_hazard_dangereux_chemin_propre",
      compareToNext: true,
      predicate: (c) => isHazardDangereuxDestination(board, c) && isCleanPathToDestination(board, c)
    },
    {
      name: "T7_hazard_dangereux_meme_via_hazard",
      compareToNext: false,
      predicate: (c) => isHazardDangereuxDestination(board, c)
    },
    {
      name: "T8_nimporte_quelle_case_non_impassable",
      compareToNext: false,
      predicate: (c) => destinationTerrain(board, c) !== TERRAIN.IMPASSABLE
    }
  ];
}

// Cascade bonus (présence seule à chaque palier, pas de comparaison
// inter-palier — confirmé sur l'arbre, contrairement à la cascade
// principale).
function buildBonusTiers(board) {
  return [
    {
      name: "TB1_route_pure",
      predicate: (c) => c.allRoad && destinationTerrain(board, c) === TERRAIN.ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "TB2_route_mixte",
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "TB3_offroad",
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.OFF_ROAD && isCleanPathToDestination(board, c)
    },
    {
      name: "TB4_mud",
      predicate: (c) => destinationTerrain(board, c) === TERRAIN.MUD && isCleanPathToDestination(board, c)
    }
  ];
}

// Applique la cascade "adjacente" (paliers sans-bonus) : renvoie le
// groupe de candidats du palier gagnant, à leur meilleure colonne.
function resolveAdjacentCascade(candidates, tiers) {
  const stops = candidates.filter(isValidStop);
  // Groupe de chaque palier, pré-calculé une fois.
  const groups = tiers.map((t) => stops.filter(t.predicate));
  const bests = groups.map(bestProgress);

  for (let i = 0; i < tiers.length; i++) {
    if (groups[i].length === 0) continue;
    if (!tiers[i].compareToNext) {
      // Présence seule : on prend ce palier, fin de la cascade.
      const best = bests[i];
      return groups[i].filter((c) => c.col === best);
    }
    // Palier "adjacent" : ne gagne que s'il bat STRICTEMENT le
    // suivant. Sinon on continue la boucle (on descend d'un cran).
    if (bests[i] > bests[i + 1]) {
      return groups[i].filter((c) => c.col === bests[i]);
    }
  }

  // Dernier recours garanti par l'arbre : trajectoire la PLUS LONGUE
  // vers une case impassable (jamais vide s'il existe le moindre
  // candidat impassable — sinon la voiture est totalement bloquée,
  // cas dégénéré non couvert par l'arbre, on renvoie []).
  const impassableStops = candidates.filter((c) => c.terminalReason === "eliminated-impassable");
  if (impassableStops.length === 0) return [];
  const longest = Math.max(...impassableStops.map((c) => c.stepsUsed));
  return impassableStops.filter((c) => c.stepsUsed === longest);
}

// Cascade bonus : présence seule à chaque palier, dans l'ordre.
// `null` si aucun palier bonus ne correspond (refus explicite — au
// niveau appelant, on retombe sur les candidats sans bonus).
function resolveBonusCascade(candidates, tiers) {
  const stops = candidates.filter(isValidStop);
  for (const tier of tiers) {
    const group = stops.filter(tier.predicate);
    if (group.length === 0) continue;
    const best = bestProgress(group);
    return group.filter((c) => c.col === best);
  }
  return null;
}

// Départage final entre plusieurs destinations à égalité de
// progression : danger d'arrivée le plus faible (cf. arrivalDanger).
function pickByLowestArrivalDanger(board, group, allCars) {
  if (group.length === 1) return group[0];
  let best = group[0];
  let bestDanger = arrivalDanger(board, best.col, best.row, allCars);
  for (const c of group.slice(1)) {
    const d = arrivalDanger(board, c.col, c.row, allCars);
    if (d < bestDanger) { best = c; bestDanger = d; }
  }
  return best;
}

const CAR_SIZE_RANK = { [CAR_SIZE.SMALL]: 1, [CAR_SIZE.MEDIUM]: 2, [CAR_SIZE.LARGE]: 3 };

// Slam en arc arrière, recalculé sur la DESTINATION FINALE (bonus ou
// non). CORRECTIF (signalé par Mayrik) : une voiture ne se déplace
// JAMAIS directement vers une case de son arc arrière — seul l'arc
// AVANT est atteignable par un mouvement réel. Le retargeting ne
// "téléporte" donc pas vers l'occupant d'une case d'arc arrière
// prise au hasard sur le plateau ; il cherche, PARMI LES CANDIDATS
// DÉJÀ CALCULÉS PAR LA REACHABILITY (`candidatePool` — donc chacun
// atteignable par un vrai chemin avant), celui qui :
//   - tombe justement sur une case de l'arc arrière de la
//     destination autrement choisie (`resolved`) ;
//   - a terminalReason==='slam' (un AUTRE chemin avant, via une
//     autre trajectoire que celle retenue, atterrit justement sur un
//     adversaire) ;
//   - vise un adversaire opérable strictement plus petit.
// Exactement la même idée que l'ancien mécanisme (chooseGeneralTra-
// jectory, ci-dessus) qu'on généralise ici pour s'appliquer aussi à
// la destination finale après un bonus route (en cherchant dans le
// pool de candidats de l'EXTENSION, pas celui de la base — voir
// l'appelant, chooseBestTrajectory).
// Renvoie { destination, slamTarget } — destination est soit
// `resolved` inchangé (aucun retargeting), soit le candidat de
// `candidatePool` retenu (avec son propre chemin réel, directement
// utilisable pour l'exécution).
function resolveRearArcSlam(candidatePool, resolved, car, allCars) {
  if (resolved.terminalReason === "slam") {
    return { destination: resolved, slamTarget: resolved.slamTarget };
  }

  const rearArc = getRearArc({ col: resolved.col, row: resolved.row });
  const myRank = CAR_SIZE_RANK[car.size];

  const rearSlamCandidates = [];
  for (const spot of rearArc) {
    const cand = candidatePool.find((c) => c.col === spot.col && c.row === spot.row && c.terminalReason === "slam");
    if (!cand || !cand.slamTarget) continue;
    if (cand.slamTarget.status !== CAR_STATUS.OPERABLE) continue;
    if (cand.slamTarget.owner === car.owner) continue; // jamais sa propre équipe
    if (CAR_SIZE_RANK[cand.slamTarget.size] < myRank) rearSlamCandidates.push(cand);
  }

  if (rearSlamCandidates.length === 0) {
    return { destination: resolved, slamTarget: null };
  }

  // Priorité au joueur ayant le moins de véhicules opérables ; en
  // cas d'égalité, le véhicule le plus en avant de la course (col
  // la plus grande sur le plateau assemblé courant — même
  // convention que le reste de la cascade).
  const operableCountByOwner = new Map();
  for (const c of allCars) {
    if (c.status !== CAR_STATUS.OPERABLE) continue;
    operableCountByOwner.set(c.owner, (operableCountByOwner.get(c.owner) || 0) + 1);
  }
  let chosen = rearSlamCandidates[0];
  let chosenCount = operableCountByOwner.get(chosen.slamTarget.owner) || 0;
  for (const cand of rearSlamCandidates.slice(1)) {
    const count = operableCountByOwner.get(cand.slamTarget.owner) || 0;
    if (count < chosenCount || (count === chosenCount && cand.col > chosen.col)) {
      chosen = cand; chosenCount = count;
    }
  }

  return { destination: chosen, slamTarget: chosen.slamTarget };
}

/**
 * Fonction UNIFIÉE de recherche de trajectoire — remplace
 * chooseGeneralTrajectory ET chooseEntryTrajectory. Prend une liste
 * de candidats déjà calculée par n'importe quel générateur
 * (computeReachableDestinations ou computeReachableEntryDestinations),
 * peu importe leur origine.
 *
 * @param board
 * @param car - la voiture active (col/row peuvent être null si elle
 *   entre en jeu ce tour ; size/owner toujours nécessaires)
 * @param candidates - candidats déjà calculés (ne recalcule jamais
 *   la reachability de base — seulement l'extension bonus)
 * @param roadDieValue - dé Road disponible pour le bonus (0 si aucun)
 * @param allCars
 * @param allChoppers
 * @param driftAvailable
 */
function chooseBestTrajectory(board, car, candidates, roadDieValue, allCars, allChoppers, driftAvailable = false) {
  const noBonusTiers = buildNoBonusTiers(board);
  const winningGroup = resolveAdjacentCascade(candidates, noBonusTiers);
  if (winningGroup.length === 0) {
    // Aucun candidat exploitable du tout (ne devrait arriver que si
    // `candidates` est vide) — rien à faire.
    return { destination: null, slamTarget: null, roadBonusUsed: false, roadBonusPath: null };
  }

  // Le bonus n'est envisagé que si le palier retenu est T1 (route
  // pure) ou T2 (route mixte) — cf. arbre : la branche bonus part
  // toujours d'une base "destination route".
  const baseWonOnRoad = winningGroup.every((c) => destinationTerrain(board, c) === TERRAIN.ROAD);
  const base = pickByLowestArrivalDanger(board, winningGroup, allCars);
  let roadBonusUsed = false;
  let roadBonusPath = null;
  // Pool de candidats dans lequel chercher un éventuel retargeting
  // Slam en arc arrière — TOUJOURS celui qui a effectivement produit
  // la destination retenue (base ou extension), jamais un autre :
  // un candidat d'un AUTRE pool ne serait pas forcément atteignable
  // avec le budget réellement utilisé pour cette portion du chemin.
  let candidatePoolForRearArc = candidates;
  let resolved = base;

  if (roadDieValue > 0 && baseWonOnRoad) {
    const extensionCar = { ...car, col: base.col, row: base.row };
    const extensionCandidates = computeReachableDestinations(board, extensionCar, roadDieValue, allCars, allChoppers, driftAvailable);
    const bonusTiers = buildBonusTiers(board);
    const bonusGroup = resolveBonusCascade(extensionCandidates, bonusTiers);
    if (bonusGroup !== null) {
      resolved = pickByLowestArrivalDanger(board, bonusGroup, allCars);
      candidatePoolForRearArc = extensionCandidates;
      roadBonusUsed = true;
    }
    // Sinon : refus explicite du bonus, `resolved` reste `base` et
    // on cherche le Slam arc arrière dans les candidats de base.
  }

  const { destination: finalCell, slamTarget } = resolveRearArcSlam(candidatePoolForRearArc, resolved, car, allCars);

  // CORRECTIF (signalé par Mayrik) : le moteur exécute le bonus route
  // en DEUX appels séparés (base puis extension, cf. moveCarWithProgression
  // appelé deux fois côté orchestrateur) — `destination.path` doit donc
  // rester le chemin de BASE uniquement (depuis l'origine réelle),
  // jamais mélangé avec le segment d'extension. Le segment d'extension
  // (ou le Slam retrouvé DANS l'extension) part dans `roadBonusPath`,
  // exactement la convention déjà utilisée par l'ancien
  // chooseGeneralTrajectory.
  let destination;
  if (roadBonusUsed) {
    // entryRow n'existe que sur les candidats d'ENTRÉE (Section 1,
    // computeReachableEntryDestinations) — `finalCell` vient ici du
    // pool d'EXTENSION (toujours computeReachableDestinations,
    // jamais la variante entrée, cf. commentaire plus haut), donc il
    // faut le reporter explicitement depuis `base` (undefined et
    // sans effet si `base` n'est pas une entrée).
    destination = { ...finalCell, path: base.path, entryRow: base.entryRow };
    roadBonusPath = finalCell.path;
  } else {
    destination = finalCell;
  }

  return { destination, slamTarget, roadBonusUsed, roadBonusPath };
}

function partitionIntoBalancedLots(pool, lotCount) {
  if (lotCount <= 0) return [];
  if (lotCount === 1) return [[...pool]];
  if (pool.length < lotCount) {
    // Moins de dés que de lots demandés : cas défensif (ne devrait
    // pas arriver si lotCount reflète bien le nombre de véhicules
    // encore éligibles ce round) — un lot par dé, le reste vide.
    const lots = Array.from({ length: lotCount }, () => []);
    pool.forEach((d, i) => lots[i % lotCount].push(d));
    return lots;
  }

  let best = null;
  let bestSpread = Infinity;

  function search(index, lots) {
    if (index === pool.length) {
      if (lots.some((l) => l.length === 0)) return; // chaque lot doit recevoir au moins 1 dé
      const sums = lots.map((l) => l.reduce((s, v) => s + v, 0));
      const spread = Math.max(...sums) - Math.min(...sums);
      if (spread < bestSpread) {
        bestSpread = spread;
        best = lots.map((l) => [...l]);
      }
      return;
    }
    for (let i = 0; i < lotCount; i++) {
      lots[i].push(pool[index]);
      search(index + 1, lots);
      lots[i].pop();
    }
  }

  search(0, Array.from({ length: lotCount }, () => []));
  return best || Array.from({ length: lotCount }, () => []);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { partitionIntoBalancedLots });
}

// ===================================================================
// SECTION 5 — AIDES DE POSITIONNEMENT (ordre d'équipe, tuile Rear)
// ===================================================================
function isOnRearTile(car, progressionState) {
  return car.col < progressionState.rearTile.cols;
}
function isOnLeadTile(car, progressionState) {
  const leadStart = progressionState.rearTile.cols + progressionState.middleTile.cols;
  const leadEnd = leadStart + progressionState.leadTile.cols;
  return car.col !== null && car.col >= leadStart && car.col < leadEnd;
}
function frontmostEligibleCar(cars) {
  return cars.reduce((best, c) => (c.col > best.col ? c : best));
}
function rearmostEligibleCar(cars) {
  return cars.reduce((best, c) => (c.col < best.col ? c : best));
}
/** Un adversaire (autre owner) est-il en tête de la course, tous joueurs confondus ? */
function isAnyOpponentLeading(myOwner, allCars) {
  const alive = allCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED);
  if (alive.length === 0) return false;
  const leader = findFrontmostCar(alive);
  return leader.owner !== myOwner;
}
/**
 * "Un adversaire est-il premier de la course ? -> Un véhicule de CET
 * adversaire est-il sur la tuile de Lead ?" (étape 5) — l'équipe
 * adverse concernée est celle du LEADER de la course (pas n'importe
 * quel adversaire), et on regarde si UN de ses véhicules (pas
 * forcément le leader lui-même) est sur la tuile Lead.
 */
function isLeadingOpponentOnLeadTile(myOwner, allCars, progressionState) {
  if (!progressionState || !progressionState.middleTile || !progressionState.leadTile) return false;
  const alive = allCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED);
  if (alive.length === 0) return false;
  const leader = findFrontmostCar(alive);
  if (leader.owner === myOwner) return false;
  const leaderTeamCars = allCars.filter((c) => c.owner === leader.owner && c.status !== CAR_STATUS.ELIMINATED);
  return leaderTeamCars.some((c) => isOnLeadTile(c, progressionState));
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    isOnRearTile,
    isOnLeadTile,
    frontmostEligibleCar,
    rearmostEligibleCar,
    isAnyOpponentLeading,
    isLeadingOpponentOnLeadTile
  });
}

// ===================================================================
// SECTION 5bis — DRIFT PRÉVENTIF (mise à jour de l'arbre, branche
// "Finish Line PAS en place" UNIQUEMENT — confirmé par Mayrik)
// ===================================================================
// "La case de départ est-elle bloquée dans son arc avant par 3 cases
// soit impassables soit occupées par des véhicules ?" — dernier
// recours mécanique UNIQUEMENT (cohérent avec le principe déjà établi
// pour Drift : jamais un choix stratégique).
function isFrontArcFullyBlocked(car, board, allCars) {
  const arc = getFrontArc(car);
  return arc.every((a) => {
    const space = getSpace(board, a.col, a.row);
    if (!space) return true; // hors plateau = pas une direction utilisable non plus
    if (space.terrain === TERRAIN.IMPASSABLE) return true;
    return !!getCarAt(allCars, a.col, a.row);
  });
}

/**
 * Vérifie si le Drift s'impose pour CE lot précis (2 dés) et calcule
 * la décision complète correspondante. Retourne null si le Drift ne
 * s'applique pas (arc avant pas bloqué, ou aucun dé 3/4/5 dans le
 * lot) — dans ce cas l'appelant doit retomber sur le flux normal
 * (decideCommandForActivatedCar).
 *
 * Trois issues possibles, traduites de l'arbre (confirmées par
 * Mayrik) :
 *   A. Le lot n'a qu'1 dé (jamais de "deuxième dé") -> pas de Drift
 *      possible ici (il faut les 2 dés du lot : 1 pour Drift, 1 pour
 *      le mouvement) -> null, flux normal.
 *   B. Deuxième dé (l'autre du lot) ≠ 1 -> Drift avec le plus petit
 *      dé de valeur 3/4/5 disponible + mouvement avec l'autre dé.
 *   C. Deuxième dé == 1 -> le Drift ne changerait rien (avancer d'une
 *      seule case déclenche quand même le Slam) :
 *      C1. Pas le dernier tour du round -> on accepte le Slam
 *          MAINTENANT avec le petit dé (1), SANS Command, et on
 *          laisse le gros dé (3/4/5) DANS LE POOL pour un tour
 *          ultérieur (jamais consommé ce tour-ci).
 *      C2. Dernier tour du round -> Airstrike avec le petit dé (1,
 *          convention "dé restant le plus petit sur Airstrike" déjà
 *          établie ailleurs dans l'arbre), mouvement avec l'autre dé
 *          (3/4/5) — la valeur exacte du dé de mouvement n'a pas
 *          d'impact tactique ici puisque l'arc avant est bloqué dans
 *          les 3 directions quel que soit le budget.
 */
function decideDriftForLot(car, board, allCars, lot, isLastTurnOfRound) {
  if (!isFrontArcFullyBlocked(car, board, allCars)) return null;

  const driftEligibleValues = lot.filter((v) => v >= 3 && v <= 5);
  if (driftEligibleValues.length === 0) return null; // retombe sur "6 disponible ? -> Repair..." (confirmé par Mayrik)
  if (lot.length < 2) return null; // pas de "deuxième dé" pour le mouvement

  const driftDie = Math.min(...driftEligibleValues);
  const remaining = [...lot];
  remaining.splice(remaining.indexOf(driftDie), 1);
  const secondDie = remaining[0];

  if (secondDie !== 1) {
    return { command: { type: "drift", dieValue: driftDie }, movementDie: secondDie, reserveDie: null };
  }

  if (!isLastTurnOfRound) {
    // Le gros dé (3/4/5) reste dans le pool, non consommé ce tour —
    // sera repris naturellement au recalcul du lot du tour suivant.
    return { command: null, movementDie: 1, reserveDie: driftDie };
  }

  // Dernier tour du round : le Drift ne sert plus à rien à réserver
  // pour "plus tard" (il n'y a plus de tour suivant) -> Airstrike.
  return { command: { type: "airstrike-pending", dieValue: 1 }, movementDie: driftDie, reserveDie: null };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { isFrontArcFullyBlocked, decideDriftForLot });
}

// ===================================================================
// SECTION 6 — COMMAND POUR UNE VOITURE ACTIVÉE (Repair, réservation
// du 6 — étape 5)
// ===================================================================
// GARDE-FOU : une seule Command par round, jamais deux (règle
// absolue du jeu, rulebook p.8 "ONCE PER ROUND", confirmé) — géré
// par `commandUsedThisRound`, testé par l'appelant (étape 4).
//
// CORRECTIF (étape 5, en relisant l'arbre en détail) : la version
// précédente déclenchait Repair dès qu'un 6 traînait dans les dés
// RESTANTS DU LOT COURANT (dicePoolRemaining) — ce n'est PAS ce que
// dit le document source. Le document réserve le 6 AU NIVEAU DU
// POOL ENTIER, AVANT même la construction des lots (voir
// reserveRepairSix, appelée par decideNoFinishLine) : "Il y a-t-il un
// véhicule inopérable dans l'équipe ET un 6 disponible ?" -> le 6 est
// mis de côté, n'entre PAS dans le partitionnement en lots, et est
// ensuite affecté au Repair via ce module — indépendamment de la
// taille du lot du véhicule activé ce tour (contrairement à
// Nitro/Airstrike, qui eux ont besoin d'un deuxième dé DANS le lot).
/** "Un des véhicules Inopérable de l'équipe est-il en tête de course ?" -> Repair celui en tête, sinon le plus en arrière. */
function decideRepairTarget(myInoperableCars, myOperableCars) {
  const alive = myInoperableCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED);
  const allAliveOfMine = [...myOperableCars, ...alive].filter((c) => c.status !== CAR_STATUS.ELIMINATED);
  const myFrontmost = frontmostEligibleCar(allAliveOfMine);
  const anInoperableIsLeading = alive.some((c) => c === myFrontmost);
  return anInoperableIsLeading ? myFrontmost : rearmostEligibleCar(alive);
}

/** "Il y a-t-il un véhicule inopérable dans l'équipe ET un 6 disponible [dans le pool] ?" */
function reserveRepairSix(myPool, myInoperableCars) {
  const hasAliveInoperable = myInoperableCars.some((c) => c.status !== CAR_STATUS.ELIMINATED);
  return hasAliveInoperable && myPool.includes(6);
}

/** Retire UNE occurrence de `value` d'une copie du pool (jamais le tableau d'origine). */
function poolMinusOne(pool, value) {
  const copy = [...pool];
  const idx = copy.indexOf(value);
  if (idx !== -1) copy.splice(idx, 1);
  return copy;
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideRepairTarget, reserveRepairSix, poolMinusOne });
}

// ===================================================================
// SECTION 6bis — NITRO OU AIRSTRIKE POUR LE LOT (étape 5)
// ===================================================================
// Suite du sous-arbre "Commande pas encore jouée", UNIQUEMENT quand
// ni Drift (arc avant bloqué) ni Repair (6 réservé) ne s'appliquent
// ce tour : "Cette voiture est-elle sur la tuile Rear OU est-elle la
// plus en arrière de l'équipe, ET un dé entre 1 et 3 est-il
// disponible dans le lot ?"
//   OUI -> Nitro (dé le plus gros ≤3 en Command, l'autre dé du lot
//          au mouvement — déjà le dé de mouvement par défaut).
//   NON -> "Un adversaire est-il premier de la course ?" ->
//          "Un véhicule de CET adversaire est-il sur la tuile de
//          Lead ?" -> OUI : Airstrike IMMÉDIAT (le "dernier tour du
//          round ?" n'est même pas regardé). NON (ou pas d'adversaire
//          en tête) -> "Dernier tour du round ?" -> OUI : Airstrike
//          quand même (petit dé en Command, gros dé au mouvement —
//          même répartition que le cas Lead) -> NON : on REPORTE — le
//          gros dé retourne (virtuellement) dans le pool, seul le
//          petit dé sert au mouvement, aucune Command ce tour-ci.
// Renvoie toujours movementDie ET deferMovementDie (le dé à utiliser
// si l'appelant doit finalement retomber sur le report — cas où le
// placement Airstrike s'avère impossible faute de case valide).
function decideNitroOrAirstrikeForLot(car, progressionState, myOperableCars, biggestLot, movementDie, allCars, playerName, isLastTurnOfRound) {
  const remainingDiceForCommand = poolMinusOne(biggestLot, movementDie);
  if (remainingDiceForCommand.length === 0) {
    return { command: null, movementDie, deferMovementDie: movementDie };
  }

  // --- Nitro ---
  const isRearmostOfMyTeam = myOperableCars.length > 0 && car === rearmostEligibleCar(myOperableCars);
  const eligiblePosition = isOnRearTile(car, progressionState) || isRearmostOfMyTeam;
  const nitroDice = remainingDiceForCommand.filter((v) => v >= 1 && v <= 3);
  if (eligiblePosition && nitroDice.length > 0) {
    return { command: { type: "nitro", dieValue: Math.max(...nitroDice) }, movementDie, deferMovementDie: movementDie };
  }

  // --- Airstrike (immédiat) ou report ---
  const smallDie = Math.min(...remainingDiceForCommand);
  const leadingOpponentOnLead = isLeadingOpponentOnLeadTile(playerName, allCars, progressionState);

  if (leadingOpponentOnLead || isLastTurnOfRound) {
    const enemies = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
    const target = enemies.length > 0 ? findFrontmostCar(enemies) : null;
    if (target) {
      return { command: { type: "airstrike-pending", dieValue: smallDie, target }, movementDie, deferMovementDie: smallDie };
    }
  }

  // Report : "Plus gros dé du lot retiré du lot est remis dans la
  // pôle de dés. Plus petit dé du lot Assigné au mouvement." — le
  // gros dé n'est simplement jamais consommé (rien à faire côté pool
  // réel, seul movementDie change ici) ; il réapparaîtra naturellement
  // au recalcul du tour suivant.
  return { command: null, movementDie: smallDie, deferMovementDie: smallDie };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideNitroOrAirstrikeForLot });
}

// ===================================================================
// SECTION 7 — ATTRIBUTION DU PLUS GROS LOT (branches 3 et 2 véhicules)
// ===================================================================
// Traduction du sous-arbre partagé entre les branches "3" et "2" :
// "La voiture opérable la plus à l'arrière de l'équipe est-elle sur
// la tuile Rear ?" -> OUI: cette voiture reçoit le plus gros lot.
// -> NON: "Ce joueur IA a-t-il un véhicule opérable en tête de la
// course ?" -> OUI: "Une voiture adverse est-elle à moins de 6 cases
// du véhicule en tête ?" -> OUI: le véhicule EN TÊTE reçoit le plus
// gros lot (consolider l'avance sous pression) -> NON: le véhicule le
// PLUS EN ARRIÈRE reçoit le plus gros lot (rattraper, pas de pression
// immédiate). -> NON (pas en tête) : le plus en arrière reçoit le
// plus gros lot (même fallback).
//
// NOTE IMPORTANTE : ce nœud "en tête de la course ?" est DISTINCT de
// celui utilisé plus haut (section Finish-Line-rush) pour l'ordre
// d'activation simple à 1 dé — ici, il gouverne quelle voiture reçoit
// le LOT le plus gros (contexte différent), pas juste quel dé.
function chooseLotRecipient(myOperableCars, allCars, progressionState) {
  const rearmost = rearmostEligibleCar(myOperableCars);
  if (isOnRearTile(rearmost, progressionState)) {
    return rearmost;
  }

  const myFrontmost = frontmostEligibleCar(myOperableCars);
  const iAmLeading = !isAnyOpponentLeading(myFrontmost.owner, allCars);
  if (iAmLeading) {
    const opponents = allCars.filter((c) => c.owner !== myFrontmost.owner && c.status !== CAR_STATUS.ELIMINATED);
    const opponentWithin6 = opponents.some((c) => Math.abs(myFrontmost.col - c.col) < 6);
    return opponentWithin6 ? myFrontmost : rearmost;
  }
  return rearmost;
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { chooseLotRecipient });
}

// ===================================================================
// SECTION 6bis — "Commande déjà jouée ce round" (branche dédiée,
// "Finish Line PAS en place" — étape 4)
// ===================================================================
// Traduction directe du sous-arbre dédié (distinct de chooseLotRecipient
// ci-dessus) : "La voiture la plus à l'arrière de l'équipe [parmi les
// non-encore-activées] est-elle sur la tuile Rear ?" -> OUI: cette
// voiture reçoit le plus gros dé DISPONIBLE DANS LE POOL (pas de lot).
// -> NON: "Ce joueur IA a-t-il un véhicule en tête de la course ?" ->
// OUI: le véhicule le plus À L'ARRIÈRE reçoit quand même le plus gros
// dé (même case que la branche Rear=OUI, confirmé par la convergence
// des deux flèches vertes sur le document source) -> NON: le véhicule
// jouable le plus EN AVANT reçoit le plus gros dé.
//
// Différences volontaires avec chooseLotRecipient (arbre "lot pas
// encore attribué") : pas de nuance "adversaire à moins de 6 cases"
// ici, et pas de partitionIntoBalancedLots — un seul dé (le plus gros
// du pool restant) est directement assigné, jamais un lot.
function chooseCommandAlreadyUsedRecipient(notYetActivated, myOperableCars, allCars, progressionState) {
  const rearmostNotYetActivated = rearmostEligibleCar(notYetActivated);
  if (isOnRearTile(rearmostNotYetActivated, progressionState)) {
    return rearmostNotYetActivated;
  }

  const myFrontmost = frontmostEligibleCar(myOperableCars);
  const iAmLeading = !isAnyOpponentLeading(myFrontmost.owner, allCars);
  if (iAmLeading) {
    return rearmostNotYetActivated;
  }
  return frontmostEligibleCar(notYetActivated);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { chooseCommandAlreadyUsedRecipient });
}

// ===================================================================
// SECTION 7bis — ORCHESTRATEUR : "Premier round du jeu" (étape 3)
// ===================================================================
// Traduction directe de la branche dédiée au round 1 (racine de
// l'arbre : "Est-ce le premier round du jeu ?" → OUI), validée avec
// Mayrik le 24/08/2026 après mise à jour du document — ENTIÈREMENT
// autonome, ne recoupe aucune autre branche (ni le sous-arbre
// Command/Lot de decideNoFinishLine, ni la Finish Line Rush).
//
// CORRECTIF IMPORTANT trouvé en écrivant cette étape : le round 1
// passait auparavant par `decideAssignAndCommand` → `decideNoFinishLine`
// (seul critère de branchement testé : présence de la Finish Line),
// donc par le sous-arbre Command/Lot bien plus riche prévu pour les
// rounds SUIVANTS (évaluation Repair/Nitro/Drift/Airstrike selon la
// situation) — jamais par cette branche round-1 dédiée, bien plus
// simple. Historiquement la source de bugs la plus concrète pointée
// par Mayrik dans le plan ; cause racine identifiée : `decideAssign-
// AndCommand` ne testait jamais `roundState.roundNumber === 1`.
//
// Séquence (une seule Command possible : Nitro OU Airstrike, jamais
// les deux, jamais Repair/Drift qui n'ont pas de sens pour un
// véhicule qui n'est pas encore entré) :
//   1. Lots de dés équilibrés par somme, un par véhicule opérable pas
//      encore activé ce round (réutilise partitionIntoBalancedLots,
//      Section 4, déjà conçue pour ce cas précis).
//   2. Lot à la plus forte somme → véhicule opérable non encore
//      activé le PLUS GROS (par taille — pas par position, ambigu
//      pour des véhicules tous hors plateau ; confirmé par Mayrik).
//   3. Lot à 1 dé : simple entrée, pas de Command.
//      Lot à 2 dés : un des deux sert TOUJOURS au mouvement ; l'autre
//      sert à une Command —
//        - si au moins un des deux dés vaut 1, 2 ou 3 : Nitro avec le
//          PLUS GROS des dés éligibles (1-3), l'autre au mouvement.
//        - sinon (aucun des deux ne vaut 1-3, donc Nitro impossible) :
//          Airstrike avec le PLUS PETIT dé du lot, l'autre au
//          mouvement — chopper placé juste devant le véhicule adverse
//          opérable le plus en avant de la course.
//   4. Recherche de la meilleure trajectoire (même cascade unifiée
//      que partout ailleurs, Section 3C) avec le dé de mouvement
//      retenu (+ bonus Nitro s'il y a lieu), puis mouvement.
function decideFirstRound(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) return null;

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const notYetActivated = myOperableCars.filter((c) => !c.movedThisRound);
  if (notYetActivated.length === 0) return null;

  const lots = partitionIntoBalancedLots(myPool, notYetActivated.length);
  const lotSums = lots.map((l) => l.reduce((s, v) => s + v, 0));
  const lot = lots[lotSums.indexOf(Math.max(...lotSums))];

  // Véhicule opérable non encore activé le plus GROS (jamais d'égalité
  // possible : chaque équipe a exactement 1 Small/1 Medium/1 Large).
  const car = notYetActivated.reduce((best, c) => (CAR_SIZE_RANK[c.size] > CAR_SIZE_RANK[best.size] ? c : best));

  let command = null;
  let movementDieValue;

  if (lot.length === 2) {
    const nitroEligible = lot.filter((v) => v >= 1 && v <= 3);
    if (nitroEligible.length > 0) {
      const nitroDie = Math.max(...nitroEligible);
      const nitroIndex = lot.indexOf(nitroDie);
      movementDieValue = lot[1 - nitroIndex];
      command = { type: "nitro", dieValue: nitroDie };
    } else {
      const airstrikeDie = Math.min(...lot);
      const airstrikeIndex = lot.indexOf(airstrikeDie);
      const otherDie = lot[1 - airstrikeIndex];
      const enemiesOperable = allCars.filter((c) => c.owner !== playerName && c.status === CAR_STATUS.OPERABLE);
      let placement = null, target = null;
      if (enemiesOperable.length > 0) {
        target = findFrontmostCar(enemiesOperable);
        placement = findAiAirstrikePlacement(board, target, allCars, allChoppers);
      }
      if (placement) {
        command = { type: "airstrike", dieValue: airstrikeDie, target, placement };
        movementDieValue = otherDie;
      } else {
        // Aucun ennemi opérable ou aucun placement possible : rien
        // dans l'arbre ne couvre ce cas — fallback défensif, jamais
        // laisser un dé du lot inutilisé. Pas de Command, le plus
        // gros des deux dés part au mouvement (comme un lot à 1 dé
        // aurait utilisé son seul dé).
        movementDieValue = Math.max(...lot);
      }
    }
  } else {
    movementDieValue = lot[0];
  }

  const effectiveDieValue = command && command.type === "nitro" ? movementDieValue + command.dieValue : movementDieValue;
  const entryCandidates = computeReachableEntryDestinations(board, effectiveDieValue, allCars, allChoppers, false);
  const traj = chooseBestTrajectory(board, car, entryCandidates, roundState.roadDie || 0, allCars, allChoppers, false);

  return {
    car,
    dieValue: movementDieValue,
    command,
    destination: traj.destination,
    isEntry: true,
    isCoast: false,
    slam: !!traj.slamTarget,
    roadBonusPath: traj.roadBonusPath
  };
}

// ===================================================================
// SECTION 7ter — COAST : cible Slam sur l'arc avant (partagée entre
// "Finish Line pas en place" et "Finish Line Rush" — étape 6)
// ===================================================================
// CORRECTIF (étape 6, en relisant l'arbre pour la branche Finish Line
// Rush) : le document précise, pour CHAQUE branche Coast (pas
// seulement celle de Finish Line Rush — le même nœud existe aussi
// pour "Finish Line pas en place", jusqu'ici jamais implémenté) :
// "Il y a-t-il un véhicule adverse opérable strictement plus petit
// dans l'arc avant de la case actuelle du véhicule ?" -> OUI : ce
// véhicule adverse est défini comme destination (Slam direct,
// délibéré) -> NON : Recherche de la meilleure trajectoire (flux
// normal). L'ancien code des deux branches Coast ignorait ce nœud et
// laissait le Slam éventuel émerger (ou non) du hasard de la cascade
// normale de `computeReachableDestinations`.
/** "Un véhicule adverse opérable strictement plus petit est-il dans l'arc avant ?" -> ce véhicule, sinon null. */
function findFrontArcSlamTarget(car, allCars) {
  const arc = getFrontArc(car);
  const myRank = CAR_SIZE_RANK[car.size];
  for (const spot of arc) {
    const occupant = getCarAt(allCars, spot.col, spot.row);
    if (!occupant) continue;
    if (occupant.owner === car.owner) continue;
    if (occupant.status !== CAR_STATUS.OPERABLE) continue;
    if (CAR_SIZE_RANK[occupant.size] < myRank) return occupant;
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { findFrontArcSlamTarget });
}

// ===================================================================
// SECTION 8 — ORCHESTRATEUR : "Finish Line PAS encore en place"
// ===================================================================
// Traduction de la branche gauche de l'arbre (compteur "combien de
// véhicules opérables et non activés ce round reste-t-il ?" -> 3/2/1/0).
//
// Retourne la même forme que l'ancien système pour rester compatible
// avec l'orchestrateur de partie (playOneAiTurn) : { car, dieValue,
// command, destination, shotTarget, isEntry, isCoast }.
function decideNoFinishLine(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) return null;

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const myInoperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.INOPERABLE);
  const notYetActivated = myOperableCars.filter((c) => !c.movedThisRound);
  const n = notYetActivated.length;

  // --- Branche 0 : Coast ---
  // "C'est un Coast = on attribue un dé au hasard au véhicule
  // opérable le plus en arrière de l'équipe et il vaut 1."
  // CORRECTIF (étape 6) : le nœud "un véhicule adverse opérable
  // strictement plus petit est-il dans l'arc avant ?" -> Slam direct
  // était jusqu'ici ignoré (voir findFrontArcSlamTarget, Section 7ter)
  // — le Coast retombait sur la cascade normale de destinations, où
  // un Slam pouvait émerger par hasard mais n'était jamais visé
  // délibérément comme le prescrit l'arbre.
  if (n === 0) {
    const eligibleForCoast = myOperableCars.filter((c) => c.coastCount < 2);
    if (eligibleForCoast.length === 0) return null; // plus aucun tour possible ce round pour ce joueur
    const car = rearmostEligibleCar(eligibleForCoast);
    const dieValue = myPool[0]; // "il vaut 1" = distance fixe, la face du dé physique importe peu
    const dests = computeReachableDestinations(board, car, 1, allCars, allChoppers);
    const slamTarget = findFrontArcSlamTarget(car, allCars);
    let destination;
    if (slamTarget) {
      destination = dests.find((d) => d.terminalReason === "slam" && d.slamTarget === slamTarget)
        || dests.find((d) => d.terminalReason === "normal" || d.terminalReason === "eliminated-impassable" || d.terminalReason === "exits-front")
        || dests[0];
    } else {
      destination = dests.find((d) => d.terminalReason === "normal" || d.terminalReason === "eliminated-impassable" || d.terminalReason === "slam" || d.terminalReason === "exits-front") || dests[0];
    }
    return { car, dieValue, command: null, destination, isEntry: false, isCoast: true, slam: destination.terminalReason === "slam" };
  }

  const commandAlreadyUsed = !!roundState.commandUsedThisRound[playerName];

  // --- Étape 4 : Command déjà jouée ce round — branche dédiée,
  // ENTIÈREMENT distincte de la construction de lots ci-dessous (pas
  // de partitionIntoBalancedLots, pas de Drift/Command à évaluer :
  // déjà joués ce round). Un seul dé, le plus gros DISPONIBLE DANS LE
  // POOL, est directement assigné à la voiture choisie.
  if (commandAlreadyUsed) {
    const car = chooseCommandAlreadyUsedRecipient(notYetActivated, myOperableCars, allCars, progressionState);
    const movementDieFinal = Math.max(...myPool);

    let destination, slam, roadBonusPath;
    if (car.col === null) {
      const traj = chooseEntryTrajectory(board, car, movementDieFinal, allCars, allChoppers, false, roundState.roadDie || 0);
      destination = traj.destination;
      slam = traj.slam;
      roadBonusPath = traj.roadBonusPath;
    } else {
      const traj = chooseGeneralTrajectory(board, car, movementDieFinal, allCars, allChoppers, false, roundState.roadDie || 0);
      destination = traj.destination;
      slam = traj.slam;
      roadBonusPath = traj.roadBonusPath;
    }

    return {
      car,
      dieValue: movementDieFinal,
      command: null,
      destination,
      isEntry: car.col === null,
      isCoast: false,
      slam,
      roadBonusPath
    };
  }

  // --- Branches 1/2/3 (Command pas encore jouée) : réservation
  // éventuelle du 6 pour Repair AVANT la construction des lots (étape
  // 5 — corrige la version précédente qui cherchait le 6 dans le lot
  // DÉJÀ construit, alors que le document le réserve au niveau du
  // pool ENTIER, en amont de tout partitionnement).
  const repairSixReserved = reserveRepairSix(myPool, myInoperableCars);
  const poolForLots = repairSixReserved ? poolMinusOne(myPool, 6) : [...myPool];

  const lotCount = n;
  const lots = partitionIntoBalancedLots(poolForLots, lotCount);
  const lotsBySum = lots.map((l) => l.reduce((s, v) => s + v, 0));
  const biggestLotIndex = lotsBySum.indexOf(Math.max(...lotsBySum));
  const biggestLot = lots[biggestLotIndex];

  let car;
  if (n === 1) {
    car = notYetActivated[0];
  } else {
    // Branches 2 et 3 : même sous-arbre (Rear ? -> en tête ? -> ...).
    car = chooseLotRecipient(notYetActivated, allCars, progressionState);
  }

  const movementDie = Math.max(...biggestLot);
  let command = null;
  let actualMovementDie = movementDie;
  let driftBlockHandledThisTurn = false;

  if (car.col !== null) {
    // Le pré-check Drift ne s'applique qu'aux voitures déjà sur le
    // plateau (une entrée round 1 n'a pas d'"arc avant" figé à
    // vérifier de la même façon) et uniquement à cette branche
    // "Finish Line pas en place" (confirmé par Mayrik).
    const driftDecision = decideDriftForLot(car, board, allCars, biggestLot, ((roundState.turnsThisRound && roundState.turnsThisRound[playerName]) || 0) === 2);
    if (driftDecision) {
      driftBlockHandledThisTurn = true;
      if (driftDecision.command && driftDecision.command.type === "airstrike-pending") {
        const enemies = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
        const target = enemies.length > 0 ? findFrontmostCar(enemies) : null;
        const placement = target ? findAiAirstrikePlacement(board, target, allCars, allChoppers) : null;
        command = placement ? { type: "airstrike", dieValue: driftDecision.command.dieValue, target, placement } : null;
      } else {
        command = driftDecision.command;
      }
      actualMovementDie = driftDecision.movementDie;
      // driftDecision.reserveDie (le gros dé non consommé, cas C1) :
      // aucune action explicite nécessaire — l'architecture recalcule
      // déjà les lots à chaque tour depuis le pool RESTANT, donc ce
      // dé y réapparaîtra naturellement au tour suivant (et le 6
      // réservé ce tour-ci, s'il n'a pas servi, sera lui aussi
      // re-détecté au recalcul du tour suivant : rien n'a jamais été
      // réellement retiré de `myPool`).
    }
  }

  if (!driftBlockHandledThisTurn) {
    // (commandAlreadyUsed est nécessairement false ici : la branche
    // dédiée à l'étape 4 a déjà retourné dans le cas contraire.)
    if (repairSixReserved) {
      // Repair : le 6 (réservé en amont, hors lot) + le dé de
      // mouvement déjà calculé sur le pool SANS ce 6 — contrairement
      // à Nitro/Airstrike, Repair n'a PAS besoin d'un deuxième dé
      // dans le lot du véhicule activé (ressource indépendante).
      const target = decideRepairTarget(myInoperableCars, myOperableCars);
      command = { type: "repair", dieValue: 6, target };
    } else {
      const isLastTurnOfRound = ((roundState.turnsThisRound && roundState.turnsThisRound[playerName]) || 0) === 2;
      const result = decideNitroOrAirstrikeForLot(car, progressionState, myOperableCars, biggestLot, actualMovementDie, allCars, playerName, isLastTurnOfRound);
      if (result.command && result.command.type === "airstrike-pending") {
        const placement = findAiAirstrikePlacement(board, result.command.target, allCars, allChoppers);
        if (placement) {
          command = { type: "airstrike", dieValue: result.command.dieValue, target: result.command.target, placement };
          actualMovementDie = result.movementDie;
        } else {
          // Aucune case de placement valide : on retombe sur le
          // report (même comportement que "pas d'adversaire à
          // frapper").
          command = null;
          actualMovementDie = result.deferMovementDie;
        }
      } else {
        command = result.command;
        actualMovementDie = result.movementDie;
      }
    }
  }
  const movementDieFinal = actualMovementDie;

  let effectiveDieValue = movementDieFinal;
  if (command && command.type === "nitro") effectiveDieValue += command.dieValue;

  let destination, slam, roadBonusPath;
  if (car.col === null) {
    // Entrée en jeu (p.9) — CORRECTIF : auparavant codée en dur sur
    // la seule case d'entrée (stepsUsed:0, sans suite de trajectoire),
    // ce qui faisait perdre tout mouvement restant à chaque entrée.
    // Utilise maintenant la même exploration/cascade que le mouvement
    // normal (voir chooseEntryTrajectory), avec le dé effectif
    // (Nitro éventuel inclus, comme pour une voiture déjà en jeu).
    const driftActive = !!(command && command.type === "drift");
    const traj = chooseEntryTrajectory(board, car, effectiveDieValue, allCars, allChoppers, driftActive, roundState.roadDie || 0);
    destination = traj.destination;
    slam = traj.slam;
    roadBonusPath = traj.roadBonusPath;
  } else {
    const driftActive = !!(command && command.type === "drift");
    const traj = chooseGeneralTrajectory(board, car, effectiveDieValue, allCars, allChoppers, driftActive, roundState.roadDie || 0);
    destination = traj.destination;
    slam = traj.slam;
    roadBonusPath = traj.roadBonusPath;
  }

  return {
    car,
    dieValue: movementDieFinal,
    command,
    destination,
    isEntry: car.col === null,
    isCoast: false,
    slam,
    roadBonusPath
  };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideNoFinishLine });
}

// ===================================================================
// SECTION 9 — ORCHESTRATEUR : "Finish Line EN PLACE" (course à l'arrivée)
// ===================================================================
// Traduction de la branche haute de l'arbre. Réutilise la même
// couche de reachability — la seule différence est l'OBJECTIF
// (atteindre la ligne d'arrivée en priorité) et l'ordre des
// vérifications (Nitro puis Drift puis Airstrike par défaut).
function canReachFinishLine(destinations, finishColStart) {
  return destinations.some((d) => (d.terminalReason === "normal" || d.terminalReason === "exits-front") && d.col >= finishColStart);
}

function decideFinishLineRush(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) return null;
  const finishColStart = progressionState.rearTile.cols + progressionState.middleTile.cols + progressionState.leadTile.cols;

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const notYetActivated = myOperableCars.filter((c) => !c.movedThisRound);

  // --- Coast (n=0) --- RÉÉCRIT (étape 6). Deux points relus avec
  // Mayrik après ma première lecture du document :
  // (1) la voiture est bien la plus EN AVANT de l'équipe
  // (frontmostEligibleCar), comme l'ancien code le faisait déjà —
  // le document contenait une erreur de copier/coller à ce nœud
  // précis (texte "en arrière" au lieu de "en avant", confirmé par
  // Mayrik, correction prévue de son côté sur le PDF) ;
  // (2) le nœud "un véhicule adverse opérable strictement plus petit
  // est-il dans l'arc avant ?" (Slam direct, voir
  // findFrontArcSlamTarget, Section 7ter) est en revanche un AJOUT
  // volontaire de cette nouvelle version de l'arbre (confirmé par
  // Mayrik) — absent de l'ancien code v2, qui se contentait de
  // chercher la case "normal" la moins dangereuse. La nuance "adversaire
  // à moins de 2 cases de la ligne d'arrivée ?" annule le Slam pour ne
  // pas risquer de le pousser sur (ou au-delà de) la ligne d'arrivée.
  if (notYetActivated.length === 0) {
    const eligibleForCoast = myOperableCars.filter((c) => c.coastCount < 2);
    if (eligibleForCoast.length === 0) return null; // plus aucun tour possible ce round pour ce joueur
    const car = frontmostEligibleCar(eligibleForCoast);
    const dieValue = myPool[0]; // "il vaut 1" = distance fixe, la face du dé physique importe peu
    const dests = computeReachableDestinations(board, car, 1, allCars, allChoppers);
    const slamTarget = findFrontArcSlamTarget(car, allCars);
    let destination;
    if (slamTarget && (finishColStart - slamTarget.col) >= 2) {
      destination = dests.find((d) => d.terminalReason === "slam" && d.slamTarget === slamTarget)
        || dests.find((d) => d.terminalReason === "normal" || d.terminalReason === "eliminated-impassable" || d.terminalReason === "exits-front")
        || dests[0];
    } else {
      destination = dests.find((d) => d.terminalReason === "normal" || d.terminalReason === "eliminated-impassable" || d.terminalReason === "slam" || d.terminalReason === "exits-front") || dests[0];
    }
    return { car, dieValue, command: null, destination, isEntry: false, isCoast: true, slam: destination.terminalReason === "slam" };
  }

  // --- "On assigne le dé le plus gros à la voiture de cette équipe
  // la plus en avant de la course n'ayant pas encore été activée ce
  // round." Un seul dé, jamais un lot (même principe qu'à l'étape 4).
  // La Finish Line, une fois en place, reste en place pour le reste
  // de la partie : cette branche ne redescend JAMAIS vers
  // decideNoFinishLine.
  const car = frontmostEligibleCar(notYetActivated);
  const biggestDie = Math.max(...myPool);

  // Cas limite quasi jamais atteint en pratique (toutes les voitures
  // entrent normalement bien avant l'apparition de la Finish Line,
  // dès le round 1) — entrée normale, sans acrobaties de Command pour
  // rallier directement la ligne (pas de sens tant que la voiture n'a
  // pas encore mis une roue sur le plateau).
  if (car.col === null) {
    const traj = chooseEntryTrajectory(board, car, biggestDie, allCars, allChoppers, false, roundState.roadDie || 0);
    return { car, dieValue: biggestDie, command: null, destination: traj.destination, isEntry: true, isCoast: false, slam: traj.slam, roadBonusPath: traj.roadBonusPath };
  }

  // "Recherche de la meilleure trajectoire" (dé assigné seul) ->
  // "Atteindra-t-on la ligne d'arrivée avec cette destination ?"
  const baseTraj = chooseGeneralTrajectory(board, car, biggestDie, allCars, allChoppers, false, roundState.roadDie || 0);
  if (baseTraj.destination.col >= finishColStart) {
    // Cas simple : on peut déjà l'atteindre avec le seul dé assigné —
    // aucune Command, aucune autre considération (arbre : ce nœud ne
    // mène qu'à "Phase de Mouvement" direct).
    return { car, dieValue: biggestDie, command: null, destination: baseTraj.destination, isEntry: false, isCoast: false, slam: baseTraj.slam, roadBonusPath: baseTraj.roadBonusPath };
  }

  const commandAlreadyUsed = !!roundState.commandUsedThisRound[playerName];
  let command = null;
  let dieValueFinal = biggestDie; // peut être remplacé par le plus petit dé du pôle (cas "blocage sans 3/4/5, pas dernier tour")
  let destination = baseTraj.destination;
  let slam = baseTraj.slam;
  let roadBonusPath = baseTraj.roadBonusPath;

  if (!commandAlreadyUsed) {
    // CORRECTIF (étape 6, arbre repensé par Mayrik) : cette branche ne
    // construit JAMAIS de lot ("on ne cherche plus à équilibrer les
    // tours de jeu, mais à maximiser les actions des véhicules en
    // tête" — confirmé) — tous les nœuds ci-dessous raisonnent sur le
    // POOL entier, jamais sur un lot de 2 dés comme dans l'autre
    // branche. "L'arc avant de la case actuelle de ce véhicule est-il
    // composé de 3 cases soit impassables soit occupées par des
    // véhicules ?" passe AVANT la considération Nitro (même priorité
    // que l'autre branche).
    const frontBlocked = isFrontArcFullyBlocked(car, board, allCars);

    if (frontBlocked) {
      const poolHas345 = myPool.some((v) => v >= 3 && v <= 5);

      if (poolHas345) {
        // "Programmation Commande Drift avec le plus petit dé du pôle
        // de valeur 3 ou 4 ou 5" — SANS condition supplémentaire
        // (l'ancien nœud "le dé attribué est-il un 1 ?", qui s'est
        // révélé structurellement inatteignable, a été retiré par
        // Mayrik plutôt que reformulé). Le dé de mouvement reste celui
        // déjà assigné (biggestDie) ; seul le déblocage de l'arc avant
        // change via driftAvailable=true.
        const driftDie = Math.min(...myPool.filter((v) => v >= 3 && v <= 5));
        const driftTraj = chooseGeneralTrajectory(board, car, biggestDie, allCars, allChoppers, true, roundState.roadDie || 0);
        command = { type: "drift", dieValue: driftDie };
        destination = driftTraj.destination;
        slam = driftTraj.slam;
        roadBonusPath = driftTraj.roadBonusPath;
      } else {
        // Aucun 3/4/5 nulle part dans le pôle : le Drift est
        // impossible, quel que soit le tour.
        const isLastTurnOfRound = ((roundState.turnsThisRound && roundState.turnsThisRound[playerName]) || 0) === 2;
        if (isLastTurnOfRound) {
          // "Attribution du plus petit dé du pôle à la Command
          // Airstrike" — le mouvement reste sur la destination déjà
          // calculée (toujours bloquée) avec le dé d'origine.
          const smallestDie = Math.min(...myPool);
          const enemies = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
          const target = enemies.length > 0 ? findFrontmostCar(enemies) : null;
          const placement = target ? findAiAirstrikePlacement(board, target, allCars, allChoppers) : null;
          if (placement) {
            command = { type: "airstrike", dieValue: smallestDie, target, placement };
          }
        } else {
          // "On retire le dé assigné au véhicule, on Assigne le dé le
          // plus petit du pôle au véhicule" -> nouvelle recherche de
          // trajectoire avec ce petit dé (mouvement minimal, aucune
          // Command ce tour-ci).
          const smallestDie = Math.min(...myPool);
          const fallbackTraj = chooseGeneralTrajectory(board, car, smallestDie, allCars, allChoppers, false, roundState.roadDie || 0);
          dieValueFinal = smallestDie;
          destination = fallbackTraj.destination;
          slam = fallbackTraj.slam;
          roadBonusPath = fallbackTraj.roadBonusPath;
        }
      }
    } else {
      const remaining = poolMinusOne(myPool, biggestDie);
      const nitroDice = remaining.filter((v) => v >= 1 && v <= 3);

      if (nitroDice.length > 0) {
        // "Attribution du plus gros dé 1 ou 2 ou 3 à la commande
        // Nitro" -> "Nouvelle recherche de la meilleure trajectoire
        // avec dé Assigné + dé Nitro" -> "Atteindra-t-on la ligne
        // d'arrivée avec cette destination ?" (RECHECK).
        const nitroDie = Math.max(...nitroDice);
        const nitroTraj = chooseGeneralTrajectory(board, car, biggestDie + nitroDie, allCars, allChoppers, false, roundState.roadDie || 0);
        if (nitroTraj.destination.col >= finishColStart) {
          command = { type: "nitro", dieValue: nitroDie };
          destination = nitroTraj.destination;
          slam = nitroTraj.slam;
          roadBonusPath = nitroTraj.roadBonusPath;
        }
        // sinon : "retrait de la Commande Nitro" — on retombe sur
        // l'Airstrike ci-dessous, exactement comme si aucun dé 1-2-3
        // n'avait été disponible.
      }

      if (!command && remaining.length > 0) {
        // "Attribution du dé du pôle le plus petit à la Command
        // Airstrike" — la destination/trajectoire reste celle du dé de
        // base (l'Airstrike ne change pas le mouvement de ce tour).
        const smallestDie = Math.min(...remaining);
        const enemies = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
        const target = enemies.length > 0 ? findFrontmostCar(enemies) : null;
        const placement = target ? findAiAirstrikePlacement(board, target, allCars, allChoppers) : null;
        if (placement) {
          command = { type: "airstrike", dieValue: smallestDie, target, placement };
        }
      }
    }
  } else {
    // "Un véhicule adverse opérable est-il à moins de 10 cases de
    // l'arrivée ?" -> "Recherche d'une nouvelle trajectoire
    // permettant de tirer sur le véhicule adverse opérable le plus
    // en avant de la course" -> "Il y a-t-il une nouvelle trajectoire
    // éligible ?"
    const enemiesOperable = allCars.filter((c) => c.owner !== playerName && c.status === CAR_STATUS.OPERABLE);
    const nearFinishEnemy = enemiesOperable.some((c) => (finishColStart - c.col) < 10);
    if (nearFinishEnemy) {
      const leader = findFrontmostCar(enemiesOperable);
      const altDests = computeReachableDestinations(board, car, biggestDie, allCars, allChoppers);
      const shootable = altDests.filter((d) => {
        if (d.terminalReason !== "normal") return false;
        const arc = getFrontArc({ col: d.col, row: d.row });
        return arc.some((a) => a.col === leader.col && a.row === leader.row);
      });
      if (shootable.length > 0) {
        // L'arbre ne précise pas de départage au-delà de "une
        // nouvelle trajectoire éligible" — on retient la plus
        // avancée, cohérente avec l'objectif "rush".
        shootable.sort((a, b) => b.col - a.col);
        destination = shootable[0];
        slam = false;
        roadBonusPath = null;
      }
      // sinon (aucune trajectoire éligible) : on garde la destination
      // d'origine (baseTraj), déjà affectée par défaut ci-dessus.
    }
  }

  return { car, dieValue: dieValueFinal, command, destination, isEntry: false, isCoast: false, slam, roadBonusPath };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { canReachFinishLine, decideFinishLineRush });
}

// ===================================================================
// SECTION 10 — POINT D'ENTRÉE UNIQUE
// ===================================================================
function decideAssignAndCommand(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  // CORRECTIF (étape 3) : le round 1 est une branche dédiée, testée
  // AVANT tout — auparavant seul progressionState.finishLineTile
  // était testé, donc le round 1 tombait dans decideNoFinishLine
  // (le sous-arbre Command/Lot bien plus riche prévu pour les rounds
  // SUIVANTS), jamais dans sa propre branche, bien plus simple.
  if (roundState.roundNumber === 1) {
    return decideFirstRound(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
  }
  if (progressionState.finishLineTile) {
    return decideFinishLineRush(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
  }
  return decideNoFinishLine(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideAssignAndCommand, decideFirstRound });
}

/**
 * ai-decision.js — Nouveau système de décision IA pour Thunder Road
 * In The Pocket, construit en repartant de zéro (session du <date>),
 * suite à l'abandon complet de l'ancien `ai-scoring.js` (Utility AI à
 * 15 facteurs, jugé trop complexe et instable après plusieurs
 * correctifs empilés).
 *
 * MÉTHODE : ce module traduit fidèlement l'arbre de décision fourni
 * par Mayrik (PDF "Arbre de décision attribution de dés pour
 * l'automate ThunderRoadVendetta"), validé main dans la main avec
 * lui avant toute implémentation. L'arbre encode déjà l'ordre des
 * priorités stratégiques (validé sur table de jeu physique) — ce
 * module ne réinvente PAS la stratégie, il la rend robuste et
 * exhaustive là où un arbre papier ne peut pas tout couvrir (cas
 * limites, égalités non dessinées).
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
  chooseAiEntryRow,
  computeAiStepCost,
  isAiHiddenHazard,
  findFrontmostCar,
  findRearmostCar,
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
  const results = new Map(); // clé "col,row" -> meilleur candidat pour cette case

  function record(col, row, stepsUsed, dangerousCellsCrossed, allRoad, terminalReason, slamTarget, path) {
    const key = `${col},${row}`;
    const candidate = { col, row, stepsUsed, dangerousCellsCrossed, allRoad, terminalReason, slamTarget: slamTarget || null, path };
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

  function visit(col, row, pointsRemaining, dangerousCellsCrossed, allRoad, stepsUsed, pathSoFar, driftUsed) {
    const arc = getFrontArc({ col, row });
    for (const step of arc) {
      const space = getSpace(board, step.col, step.row);
      const nextPath = [...pathSoFar, step.name];

      if (space === null) {
        // Bord GAUCHE/DROIT : sortie du plateau = élimination (p.6).
        record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "eliminated-edge", null, nextPath);
        continue;
      }
      if (space === undefined) {
        // Bord AVANT (col >= cols) : la voiture continuerait sur la
        // tuile suivante, dont le contenu est inconnu au moment de
        // la décision (elle n'est piochée qu'à l'exécution réelle,
        // p.11) — on ne peut pas prédire plus loin, donc on
        // enregistre ce point comme un arrêt de planification, pas
        // une élimination ni une case normale.
        record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "exits-front", null, nextPath);
        continue;
      }

      if (space.terrain === TERRAIN.IMPASSABLE) {
        record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "eliminated-impassable", null, nextPath);
        continue;
      }

      const occupant = getCarAt(allCars, step.col, step.row);
      if (occupant) {
        // Entrer sur une case occupée arrête TOUJOURS le mouvement si
        // on choisit de s'arrêter LÀ (p.9) — toujours enregistré comme
        // candidat de Slam valide, Drift ou pas.
        record(step.col, step.row, stepsUsed + 1, dangerousCellsCrossed, allRoad, "slam", occupant, nextPath);

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
              record(step.col, step.row, stepsUsed + 1, nextDangerous2, nextAllRoad2, chopperHere2 ? "eliminated-chopper" : "normal", null, nextPath);
            } else {
              visit(step.col, step.row, remainingAfter2, nextDangerous2, nextAllRoad2, stepsUsed + 1, nextPath, true);
            }
          }
        }
        continue;
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
        continue;
      }

      const remainingAfter = pointsRemaining - cost;

      if (remainingAfter === 0) {
        // Budget épuisé pile sur cette case : point d'arrêt normal,
        // SAUF si un chopper y est stationné (élimine la voiture qui
        // termine son tour dessus, p.6).
        record(step.col, step.row, stepsUsed + 1, nextDangerous, nextAllRoad, chopperHere ? "eliminated-chopper" : "normal", null, nextPath);
        continue;
      }

      if (chopperHere) {
        // Passer À TRAVERS un chopper est sans effet (p.6) tant que
        // ce n'est pas la case d'arrêt finale — on continue
        // d'explorer au-delà normalement.
      }
      visit(step.col, step.row, remainingAfter, nextDangerous, nextAllRoad, stepsUsed + 1, nextPath, driftUsed);
    }
  }

  visit(car.col, car.row, dieValue, 0, true, 0, [], false);
  return [...results.values()];
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
// Règle d'acceptation (formulée par Mayrik, session du <date>) :
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

// ===================================================================
// SECTION 3B - RECHERCHE GENERALE DE TRAJECTOIRE
// ===================================================================
function chooseGeneralTrajectory(board, car, dieValue, allCars, allChoppers, driftAvailable = false) {
  const candidates = computeReachableDestinations(board, car, dieValue, allCars, allChoppers, driftAvailable);
  const progressable = candidates.filter((c) => c.terminalReason === "normal" || c.terminalReason === "exits-front");

  let destination;
  if (progressable.length > 0) {
    progressable.sort((a, b) => (b.col - a.col) || (a.dangerousCellsCrossed - b.dangerousCellsCrossed));
    destination = progressable[0];
  } else {
    const slams = candidates.filter((c) => c.terminalReason === "slam");
    const acceptedSlam = slams.find((c) => evaluateSlamCandidate(c, dieValue, car.size, board).accept);
    if (acceptedSlam) {
      destination = acceptedSlam;
    } else if (slams.length > 0) {
      slams.sort((a, b) => b.stepsUsed - a.stepsUsed);
      destination = slams[0];
    } else {
      destination = candidates[0];
    }
  }

  let slam = destination.terminalReason === "slam";
  if (destination.terminalReason === "normal") {
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

  return { destination, shotTarget, slam };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { chooseShootTarget, chooseGeneralTrajectory });
}

// ===================================================================
// SECTION 4 — RÉPARTITION DES DÉS EN LOTS (niveau round, pas tour)
// ===================================================================
// Traduction de : "Création d'un nombre de lots de dés égal au nombre
// de véhicule[s] [...] non encore activé[s]. Les lots doivent créer
// des valeurs de dé additionnées les plus équilibrées possible."
//
// HYPOTHÈSE D'INTERPRÉTATION (à confirmer avec Mayrik) : le texte de
// l'arbre dit littéralement "véhicule NON Opérable non encore
// activé", mais ce nœud n'est atteint QUE depuis les branches "3" et
// "2" du compteur "véhicules OPÉRABLES et non activés" — une voiture
// inopérable ne peut de toute façon recevoir aucun dé de mouvement
// (aucune Command autre que Repair ne s'applique à elle). Lu comme
// une coquille de rédaction (Mayrik a lui-même prévenu de ce risque)
// et interprété ici comme "nombre de véhicules OPÉRABLES non encore
// activés" — cohérent avec le nombre de lots réellement nécessaires
// (3 lots si 3 véhicules opérables restent, 2 lots si 2 restent).
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

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    isOnRearTile,
    frontmostEligibleCar,
    rearmostEligibleCar,
    isAnyOpponentLeading
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
// SECTION 6 — DÉCISION DE COMMAND (branches 1/2/3 véhicules opérables)
// ===================================================================
// Traduction directe des sous-arbres de Mayrik pour chaque branche.
// GARDE-FOU ARCHITECTURAL AJOUTÉ (absent du dessin de l'arbre, mais
// imposé par la règle absolue du jeu — p.8, "ONCE PER ROUND") : une
// seule Command par round, jamais deux. Le dessin de l'arbre ne
// redessine pas explicitement cette vérification dans les branches
// 3/2/1 — elle est donc ajoutée ici comme garde-fou systématique
// plutôt que silencieusement supposée. À confirmer avec Mayrik que
// ce n'était pas déjà implicite dans sa tête en dessinant l'arbre.
//
// candidateCars = liste des voitures opérables ET pas encore activées
// ce round, pour CE joueur (déjà filtrée par l'appelant).
function decideCommandForActivatedCar(car, progressionState, myInoperableCars, myOperableCars, dicePoolRemaining, allCars, myOwner) {
  if (myInoperableCars.length > 0 && dicePoolRemaining.includes(6)) {
    // "Un des véhicules Inopérable de l'équipe est-il en tête de
    // course ?" -> Repair celui en tête, sinon le plus en arrière.
    // INTERPRÉTATION (à confirmer) : condition inverse lue comme la
    // négation directe (aucun de mes inopérables en tête -> réparer
    // le plus en arrière, le plus menacé positionnellement).
    const alive = myInoperableCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED);
    if (alive.length > 0) {
      const allAliveOfMine = [...myOperableCars, ...alive].filter((c) => c.status !== CAR_STATUS.ELIMINATED);
      const myFrontmost = frontmostEligibleCar(allAliveOfMine);
      const anInoperableIsLeading = alive.some((c) => c === myFrontmost);
      const target = anInoperableIsLeading ? myFrontmost : rearmostEligibleCar(alive);
      return { type: "repair", dieValue: 6, target };
    }
  }

  // "Cette voiture est-elle sur la tuile Rear OU la plus en arrière
  // de l'équipe, ET un dé entre 1 et 3 est-il disponible ?"
  const isRearmostOfMyTeam = myOperableCars.length > 0 && car === rearmostEligibleCar(myOperableCars);
  const eligiblePosition = isOnRearTile(car, progressionState) || isRearmostOfMyTeam;
  const nitroDice = dicePoolRemaining.filter((v) => v >= 1 && v <= 3);
  if (eligiblePosition && nitroDice.length > 0) {
    return { type: "nitro", dieValue: Math.max(...nitroDice) };
  }

  return null;
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideCommandForActivatedCar });
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
  if (n === 0) {
    const eligibleForCoast = myOperableCars.filter((c) => c.coastCount < 2);
    if (eligibleForCoast.length === 0) return null; // plus aucun tour possible ce round pour ce joueur
    const car = rearmostEligibleCar(eligibleForCoast);
    const dieValue = myPool[0]; // "il vaut 1" = distance fixe, la face du dé physique importe peu
    const dests = computeReachableDestinations(board, car, 1, allCars, allChoppers);
    const destination = dests.find((d) => d.terminalReason === "normal" || d.terminalReason === "eliminated-impassable" || d.terminalReason === "slam" || d.terminalReason === "exits-front") || dests[0];
    const shotTarget = chooseShootTarget(destination.col, destination.row, playerName, allCars);
    return { car, dieValue, command: null, destination, shotTarget, isEntry: false, isCoast: true };
  }

  const commandAlreadyUsed = !!roundState.commandUsedThisRound[playerName];

  // --- Branches 1/2/3 : construction des lots, choix de la voiture,
  // puis éventuellement une Command programmée pour CETTE activation.
  const lotCount = n;
  const lots = partitionIntoBalancedLots([...myPool], lotCount);
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

  if (!commandAlreadyUsed && car.col !== null) {
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
      // dé y réapparaîtra naturellement au tour suivant.
    }
  }

  if (!driftBlockHandledThisTurn && !commandAlreadyUsed) {
    const remainingDiceForCommand = [...biggestLot];
    remainingDiceForCommand.splice(remainingDiceForCommand.indexOf(actualMovementDie), 1);
    // Un lot peut n'avoir qu'1 dé (pas de Command possible avec CE
    // lot) — le reste du pool (les AUTRES lots) n'est délibérément
    // pas éligible : la Command de ce tour doit venir du MÊME lot que
    // le mouvement, cohérent avec la structure "un des 3 tours a 2
    // dés (dont 1 en Command)" de l'arbre.
    command = decideCommandForActivatedCar(car, progressionState, myInoperableCars, myOperableCars, remainingDiceForCommand, allCars, playerName);
  }
  const movementDieFinal = actualMovementDie;

  let effectiveDieValue = movementDieFinal;
  if (command && command.type === "nitro") effectiveDieValue += command.dieValue;

  let destination, shotTarget, slam;
  if (car.col === null) {
    const row = chooseAiEntryRow(board, car, allCars, allChoppers);
    destination = { col: 0, row, stepsUsed: 0, terminalReason: "normal", slamTarget: null };
    shotTarget = null;
    slam = false;
  } else {
    const driftActive = !!(command && command.type === "drift");
    const traj = chooseGeneralTrajectory(board, car, effectiveDieValue, allCars, allChoppers, driftActive);
    destination = traj.destination;
    shotTarget = traj.shotTarget;
    slam = traj.slam;
  }

  return {
    car,
    dieValue: movementDieFinal,
    command,
    destination,
    shotTarget,
    isEntry: car.col === null,
    isCoast: false,
    slam
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

  // "Reste-il un nombre de dés non jouées dans le pôle > à nombre de
  // voitures non éliminées n'ayant pas encore jouée ?" — s'il n'y a
  // pas de dé "en trop" (donc pas de Command possible ce tour), on
  // retombe sur la logique générale (pas de ruée spéciale possible).
  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const notYetActivated = myOperableCars.filter((c) => !c.movedThisRound);
  if (!(myPool.length > notYetActivated.length)) {
    return decideNoFinishLine(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
  }
  if (notYetActivated.length === 0) {
    return decideNoFinishLine(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
  }

  const car = frontmostEligibleCar(notYetActivated);
  const biggestDie = Math.max(...myPool);
  const baseDests = computeReachableDestinations(board, car, biggestDie, allCars, allChoppers);

  if (canReachFinishLine(baseDests, finishColStart)) {
    const destination = baseDests.find((d) => (d.terminalReason === "normal" || d.terminalReason === "exits-front") && d.col >= finishColStart);
    return { car, dieValue: biggestDie, command: null, destination, shotTarget: null, isEntry: car.col === null, isCoast: false, slam: false };
  }

  const commandAlreadyUsed = !!roundState.commandUsedThisRound[playerName];
  let command = null;
  let effectiveDieValue = biggestDie;

  if (!commandAlreadyUsed) {
    const remaining = [...myPool];
    remaining.splice(remaining.indexOf(biggestDie), 1);
    const nitroDice = remaining.filter((v) => v >= 1 && v <= 3);

    let solved = false;
    for (const nd of nitroDice.sort((a, b) => b - a)) {
      const dests = computeReachableDestinations(board, car, biggestDie + nd, allCars, allChoppers);
      if (canReachFinishLine(dests, finishColStart)) {
        command = { type: "nitro", dieValue: nd };
        effectiveDieValue = biggestDie + nd;
        solved = true;
        break;
      }
    }

    if (!solved) {
      // "Une Commande drift permet-elle d'atteindre la ligne
      // d'arrivée avec le dé Assigné ?" — Drift ne change pas le
      // BUDGET de mouvement, seulement la capacité à traverser le
      // PREMIER véhicule rencontré sans s'arrêter dessus.
      const driftDice = remaining.filter((v) => v >= 3 && v <= 5);
      if (driftDice.length > 0) {
        const driftDests = computeReachableDestinations(board, car, biggestDie, allCars, allChoppers, true);
        if (canReachFinishLine(driftDests, finishColStart)) {
          command = { type: "drift", dieValue: Math.min(...driftDice) };
          solved = true;
        }
      }
    }

    if (!solved) {
      // "Dé restant le plus petit sur Airstrike... sera joué dans
      // tous les cas qui suivent."
      const smallestRemaining = Math.min(...remaining);
      const enemies = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
      if (enemies.length > 0) {
        const target = findFrontmostCar(enemies);
        const placement = findAiAirstrikePlacement(board, target, allCars, allChoppers);
        if (placement) {
          command = { type: "airstrike", dieValue: smallestRemaining, target, placement };
        }
      }
    }
  }

  // Suite commune : cible adverse à moins de 10 cases de l'arrivée ?
  const enemiesOperable = allCars.filter((c) => c.owner !== playerName && c.status === CAR_STATUS.OPERABLE);
  const nearFinishEnemy = enemiesOperable.find((c) => (finishColStart - c.col) < 10);

  const driftActiveForRest = !!(command && command.type === "drift");
  const finalDests = computeReachableDestinations(board, car, effectiveDieValue, allCars, allChoppers, driftActiveForRest);
  let destination = null;

  if (nearFinishEnemy) {
    const leader = findFrontmostCar(enemiesOperable);
    const shootable = finalDests.filter((d) => {
      if (d.terminalReason !== "normal") return false;
      const arc = getFrontArc({ col: d.col, row: d.row });
      return arc.some((a) => a.col === leader.col && a.row === leader.row);
    });
    if (shootable.length > 0) {
      // "Cette case peut-elle être atteinte avec un dé disponible
      // dans le pôle et plus petit que celui Assigné ?" — dépenser la
      // valeur minimale suffisante (principe déjà connu). CORRECTIF
      // (trouvé via le harnais de robustesse à grande échelle,
      // vraies parties simulées) : la version précédente changeait
      // `dieValue` pour le dé plus petit trouvé, mais réutilisait la
      // DESTINATION calculée pour l'ANCIEN dé plus gros — incohérence
      // dieValue/destination.path qui corrompait l'exécution réelle
      // (voiture retrouvée hors bornes après plusieurs tours). On
      // recalcule maintenant la destination EXACTEMENT pour le dé
      // finalement retenu, jamais un mélange des deux.
      const smallerDice = myPool.filter((v) => v < effectiveDieValue && v !== (command && command.dieValue));
      let usedDie = effectiveDieValue;
      let usedDestination = shootable[0];
      for (const sd of smallerDice.sort((a, b) => a - b)) {
        const smallerDests = computeReachableDestinations(board, car, sd, allCars, allChoppers);
        const match = smallerDests.find((d) => shootable.some((s) => s.col === d.col && s.row === d.row));
        if (match) {
          usedDie = sd;
          usedDestination = match;
          break;
        }
      }
      return {
        car, dieValue: usedDie === effectiveDieValue ? biggestDie : usedDie,
        command: usedDie === effectiveDieValue ? command : null,
        destination: usedDestination, shotTarget: leader, isEntry: car.col === null, isCoast: false, slam: false
      };
    }
  }

  const traj = chooseGeneralTrajectory(board, car, effectiveDieValue, allCars, allChoppers, driftActiveForRest);
  return { car, dieValue: biggestDie, command, destination: traj.destination, shotTarget: traj.shotTarget, isEntry: car.col === null, isCoast: false, slam: traj.slam };
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { canReachFinishLine, decideFinishLineRush });
}

// ===================================================================
// SECTION 10 — POINT D'ENTRÉE UNIQUE
// ===================================================================
function decideAssignAndCommand(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  if (progressionState.finishLineTile) {
    return decideFinishLineRush(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
  }
  return decideNoFinishLine(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, { decideAssignAndCommand });
}

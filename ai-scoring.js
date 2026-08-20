"use strict";

// -----------------------------------------------------------------
// UTILITY AI — ASSIGN + COMMAND
// -----------------------------------------------------------------
// Remplace à terme chooseAiAssign() + chooseAiCommand() dans engine.js
// (voir document de synthèse "TRV initiative IA", issu de la revue de
// ~40 cas réels avec Mayrik). engine.js reste pur/déterministe ; toute
// la logique de décision vit ici, dans un module séparé et testable
// indépendamment (une fonction par facteur, pure : (candidat,
// contexte) => nombre).
//
// Principe : pour chaque tour, on énumère tous les candidats valides
// (voiture × dé de mouvement × Command optionnelle + son dé), on
// score chacun par une somme pondérée de facteurs indépendants, et on
// choisit le meilleur score. Un léger bruit aléatoire optionnel évite
// un comportement 100% déterministe en partie réelle (désactivé par
// défaut, utile surtout pour les tests de non-régression).
//
// STATUT : première version. Certains facteurs sont volontairement
// SIMPLIFIÉS (marqués ci-dessous) — à affiner ensemble au fur et à
// mesure des tests de non-régression sur les cas déjà collectés.

const engine = require("./engine.js");
const {
  TERRAIN,
  CAR_STATUS,
  CAR_SIZE,
  getSpace,
  getFrontArc,
  getCarAt,
  chooseAiMoveTrajectory,
  chooseAiEntryRow,
  moveCar,
  moveCarEnteringBoard,
  findAiAirstrikePlacement,
  findFrontmostCar,
  findRearmostCar
} = engine;

// -----------------------------------------------------------------
// 0. CLONAGE — jamais toucher au vrai plateau/aux vraies voitures
// pendant la génération de candidats (ne jamais révéler un hazard
// prématurément, même hypothétiquement — même précaution que pour la
// génération de cas Shoot).
// -----------------------------------------------------------------
function cloneBoard(board) {
  return JSON.parse(JSON.stringify(board));
}
function cloneCars(allCars) {
  return allCars.map((c) => ({ ...c, damageTokens: [...c.damageTokens] }));
}

// -----------------------------------------------------------------
// 1. SIMULATION — position finale PLAUSIBLE d'un candidat de
// mouvement, sans toucher au vrai état. Réutilise chooseAiMoveTrajectory
// / chooseAiEntryRow (déjà éprouvées) pour obtenir UNE trajectoire
// candidate, puis l'applique sur un clone isolé.
//
// SIMPLIFICATION ASSUMÉE : n'explore qu'UNE trajectoire par (voiture,
// dé), pas toutes les trajectoires possibles — conforme à la méthode
// décrite dans le document de synthèse ("pas besoin d'explorer tous
// les chemins"). Le Drift (passage sans slam) n'est pas encore
// répercuté dans cette simulation ; comme Drift reste un "dernier
// recours" mécanique très rare (confirmé par Mayrik), l'impact sur le
// score est marginal pour l'instant.
// -----------------------------------------------------------------
function simulateMoveCandidate(board, car, effectiveDieValue, allCars, allChoppers) {
  const boardClone = cloneBoard(board);
  const carsClone = cloneCars(allCars);
  const carClone = carsClone.find((c) => c.id === car.id);

  if (carClone.col === null) {
    const row = chooseAiEntryRow(boardClone, carClone, carsClone, allChoppers);
    const result = moveCarEnteringBoard(boardClone, carClone, effectiveDieValue, row, [], carsClone, {
      startedInStartingArea: true
    });
    return {
      finalCol: carClone.col,
      finalRow: carClone.row,
      eliminated: carClone.status === CAR_STATUS.ELIMINATED,
      roadEligible: !!result.roadEligible,
      slam: !!result.slam,
      isEntry: true
    };
  }

  const path = chooseAiMoveTrajectory(boardClone, carClone, effectiveDieValue, carsClone, allChoppers);
  const result = moveCar(boardClone, carClone, effectiveDieValue, path, carsClone, {});
  return {
    finalCol: carClone.col,
    finalRow: carClone.row,
    eliminated: carClone.status === CAR_STATUS.ELIMINATED,
    roadEligible: !!result.roadEligible,
    slam: !!result.slam,
    isEntry: false
  };
}

// -----------------------------------------------------------------
// 2. GÉNÉRATION DES CANDIDATS
// -----------------------------------------------------------------
// dicePool[playerName] est un tableau de valeurs (ex. [2,4,4,6]) — un
// index par dé PHYSIQUE. On raisonne par INDEX (mi/ci), jamais par
// valeur seule, pour ne jamais réutiliser deux fois le même dé
// physique dans un même candidat.

const COMMAND_DIE_RANGES = {
  nitro: (v) => v >= 1 && v <= 3,
  drift: (v) => v >= 3 && v <= 5,
  repair: (v) => v === 6,
  airstrike: () => true
};

function generateCandidates(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState) {
  const pool = dicePool[playerName] || [];
  if (pool.length === 0) return [];

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const neverMoved = myOperableCars.filter((c) => !c.movedThisRound);
  const isCoastTurn = neverMoved.length === 0;
  const eligibleCars = isCoastTurn
    ? myOperableCars.filter((c) => c.col !== null && c.coastCount < 2)
    : neverMoved;
  if (eligibleCars.length === 0) return [];

  const candidates = [];
  const commandAvailable = !isCoastTurn && !roundState.commandUsedThisRound[playerName];

  for (const car of eligibleCars) {
    for (let mi = 0; mi < pool.length; mi++) {
      const dieValue = pool[mi];

      if (isCoastTurn) {
        candidates.push({
          kind: "coast",
          car,
          moveDieIndex: mi,
          moveDieValue: dieValue,
          command: null,
          simulated: null // le Coast avance toujours d'exactement 1 case (p.9), pas besoin de simuler une trajectoire
        });
        continue;
      }

      // Candidat mouvement seul.
      const simulated = simulateMoveCandidate(board, car, dieValue, allCars, allChoppers);
      candidates.push({
        kind: "move",
        car,
        moveDieIndex: mi,
        moveDieValue: dieValue,
        command: null,
        simulated
      });

      if (!commandAvailable) continue;

      // Candidats mouvement + Command (dé DIFFÉRENT réservé à la Command).
      for (let ci = 0; ci < pool.length; ci++) {
        if (ci === mi) continue;
        const cmdDieValue = pool[ci];

        if (COMMAND_DIE_RANGES.nitro(cmdDieValue)) {
          const nitroSimulated = simulateMoveCandidate(board, car, dieValue + cmdDieValue, allCars, allChoppers);
          candidates.push({
            kind: "move+command",
            car,
            moveDieIndex: mi,
            moveDieValue: dieValue,
            command: { type: "nitro", dieIndex: ci, dieValue: cmdDieValue },
            simulated: nitroSimulated
          });
        }

        if (COMMAND_DIE_RANGES.drift(cmdDieValue)) {
          candidates.push({
            kind: "move+command",
            car,
            moveDieIndex: mi,
            moveDieValue: dieValue,
            command: { type: "drift", dieIndex: ci, dieValue: cmdDieValue },
            simulated // Drift ne change pas la position finale simulée ici (voir simplification ci-dessus)
          });
        }

        if (COMMAND_DIE_RANGES.repair(cmdDieValue)) {
          const inoperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.INOPERABLE);
          for (const target of inoperableCars) {
            candidates.push({
              kind: "move+command",
              car,
              moveDieIndex: mi,
              moveDieValue: dieValue,
              command: { type: "repair", dieIndex: ci, dieValue: cmdDieValue, target },
              simulated
            });
          }
        }

        if (COMMAND_DIE_RANGES.airstrike(cmdDieValue)) {
          const enemyOwners = [...new Set(allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED).map((c) => c.owner))];
          for (const enemyOwner of enemyOwners) {
            const enemyCars = allCars.filter((c) => c.owner === enemyOwner && c.status !== CAR_STATUS.ELIMINATED);
            if (enemyCars.length === 0) continue;
            const target = findFrontmostCar(enemyCars);
            const placement = findAiAirstrikePlacement(board, target, allCars, allChoppers);
            if (!placement || !placement.placed) continue;
            candidates.push({
              kind: "move+command",
              car,
              moveDieIndex: mi,
              moveDieValue: dieValue,
              command: { type: "airstrike", dieIndex: ci, dieValue: cmdDieValue, target, placement },
              simulated
            });
          }
        }
      }
    }
  }

  return candidates;
}

// -----------------------------------------------------------------
// 3. PROFIL STRATÉGIQUE (peloton / echappee / hybride)
// -----------------------------------------------------------------
// SIMPLIFICATION ASSUMÉE : heuristique de départ basée sur l'écart de
// position moyenne avec le meilleur adversaire et le nombre de
// véhicules restants — à affiner avec des cas réels comme les autres
// facteurs. "peloton" par défaut si aucun signal net (c'est le profil
// observé dans les 20 cas Assign collectés).
function computeStrategicProfile(allCars, playerName) {
  const mine = allCars.filter((c) => c.owner === playerName && c.status !== CAR_STATUS.ELIMINATED);
  if (mine.length === 0) return "peloton";

  const enemyOwners = [...new Set(allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED).map((c) => c.owner))];
  const myAvgCol = mine.reduce((s, c) => s + (c.col || 0), 0) / mine.length;
  const myBestCol = Math.max(...mine.map((c) => c.col || 0));

  let bestEnemyBestCol = -Infinity;
  let bestEnemyCount = 0;
  for (const owner of enemyOwners) {
    const cars = allCars.filter((c) => c.owner === owner && c.status !== CAR_STATUS.ELIMINATED);
    const bestCol = Math.max(...cars.map((c) => c.col || 0));
    if (bestCol > bestEnemyBestCol) {
      bestEnemyBestCol = bestCol;
      bestEnemyCount = cars.length;
    }
  }

  if (mine.length <= 1) return "echappee"; // plus qu'un véhicule : forcément "canon de verre" par construction
  if (myBestCol - bestEnemyBestCol > 6 && mine.length >= 2) return "hybride"; // avance confortable ET toujours groupé
  if (myAvgCol < bestEnemyBestCol - 8) return "echappee"; // net retard de groupe : tenter une échappée offensive ou défensive
  return "peloton";
}

const WEIGHTS_BY_PROFILE = {
  peloton: {
    efficaciteDe: 1, reserveDeCommand: 1, ordreActivation: 1, rythmeMinimal: 2,
    bonusRoadFutur: 0.5, opportuniteTir: 1.5, risqueBordPlateau: 1, risqueSlamCumule: 1.5,
    slamVolontaire: 1, chasseLeader: 1.5, progressionPure: 0.5, ciblageAirstrike: 1.5,
    repairPriorite: 2, commandParElimination: 0.5, usureAdverse: 1
  },
  echappee: {
    efficaciteDe: 1, reserveDeCommand: 1, ordreActivation: 0.5, rythmeMinimal: 0.2,
    bonusRoadFutur: 1, opportuniteTir: 1, risqueBordPlateau: 1, risqueSlamCumule: 1,
    slamVolontaire: 0.7, chasseLeader: 0.7, progressionPure: 2, ciblageAirstrike: 1.5,
    repairPriorite: 2, commandParElimination: 0.5, usureAdverse: 0.5
  },
  hybride: {
    efficaciteDe: 1, reserveDeCommand: 1, ordreActivation: 0.8, rythmeMinimal: 1,
    bonusRoadFutur: 0.8, opportuniteTir: 1.3, risqueBordPlateau: 1, risqueSlamCumule: 1.3,
    slamVolontaire: 0.9, chasseLeader: 1.2, progressionPure: 1.2, ciblageAirstrike: 1.5,
    repairPriorite: 2, commandParElimination: 0.5, usureAdverse: 0.8
  }
};

// -----------------------------------------------------------------
// 4. FACTEURS — chacun (candidat, contexte) => nombre (positif = bon)
// -----------------------------------------------------------------

// Pénalise le gaspillage de valeur de dé : mouvement au-delà de ce
// qui était nécessaire pour l'objectif visé (approximé ici par "sortir
// de la tuile de queue" ou "atteindre la Finish Line" quand pertinent,
// sinon par un mouvement au-delà de 4 cases sans raison — rythme
// minimal 2-3 cases/round, cf. synthèse).
function efficaciteDe(candidate, ctx) {
  if (candidate.kind === "coast") return 0; // le Coast n'a pas de "valeur gaspillée", la distance est fixe
  const die = candidate.moveDieValue;
  if (die <= 3) return 0.3; // dé faible : jamais un gaspillage
  // Un gros dé (5-6) SANS Command associée ET sans besoin de sortie
  // immédiate de tuile est une perte d'opportunité (aurait pu servir
  // une Command ou être réparti autrement).
  if (!candidate.command && die >= 5 && !ctx.canReachLeadExit(candidate.car, die)) return -0.6;
  return 0;
}

// Bonus si un dé de valeur adaptée à une Command future probable
// reste disponible après ce candidat.
function reserveDeCommand(candidate, ctx) {
  const usedIndices = new Set([candidate.moveDieIndex]);
  if (candidate.command) usedIndices.add(candidate.command.dieIndex);
  const remaining = ctx.pool.filter((_, idx) => !usedIndices.has(idx));

  const hasRepairReserve = remaining.includes(6);
  const hasNitroReserve = remaining.some((v) => v >= 1 && v <= 3);

  let score = 0;
  if (ctx.hasInoperableCar && hasRepairReserve) score += 1;
  if (hasNitroReserve) score += 0.3;
  // Le 6 gardé en réserve n'a de valeur que si son assignation future
  // est GARANTIE (cf. synthèse) — approximé ici par "il reste au moins
  // une autre voiture éligible à activer ce round".
  if (!ctx.hasInoperableCar && remaining.includes(6) && ctx.otherEligibleCarsRemain) score -= 0.4;
  return score;
}

// Bonus/malus selon la taille de la voiture activée vs celles encore
// en attente. Round 1 (entrée) : Large → Medium → Small. Zones de
// trafic dense : Large en bloqueur, Small à l'écart.
function ordreActivation(candidate, ctx) {
  if (candidate.simulated && candidate.simulated.isEntry) {
    const order = { [CAR_SIZE.LARGE]: 2, [CAR_SIZE.MEDIUM]: 1, [CAR_SIZE.SMALL]: 0 };
    const others = ctx.eligibleCars.filter((c) => c !== candidate.car);
    const maxOtherOrder = others.length > 0 ? Math.max(...others.map((c) => order[c.size])) : -1;
    return order[candidate.car.size] >= maxOtherOrder ? 0.5 : -0.3;
  }
  return 0;
}

// Pénalise une voiture qui prendrait trop de retard sur le rythme
// minimal (2-3 cases/round), pondéré par le profil stratégique via son
// propre poids plutôt qu'ici.
function rythmeMinimal(candidate, ctx) {
  if (!candidate.simulated) return 0;
  const car = candidate.car;
  const progressThisRound = (ctx.progressSoFarThisRound[car.id] || 0) + (candidate.simulated.finalCol - (car.col ?? 0));
  if (progressThisRound < 2) return -0.5;
  if (progressThisRound >= 2 && progressThisRound <= 4) return 0.3;
  return 0;
}

// Bonus si la case finale est Road ET que le bonus sera réellement
// exploitable au prochain tour de cette voiture (approximé : encore au
// moins un tour restant ce round pour cette voiture).
function bonusRoadFutur(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  const space = getSpace(ctx.board, candidate.simulated.finalCol, candidate.simulated.finalRow);
  if (space && space.terrain === TERRAIN.ROAD && candidate.car.coastCount < 2) return 0.4;
  return 0;
}

// Bonus si la position finale place un adversaire dans l'arc avant.
function opportuniteTir(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  const arc = getFrontArc({ col: candidate.simulated.finalCol, row: candidate.simulated.finalRow });
  const hasTarget = ctx.allCars.some(
    (c) => c.owner !== candidate.car.owner && c.status !== CAR_STATUS.ELIMINATED && arc.some((a) => a.col === c.col && a.row === c.row)
  );
  return hasTarget ? 0.6 : 0;
}

// Malus si la case finale est en bord de plateau, sauf pour exploiter
// une vulnérabilité adverse équivalente (approximé : sauf si un
// adversaire y est déjà exposé de la même façon).
function risqueBordPlateau(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  const edgeRow = candidate.simulated.finalRow === 0 || candidate.simulated.finalRow === ctx.board.rows - 1;
  if (!edgeRow) return 0;
  return -0.4;
}

// Combine matchup de taille + proximité Impassable/bord pour un slam
// subi potentiel. SIMPLIFICATION : version simple pour l'instant —
// pénalise la présence d'un adversaire de MÊME taille adjacent près
// d'un bord/Impassable, sans encore dérouler tous les slams en chaîne.
function risqueSlamCumule(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  const { finalCol, finalRow } = candidate.simulated;
  let risk = 0;
  for (const other of ctx.allCars) {
    if (other.owner === candidate.car.owner || other.status === CAR_STATUS.ELIMINATED) continue;
    const dist = Math.abs((other.col ?? -99) - finalCol) + Math.abs((other.row ?? -99) - finalRow);
    if (dist <= 1 && other.size === candidate.car.size) {
      const nearEdge = finalRow === 0 || finalRow === ctx.board.rows - 1;
      risk -= nearEdge ? 0.7 : 0.3;
    }
  }
  return risk;
}

// Slam en fin de trajectoire = pari (probabilité connue ~2/6 de
// bouger l'adversaire), toujours ≥0 seulement en fin de trajectoire.
function slamVolontaire(candidate, ctx) {
  if (!candidate.simulated || !candidate.simulated.slam) return 0;
  const target = getCarAt(ctx.allCars, candidate.simulated.finalCol, candidate.simulated.finalRow, candidate.car);
  if (!target) return 0;
  const favorable = sizeRank(candidate.car.size) >= sizeRank(target.size);
  return favorable ? 0.5 : -0.2;
}

function sizeRank(size) {
  return size === CAR_SIZE.LARGE ? 2 : size === CAR_SIZE.MEDIUM ? 1 : 0;
}

// Bonus si la trajectoire réduit l'écart avec un adversaire en tête.
function chasseLeader(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  if (!ctx.leaderIsEnemy) return 0;
  const before = ctx.leaderCol - (candidate.car.col ?? 0);
  const after = ctx.leaderCol - candidate.simulated.finalCol;
  return after < before ? 0.4 : 0;
}

// Bonus de distance simple, actif surtout quand aucun adversaire n'est
// à portée d'interaction (poids fort en profil "echappee").
function progressionPure(candidate, ctx) {
  if (!candidate.simulated || candidate.simulated.eliminated) return 0;
  return (candidate.simulated.finalCol - (candidate.car.col ?? 0)) * 0.15;
}

// Pour les candidats Airstrike : bonus si la cible est perçue comme
// "menace de fuite" (approximé : proche de la sortie de tuile de
// tête), bonus additionnel si le placement du chopper gêne aussi une
// trajectoire adverse (approximé : placement dans l'arc avant de la
// cible).
function ciblageAirstrike(candidate, ctx) {
  if (!candidate.command || candidate.command.type !== "airstrike") return 0;
  let score = 0.3; // base : viable par défaut
  const target = candidate.command.target;
  if (target.col !== null && target.col >= ctx.board.cols - 7) score += 0.5; // menace de fuite (cf. logique existante chooseAiCommand)
  const targetArc = getFrontArc(target);
  const placement = candidate.command.placement;
  if (placement && placement.col !== undefined && targetArc.some((a) => a.col === placement.col && a.row === placement.row)) {
    score += 0.3; // gêne aussi une trajectoire adverse future
  }
  return score;
}

// Pour les candidats Repair : gradation selon le nb de véhicules
// restants et l'état de la Finish Line (cf. synthèse Command).
function repairPriorite(candidate, ctx) {
  if (!candidate.command || candidate.command.type !== "repair") return 0;
  const mine = ctx.allCars.filter((c) => c.owner === candidate.car.owner && c.status !== CAR_STATUS.ELIMINATED);
  const inoperable = mine.filter((c) => c.status === CAR_STATUS.INOPERABLE);
  const damagedOperable = mine.filter((c) => c.status === CAR_STATUS.OPERABLE && c.damageTokens.length === 1);

  if (mine.length <= 2 && inoperable.length >= 1) return 1.5; // non-négociable
  if (inoperable.length >= 2) {
    // priorité au plus menacé positionnellement, sauf Finish Line en jeu
    if (ctx.finishLineInPlay) {
      const canReachFinish = candidate.command.target.col + 6 >= ctx.board.cols;
      return canReachFinish ? 1.2 : 0.4;
    }
    return candidate.command.target === findRearmostCar(inoperable) ? 1.0 : 0.3;
  }
  if (inoperable.length === 1 && damagedOperable.length === 0) return 0.9; // préventif immédiat
  if (inoperable.length === 1) return 0.6;
  return 0.1;
}

// Malus pour Nitro/Airstrike si aucune cible/terrain ne les justifie
// ce tour, orientant naturellement vers Repair par défaut. Drift est
// traité ICI aussi (même si le document de synthèse ne le mentionne
// que pour Nitro/Airstrike) : confirmé par Mayrik ET par l'observation
// (session Command) que Drift n'est JAMAIS un choix stratégique, vu
// uniquement par pure nécessité mécanique — un arc avant réellement
// bloqué (voiture/Impassable sur les 3 cases). Sans ce garde-fou, le
// scoring choisissait Drift dès qu'un dé 3-5 traînait, ce que le
// smoke-test a immédiatement révélé.
function commandParElimination(candidate, ctx) {
  if (!candidate.command) return 0;
  if (candidate.command.type === "nitro") {
    // Nitro sans amélioration nette de position (ex. déjà bloqué par
    // un Impassable proche) : léger malus, laissé simple pour l'instant.
    return 0;
  }
  if (candidate.command.type === "airstrike" && !ctx.allCars.some((c) => c.owner !== candidate.car.owner && c.status !== CAR_STATUS.ELIMINATED)) {
    return -1; // aucune cible adverse du tout : jamais pertinent
  }
  if (candidate.command.type === "drift") {
    return ctx.frontArcFullyBlocked(candidate.car) ? 1.5 : -1.5; // dernier recours mécanique UNIQUEMENT
  }
  return 0;
}

// Léger bonus si la Command/mouvement concentre une pression sur une
// équipe adverse déjà entamée.
function usureAdverse(candidate, ctx) {
  if (!candidate.command || candidate.command.type !== "airstrike") return 0;
  const target = candidate.command.target;
  return target.damageTokens && target.damageTokens.length > 0 ? 0.3 : 0;
}

const FACTORS = {
  efficaciteDe, reserveDeCommand, ordreActivation, rythmeMinimal, bonusRoadFutur,
  opportuniteTir, risqueBordPlateau, risqueSlamCumule, slamVolontaire, chasseLeader,
  progressionPure, ciblageAirstrike, repairPriorite, commandParElimination, usureAdverse
};

// -----------------------------------------------------------------
// 5. SCORING & SÉLECTION
// -----------------------------------------------------------------
function scoreCandidat(candidate, ctx, weights) {
  let total = 0;
  for (const [name, fn] of Object.entries(FACTORS)) {
    total += (weights[name] || 0) * fn(candidate, ctx);
  }
  return total;
}

function buildContext(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState, eligibleCars) {
  const pool = dicePool[playerName] || [];
  const enemyCars = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
  const myCars = allCars.filter((c) => c.owner === playerName && c.status !== CAR_STATUS.ELIMINATED);
  const leader = enemyCars.length > 0 ? findFrontmostCar(enemyCars) : null;
  const myFrontmost = myCars.length > 0 ? findFrontmostCar(myCars) : null;

  return {
    board,
    progressionState,
    allCars,
    allChoppers,
    pool,
    eligibleCars,
    hasInoperableCar: allCars.some((c) => c.owner === playerName && c.status === CAR_STATUS.INOPERABLE),
    otherEligibleCarsRemain: eligibleCars.length > 1,
    finishLineInPlay: !!progressionState.finishLineTile,
    leaderIsEnemy: !!leader && (!myFrontmost || leader.col > myFrontmost.col),
    leaderCol: leader ? leader.col : 0,
    progressSoFarThisRound: {}, // SIMPLIFICATION : pas encore de suivi inter-tours au sein du round, toujours 0 pour l'instant
    canReachLeadExit: (car, die) => (car.col ?? 0) + die >= board.cols,
    // Même vérification que l'ancienne chooseAiCommand() : arc avant
    // (ou, pour une voiture pas encore entrée, toute la colonne 0)
    // entièrement bloqué par un Impassable ou un véhicule.
    frontArcFullyBlocked: (car) => {
      if (car.col !== null) {
        const arc = getFrontArc(car);
        return arc.every((a) => {
          const space = getSpace(board, a.col, a.row);
          if (!space) return true;
          return space.terrain === TERRAIN.IMPASSABLE || !!getCarAt(allCars, a.col, a.row, car);
        });
      }
      return Array.from({ length: board.rows }, (_, row) => row).every((row) => {
        const space = getSpace(board, 0, row);
        if (!space) return true;
        return space.terrain === TERRAIN.IMPASSABLE || !!getCarAt(allCars, 0, row);
      });
    }
  };
}

// Point d'entrée. Signature calquée sur chooseAiAssign() pour rester
// un remplacement direct à terme. Retourne { car, dieValue, command,
// isEntry } — même forme que l'ancienne chooseAiAssign() — ou null si
// rien à jouer.
function chooseAiAssignCommand(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState, options = {}) {
  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const neverMoved = myOperableCars.filter((c) => !c.movedThisRound);
  const isCoastTurn = neverMoved.length === 0;
  const eligibleCars = isCoastTurn
    ? myOperableCars.filter((c) => c.col !== null && c.coastCount < 2)
    : neverMoved;

  const candidates = generateCandidates(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState);
  if (candidates.length === 0) return null;

  const profile = options.forceProfile || computeStrategicProfile(allCars, playerName);
  const weights = WEIGHTS_BY_PROFILE[profile];
  const ctx = buildContext(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState, eligibleCars);

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidat(candidate, ctx, weights);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best) return null;

  return {
    car: best.car,
    dieValue: best.moveDieValue,
    command: best.command
      ? { type: best.command.type, dieValue: best.command.dieValue, target: best.command.target, placement: best.command.placement }
      : null,
    isEntry: best.car.col === null,
    isCoast: best.kind === "coast",
    _debug: { profile, score: bestScore, kind: best.kind }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateCandidates,
    simulateMoveCandidate,
    computeStrategicProfile,
    WEIGHTS_BY_PROFILE,
    FACTORS,
    scoreCandidat,
    buildContext,
    chooseAiAssignCommand
  };
}

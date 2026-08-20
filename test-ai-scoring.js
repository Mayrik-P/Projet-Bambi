/**
 * test-ai-scoring.js
 * ---------------------------------------------------------------
 * Tests unitaires par facteur pour ai-scoring.js (Utility AI
 * Assign+Command). Chaque facteur est une fonction pure
 * (candidat, contexte) => nombre, testée isolément sur un cas
 * connu — même esprit que test-engine.js (assert + résumé console).
 *
 * Ces tests ne rejouent PAS de partie complète (voir
 * tools/run-shadow-legality.js pour ça) : ils vérifient que chaque
 * facteur RÉAGIT dans le bon sens à une situation construite à la
 * main, indépendamment des autres facteurs.
 */

"use strict";

const engine = require("./engine.js");
const ai = require("./ai-scoring.js");

const { TERRAIN, CAR_SIZE, CAR_STATUS, createTestTile, createBoard, createCar, createCarOffBoard } = engine;
const { FACTORS, buildContext, computeStrategicProfile, chooseAiAssignCommand } = ai;

let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.log(`ÉCHEC : ${label}`); }
}

function simpleBoard(cols = 24, rows = 6) {
  const tile = createTestTile(cols, rows);
  return createBoard(tile);
}

function candidate(overrides) {
  return {
    kind: "move",
    car: null,
    moveDieIndex: 0,
    moveDieValue: 3,
    command: null,
    simulated: { finalCol: 3, finalRow: 2, eliminated: false, roadEligible: false, slam: null, isEntry: false },
    ...overrides
  };
}

// -----------------------------------------------------------------
// 1. efficaciteDe — pénalise un gros dé (5-6) sans Command associée
// et sans besoin de sortie immédiate.
// -----------------------------------------------------------------
{
  const board = simpleBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const ctx = { board, canReachLeadExit: () => false };

  const lowDie = candidate({ car, moveDieValue: 2 });
  const highDieNoCommand = candidate({ car, moveDieValue: 6, command: null });
  const highDieWithCommand = candidate({ car, moveDieValue: 6, command: { type: "nitro", dieIndex: 1, dieValue: 2 } });

  assert(FACTORS.efficaciteDe(lowDie, ctx) >= 0, "efficaciteDe : petit dé jamais pénalisé");
  assert(FACTORS.efficaciteDe(highDieNoCommand, ctx) < 0, "efficaciteDe : gros dé seul et inutile est pénalisé");
  assert(FACTORS.efficaciteDe(highDieWithCommand, ctx) >= FACTORS.efficaciteDe(highDieNoCommand, ctx),
    "efficaciteDe : le même gros dé accompagné d'une Command est moins pénalisé (ou égal)");
}

// -----------------------------------------------------------------
// 2. reserveDeCommand — bonus si un 6 reste dispo avec une voiture
// inopérable à réparer ; malus si le 6 traîne sans raison alors que
// d'autres voitures restent à activer.
// -----------------------------------------------------------------
{
  const board = simpleBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const inoperable = createCar("A", CAR_SIZE.MEDIUM, 2, 2);
  inoperable.status = CAR_STATUS.INOPERABLE;

  const poolWithSix = [2, 6];
  const cand = candidate({ car, moveDieIndex: 0, moveDieValue: 2, command: null });

  const ctxWithInoperable = {
    pool: poolWithSix, hasInoperableCar: true, otherEligibleCarsRemain: false
  };
  const ctxWithoutInoperable = {
    pool: poolWithSix, hasInoperableCar: false, otherEligibleCarsRemain: true
  };

  assert(FACTORS.reserveDeCommand(cand, ctxWithInoperable) > 0,
    "reserveDeCommand : bonus quand un 6 reste dispo ET qu'une voiture inopérable en a besoin");
  assert(FACTORS.reserveDeCommand(cand, ctxWithoutInoperable) < 0,
    "reserveDeCommand : malus quand un 6 traîne sans voiture inopérable et d'autres véhicules restent à jouer");
}

// -----------------------------------------------------------------
// 3. ordreActivation — Large avant Small/Medium en entrée round 1.
// -----------------------------------------------------------------
{
  const large = createCarOffBoard("A", CAR_SIZE.LARGE);
  const small = createCarOffBoard("A", CAR_SIZE.SMALL);
  const ctx = { eligibleCars: [large, small] };

  const largeCandidate = candidate({ car: large, simulated: { isEntry: true } });
  const smallCandidate = candidate({ car: small, simulated: { isEntry: true } });

  assert(FACTORS.ordreActivation(largeCandidate, ctx) > FACTORS.ordreActivation(smallCandidate, ctx),
    "ordreActivation : Large mieux noté que Small en entrée quand les deux sont éligibles");
}

// -----------------------------------------------------------------
// 4. rythmeMinimal — pénalise une progression < 2 cases ce round.
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const ctxNoProgress = { progressSoFarThisRound: {} };
  const laggingCandidate = candidate({ car, simulated: { finalCol: 1, finalRow: 2, eliminated: false } }); // +1
  const okCandidate = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false } }); // +3

  assert(FACTORS.rythmeMinimal(laggingCandidate, ctxNoProgress) < 0, "rythmeMinimal : progression <2 pénalisée");
  assert(FACTORS.rythmeMinimal(okCandidate, ctxNoProgress) > 0, "rythmeMinimal : progression 2-4 valorisée");
}

// -----------------------------------------------------------------
// 5. bonusRoadFutur — bonus si la case finale est Road.
// -----------------------------------------------------------------
{
  const board = simpleBoard(); // tout ROAD par défaut
  board.grid[2][5].terrain = TERRAIN.OFF_ROAD;
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const ctx = { board };

  const onRoad = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false } });
  const offRoad = candidate({ car, simulated: { finalCol: 5, finalRow: 2, eliminated: false } });

  assert(FACTORS.bonusRoadFutur(onRoad, ctx) > FACTORS.bonusRoadFutur(offRoad, ctx),
    "bonusRoadFutur : case Road mieux notée qu'une case Off-Road");
}

// -----------------------------------------------------------------
// 6. opportuniteTir — bonus si un adversaire tombe dans l'arc avant
// de la position finale simulée.
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 4, 2); // "front" depuis (3,2) si rangée paire
  const ctx = { allCars: [car, enemy] };

  const withTarget = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false } });
  const withoutTarget = candidate({ car, simulated: { finalCol: 3, finalRow: 5, eliminated: false } });

  assert(FACTORS.opportuniteTir(withTarget, ctx) > FACTORS.opportuniteTir(withoutTarget, ctx),
    "opportuniteTir : bonus quand un adversaire est atteignable après le mouvement");
}

// -----------------------------------------------------------------
// 7. risqueBordPlateau — malus si la case finale est en bord latéral.
// -----------------------------------------------------------------
{
  const board = simpleBoard(24, 6);
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const ctx = { board };

  const edge = candidate({ car, simulated: { finalCol: 3, finalRow: 0, eliminated: false } });
  const center = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false } });

  assert(FACTORS.risqueBordPlateau(edge, ctx) < FACTORS.risqueBordPlateau(center, ctx),
    "risqueBordPlateau : bord de plateau moins bien noté que le centre");
}

// -----------------------------------------------------------------
// 8. risqueSlamCumule — pire cas confirmé par Mayrik : adversaire de
// MÊME taille adjacent près d'un bord.
// -----------------------------------------------------------------
{
  const board = simpleBoard(24, 6);
  const car = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
  const sameSizeEnemyNearEdge = createCar("B", CAR_SIZE.MEDIUM, 3, 0);
  const ctxDanger = { board, allCars: [car, sameSizeEnemyNearEdge] };
  const ctxSafe = { board, allCars: [car] };

  const nearEdgeCandidate = candidate({ car, simulated: { finalCol: 3, finalRow: 0, eliminated: false } });

  assert(FACTORS.risqueSlamCumule(nearEdgeCandidate, ctxDanger) < FACTORS.risqueSlamCumule(nearEdgeCandidate, ctxSafe),
    "risqueSlamCumule : adversaire de même taille près d'un bord augmente le risque perçu");
}

// -----------------------------------------------------------------
// 9. slamVolontaire — favorable si ma voiture est plus grande ou
// égale à la cible, défavorable sinon ; toujours 0 sans slam.
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.LARGE, 0, 2);
  const smallTarget = createCar("B", CAR_SIZE.SMALL, 3, 2);
  const largeTarget = createCar("B", CAR_SIZE.LARGE, 3, 2);

  const ctxVsSmall = { allCars: [car, smallTarget] };
  const ctxVsLarge = { allCars: [car, largeTarget] };
  const slamCandidate = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false, slam: true } });
  const noSlamCandidate = candidate({ car, simulated: { finalCol: 3, finalRow: 2, eliminated: false, slam: null } });

  assert(FACTORS.slamVolontaire(slamCandidate, ctxVsSmall) > 0, "slamVolontaire : favorable contre une cible plus petite");
  assert(FACTORS.slamVolontaire(noSlamCandidate, ctxVsSmall) === 0, "slamVolontaire : nul sans slam en fin de trajectoire");
}

// -----------------------------------------------------------------
// 10. chasseLeader — bonus si l'écart avec le leader adverse diminue.
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const ctx = { leaderIsEnemy: true, leaderCol: 10 };

  const closing = candidate({ car, simulated: { finalCol: 5, finalRow: 2, eliminated: false } });
  const notClosing = candidate({ car, simulated: { finalCol: 0, finalRow: 2, eliminated: false } });

  assert(FACTORS.chasseLeader(closing, ctx) > FACTORS.chasseLeader(notClosing, ctx),
    "chasseLeader : réduire l'écart avec le leader adverse est valorisé");
}

// -----------------------------------------------------------------
// 11. progressionPure — bonus proportionnel à la distance avancée.
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const shortMove = candidate({ car, simulated: { finalCol: 1, finalRow: 2, eliminated: false } });
  const longMove = candidate({ car, simulated: { finalCol: 6, finalRow: 2, eliminated: false } });

  assert(FACTORS.progressionPure(longMove, {}) > FACTORS.progressionPure(shortMove, {}),
    "progressionPure : une plus grande distance avancée est mieux notée");
}

// -----------------------------------------------------------------
// 12. ciblageAirstrike — bonus si la cible est proche de la sortie
// (menace de fuite) et si le placement gêne sa trajectoire.
// -----------------------------------------------------------------
{
  const board = simpleBoard(24, 6);
  const nearExitTarget = createCar("B", CAR_SIZE.SMALL, 20, 2);
  const farTarget = createCar("B", CAR_SIZE.SMALL, 2, 2);

  const threatCandidate = candidate({
    command: { type: "airstrike", dieIndex: 1, dieValue: 4, target: nearExitTarget, placement: { col: 19, row: 2 } }
  });
  const mildCandidate = candidate({
    command: { type: "airstrike", dieIndex: 1, dieValue: 4, target: farTarget, placement: null }
  });

  assert(FACTORS.ciblageAirstrike(threatCandidate, { board }) > FACTORS.ciblageAirstrike(mildCandidate, { board }),
    "ciblageAirstrike : cible proche de la sortie + placement gênant mieux notée");
}

// -----------------------------------------------------------------
// 13. repairPriorite — gradation : 2 restants dont 1 inopérable =
// non-négociable (score maximal).
// -----------------------------------------------------------------
{
  const survivor = createCar("A", CAR_SIZE.SMALL, 5, 2);
  const inoperable = createCar("A", CAR_SIZE.MEDIUM, 3, 2);
  inoperable.status = CAR_STATUS.INOPERABLE;
  const ctx = { allCars: [survivor, inoperable] };

  const repairCandidate = candidate({ car: survivor, command: { type: "repair", dieIndex: 1, dieValue: 6, target: inoperable } });
  const otherCtx = {
    allCars: [
      createCar("A", CAR_SIZE.SMALL, 5, 2),
      createCar("A", CAR_SIZE.MEDIUM, 4, 2),
      (() => { const c = createCar("A", CAR_SIZE.LARGE, 3, 2); c.status = CAR_STATUS.OPERABLE; c.damageTokens = [{}]; return c; })()
    ]
  };
  const preventiveCandidate = candidate({
    car: otherCtx.allCars[0],
    command: { type: "repair", dieIndex: 1, dieValue: 6, target: otherCtx.allCars[2] }
  });

  assert(FACTORS.repairPriorite(repairCandidate, ctx) > FACTORS.repairPriorite(preventiveCandidate, otherCtx),
    "repairPriorite : 2 restants dont 1 inopérable (non-négociable) noté au-dessus d'un Repair préventif");
}

// -----------------------------------------------------------------
// 14. commandParElimination — Drift interdit sauf arc avant réellement
// bloqué (garde-fou corrigé au smoke-test précédent).
// -----------------------------------------------------------------
{
  const driftCandidate = candidate({ command: { type: "drift", dieIndex: 1, dieValue: 4 } });
  const ctxBlocked = { frontArcFullyBlocked: () => true };
  const ctxOpen = { frontArcFullyBlocked: () => false };

  assert(FACTORS.commandParElimination(driftCandidate, ctxBlocked) > 0,
    "commandParElimination : Drift valorisé seulement si l'arc avant est réellement bloqué");
  assert(FACTORS.commandParElimination(driftCandidate, ctxOpen) < 0,
    "commandParElimination : Drift pénalisé si l'arc avant n'est PAS bloqué (jamais un choix stratégique)");

  // Correctif issu de la revue qualitative avec Mayrik (10 cas
  // Assign+Command, 7/10 montraient un Nitro collé au premier
  // mouvement sans justification tactique) : Nitro doit être
  // pénalisé sauf s'il ouvre un tir, atteint la sortie de tuile, ou
  // permet un Slam favorable.
  const carN = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const nitroCandidate = { car: carN, moveDieValue: 5, command: { type: "nitro", dieValue: 2 }, simulated: { finalCol: 7, finalRow: 2, eliminated: false, slam: null } };
  const ctxNoTarget = { allCars: [carN], canReachLeadExit: () => false };
  const enemyInRange = createCar("B", CAR_SIZE.SMALL, 8, 2);
  const ctxWithTarget = { allCars: [carN, enemyInRange], canReachLeadExit: () => false };
  assert(FACTORS.commandParElimination(nitroCandidate, ctxNoTarget) < 0,
    "commandParElimination : Nitro pénalisé quand rien ne le justifie (pas de tir/sortie/slam)");
  assert(FACTORS.commandParElimination(nitroCandidate, ctxWithTarget) > 0,
    "commandParElimination : Nitro valorisé quand il ouvre un tir sur un adversaire");
}

// -----------------------------------------------------------------
// 15. usureAdverse — bonus Airstrike si la cible a déjà un dégât.
// -----------------------------------------------------------------
{
  const damagedTarget = createCar("B", CAR_SIZE.SMALL, 5, 2);
  damagedTarget.damageTokens = [{}];
  const freshTarget = createCar("B", CAR_SIZE.SMALL, 5, 2);

  const onDamaged = candidate({ command: { type: "airstrike", dieIndex: 1, dieValue: 2, target: damagedTarget } });
  const onFresh = candidate({ command: { type: "airstrike", dieIndex: 1, dieValue: 2, target: freshTarget } });

  assert(FACTORS.usureAdverse(onDamaged, {}) > FACTORS.usureAdverse(onFresh, {}),
    "usureAdverse : cibler une équipe déjà endommagée est valorisé");
}

// -----------------------------------------------------------------
// 16. computeStrategicProfile — cas simples des 3 profils.
// -----------------------------------------------------------------
{
  const soloCar = [createCar("A", CAR_SIZE.SMALL, 5, 2)];
  assert(computeStrategicProfile(soloCar, "A") === "echappee",
    "computeStrategicProfile : un seul véhicule restant = échappée par construction");

  const grouped = [createCar("A", CAR_SIZE.SMALL, 5, 2), createCar("A", CAR_SIZE.MEDIUM, 4, 2)];
  const enemyClose = [createCar("B", CAR_SIZE.SMALL, 4, 3)];
  assert(computeStrategicProfile([...grouped, ...enemyClose], "A") === "peloton",
    "computeStrategicProfile : deux véhicules groupés, écart faible avec l'adversaire = peloton par défaut");
}

// -----------------------------------------------------------------
// 17. Intégration légère — chooseAiAssignCommand ne renvoie jamais un
// dé hors du pool réel du joueur (garde-fou minimal, complète le
// harnais tools/run-shadow-legality.js qui teste ça à grande échelle
// sur de vraies parties).
// -----------------------------------------------------------------
{
  const board = simpleBoard(24, 6);
  const state = { rearTile: board.tiles[0], middleTile: board.tiles[0], leadTile: board.tiles[0], finishLineTile: null };
  const allCars = [
    createCar("A", CAR_SIZE.SMALL, 0, 1),
    createCar("A", CAR_SIZE.MEDIUM, 0, 2),
    createCar("A", CAR_SIZE.LARGE, 0, 3)
  ];
  const allChoppers = [];
  const dicePool = { A: [2, 4, 5, 6] };
  const roundState = { roundNumber: 1, commandUsedThisRound: { A: false } };

  const decision = chooseAiAssignCommand(board, state, allCars, allChoppers, dicePool, "A", roundState);
  assert(decision !== null, "chooseAiAssignCommand : retourne bien une décision quand des voitures/dés sont disponibles");
  assert(dicePool.A.includes(decision.dieValue), "chooseAiAssignCommand : le dé choisi appartient bien au pool du joueur");
  if (decision.command) {
    assert(dicePool.A.includes(decision.command.dieValue), "chooseAiAssignCommand : le dé de Command appartient bien au pool du joueur");
    assert(decision.command.dieValue !== decision.dieValue, "chooseAiAssignCommand : jamais le même dé pour le mouvement ET la Command");
  }
}

console.log(`\n${passed} test(s) passé(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

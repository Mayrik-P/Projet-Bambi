/**
 * Test dédié — trois bugs distincts trouvés en creusant la régression
 * Slam du 31/08 (voir test-ai-slam-restraint.js pour le premier
 * correctif de la même journée) :
 *
 * BUG A — Le "dernier recours" de resolveAdjacentCascade excluait les
 * Wreck (toujours status=INOPERABLE par nature, owner=null) via un
 * filtre `status === OPERABLE` trop strict, provoquant un crash
 * (destination: null) dès qu'une voiture bloquée n'avait plus QUE des
 * Wreck ou une sortie de plateau par le côté comme issue.
 *
 * BUG B — Ce même dernier recours ignorait "eliminated-edge" (sortie
 * de plateau par le côté, p.6) comme issue de repli valide, alors que
 * "eliminated-impassable" y était déjà : même symptôme (destination
 * null) sur un plateau étroit.
 *
 * BUG C — Les DEUX branches Coast (decideNoFinishLine et
 * decideFinishLineRush) retombaient, quand aucun adversaire
 * strictement plus petit n'était trouvé par findFrontArcSlamTarget,
 * sur un simple `.find(d => d.terminalReason === "slam")` — qui
 * prend le PREMIER Slam du tableau sans distinguer coéquipier
 * d'adversaire plus gros, retombant parfois sur l'adversaire plus
 * gros alors qu'un coéquipier (légitime en dernier recours) était
 * aussi disponible.
 *
 * À lancer avec : node test-ai-slam-fallback-priority.js
 */
const engine = require("./engine.js");
const ai = require("./ai-decision.js");
const { createTestTile, createCar, CAR_SIZE, CAR_STATUS, TERRAIN } = engine;

function section(t) { console.log("\n=== " + t + " ==="); }

// -----------------------------------------------------------------
// BUG A + B — reproduction exacte : voiture bloquée entre 2 Wreck et
// le bord GAUCHE du plateau (aucune case saine, aucun impassable,
// aucun adversaire/coéquipier réel — seulement des Wreck).
// -----------------------------------------------------------------
section("Bug A+B — Wreck + sortie de plateau par le côté comme seules issues -> pas de crash, Wreck percuté");

let board = createTestTile(10, 9);
for (let r = 0; r < 9; r++) for (let c = 0; c < 10; c++) board.grid[r][c].terrain = TERRAIN.ROAD;
const mover = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 0);
const wreck1 = createCar(null, CAR_SIZE.SMALL, 6, 0);
wreck1.status = CAR_STATUS.INOPERABLE;
const wreck2 = createCar(null, CAR_SIZE.SMALL, 5, 1);
wreck2.status = CAR_STATUS.INOPERABLE;
const allCars = [mover, wreck1, wreck2];

let threw = false;
let result;
try { result = ai.findBestTrajectory(board, mover, 3, allCars, [], false); }
catch (e) { threw = true; console.log("Erreur :", e.message); }
console.log("Pas de crash (attendu true) :", !threw);
console.log("Une destination existe (attendu true) :", !!result.destination);
console.log("C'est bien un Slam contre le Wreck (attendu true) :", result.slam && result.destination.slamTarget.owner === null);

// -----------------------------------------------------------------
// BUG C — Coast, adversaire plus gros ET coéquipier tous deux dans
// l'arc avant, aucun adversaire strictement plus petit -> doit
// préférer l'ADVERSAIRE (même plus gros, toujours une chance de le
// repousser lui via les dés de Slam), JAMAIS son propre coéquipier
// (risque pur d'auto-élimination, sans aucune contrepartie).
// -----------------------------------------------------------------
section("Bug C — Coast : coéquipier ET adversaire plus gros dans l'arc avant -> préfère l'ADVERSAIRE (précision de Mayrik, 31/08)");

const rearTile = createTestTile(10, 6);
for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) rearTile.grid[r][c].terrain = TERRAIN.ROAD;
const progressionState = engine.createTileProgressionState(
  rearTile, createTestTile(10, 6), createTestTile(10, 6)
);
const coastCar = createCar("Mayrik", CAR_SIZE.SMALL, 3, 3);
coastCar.movedThisRound = true;
coastCar.coastCount = 0;
const bigEnemy = createCar("IA-Adverse", CAR_SIZE.LARGE, 4, 3);      // arc avant "front"
const teammate = createCar("Mayrik", CAR_SIZE.MEDIUM, 4, 2);          // arc avant "front-left"
teammate.movedThisRound = true; // toutes les voitures de Mayrik doivent avoir bougé pour forcer un Coast (n===0)
const thirdBlocker = createCar("IA-Adverse", CAR_SIZE.LARGE, 4, 4); // bloque aussi "front-right" -> plus AUCUNE case saine ni impassable, seulement des Slam
const allCars2 = [coastCar, bigEnemy, teammate, thirdBlocker];
const roundState = engine.createRoundState(["Mayrik", "IA-Adverse"]);
roundState.dicePool["Mayrik"] = [4];
const board2 = engine.buildBoardFromProgressionState(progressionState);

const decision = ai.decideNoFinishLine(progressionState, board2, allCars2, [], roundState.dicePool, "Mayrik", roundState);
console.log("isCoast (attendu true) :", decision.isCoast);
console.log("Cible du Slam (attendu 'IA-Adverse' -- l'adversaire, jamais son propre coéquipier) :", decision.destination.slamTarget ? decision.destination.slamTarget.owner : "aucune");

section("Non-régression — Aucun adversaire nulle part, seulement des coéquipiers -> le coéquipier redevient le tout dernier recours");

const rearTile2 = createTestTile(10, 6);
for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) rearTile2.grid[r][c].terrain = TERRAIN.ROAD;
const progressionState2 = engine.createTileProgressionState(rearTile2, createTestTile(10, 6), createTestTile(10, 6));
const coastCar2 = createCar("Mayrik", CAR_SIZE.SMALL, 3, 3);
coastCar2.movedThisRound = true;
const teammate2a = createCar("Mayrik", CAR_SIZE.LARGE, 4, 3);
const teammate2b = createCar("Mayrik", CAR_SIZE.LARGE, 4, 2);
const teammate2c = createCar("Mayrik", CAR_SIZE.LARGE, 4, 4);
[teammate2a, teammate2b, teammate2c].forEach((c) => { c.movedThisRound = true; });
const allCars3 = [coastCar2, teammate2a, teammate2b, teammate2c];
const roundState2 = engine.createRoundState(["Mayrik", "IA-Adverse"]);
roundState2.dicePool["Mayrik"] = [4];
const board3 = engine.buildBoardFromProgressionState(progressionState2);
const decision2 = ai.decideNoFinishLine(progressionState2, board3, allCars3, [], roundState2.dicePool, "Mayrik", roundState2);
console.log("Cible (attendu 'Mayrik' -- aucun adversaire nulle part, le coéquipier redevient légitime) :", decision2.destination.slamTarget ? decision2.destination.slamTarget.owner : "aucune");

console.log("\n=== Fin des tests dédiés (dernier recours Slam — 3 bugs) ===");

/**
 * Test dédié — correctif régression Slam (retour de Mayrik, 31/08) :
 * un Slam ne doit JAMAIS gagner la cascade T1-T8 sur la seule base du
 * terrain (peu importe qui occupe la case). Les deux règles voulues :
 *   1. Slammer sa PROPRE équipe : uniquement en tout dernier recours,
 *      si aucune autre trajectoire n'existe nulle part.
 *   2. Slammer un ADVERSAIRE : uniquement via resolveRearArcSlam (arc
 *      arrière de la meilleure case saine, coûte au plus 1 case), et
 *      seulement si strictement plus petit.
 * À lancer avec : node test-ai-slam-restraint.js
 */
const engine = require("./engine.js");
const ai = require("./ai-decision.js");
const { createTestTile, createCar, CAR_SIZE, TERRAIN } = engine;

function section(t) { console.log("\n=== " + t + " ==="); }
function flatBoard(cols = 10, rows = 6) {
  const b = createTestTile(cols, rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) b.grid[r][c].terrain = TERRAIN.ROAD;
  return b;
}

section("Règle 1 — Coéquipier plus gros sur le chemin : jamais slammé si une case saine existe");
let board = flatBoard();
let mover = createCar("IA", CAR_SIZE.SMALL, 2, 3);
let teammate = createCar("IA", CAR_SIZE.LARGE, 5, 3);
let result = ai.findBestTrajectory(board, mover, 3, [mover, teammate], []);
console.log("Slam (attendu false) :", result.slam);
console.log("Voiture toujours opérable, jamais touchée (attendu true) :", teammate.status === "operable" && teammate.damageTokens.length === 0);

section("Règle 2a — Adversaire PLUS GROS : jamais slammé si une case saine existe, même proche");
board = flatBoard();
mover = createCar("IA", CAR_SIZE.SMALL, 2, 3);
let bigEnemy = createCar("Adversaire", CAR_SIZE.LARGE, 5, 3);
result = ai.findBestTrajectory(board, mover, 3, [mover, bigEnemy], []);
console.log("Slam (attendu false) :", result.slam);

section("Règle 2b — Adversaire PLUS PETIT, à 1 case de la meilleure trajectoire -> Slam légitime (arc arrière)");
board = flatBoard();
mover = createCar("IA", CAR_SIZE.LARGE, 2, 3);
let smallEnemy = createCar("Adversaire", CAR_SIZE.SMALL, 4, 3);
result = ai.findBestTrajectory(board, mover, 3, [mover, smallEnemy], []);
console.log("Slam (attendu true, arc arrière, coût de 1 case) :", result.slam);
console.log("Cible bien l'adversaire (attendu true) :", result.destination.slamTarget === smallEnemy);

section("Non-régression — Voiture totalement bloquée par ses propres véhicules plus petits : Slam en dernier recours, pas de crash");
board = flatBoard(6, 6);
mover = createCar("IA", CAR_SIZE.MEDIUM, 2, 2);
const blockers = [
  createCar("IA", CAR_SIZE.SMALL, 2, 1),
  createCar("IA", CAR_SIZE.SMALL, 3, 2),
  createCar("IA", CAR_SIZE.SMALL, 2, 3)
];
let threw = false;
try { result = ai.findBestTrajectory(board, mover, 6, [mover, ...blockers], []); }
catch (e) { threw = true; console.log("Erreur :", e.message); }
console.log("Pas de crash (attendu true) :", !threw);
console.log("Une destination existe (attendu true) :", !!result.destination);

section("Non-régression — Bloqué, mélange adversaire/coéquipier plus petits -> préfère toujours l'adversaire");
board = flatBoard(6, 6);
mover = createCar("IA", CAR_SIZE.MEDIUM, 2, 2);
const mixedBlockers = [
  createCar("IA", CAR_SIZE.SMALL, 2, 1),
  createCar("Adversaire", CAR_SIZE.SMALL, 3, 2),
  createCar("IA", CAR_SIZE.SMALL, 2, 3)
];
result = ai.findBestTrajectory(board, mover, 6, [mover, ...mixedBlockers], []);
console.log("Cible du Slam est bien l'adversaire (attendu 'Adversaire') :", result.destination.slamTarget.owner);

console.log("\n=== Fin des tests dédiés (correctif régression Slam) ===");

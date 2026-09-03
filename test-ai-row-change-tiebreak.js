/**
 * Test dédié — départage secondaire par nombre de changements de
 * ligne (retour de Mayrik, 03/09, suite au signalement d'un
 * "zigzag" bizarre : base choisie sur une case qui forçait ensuite un
 * détour pour le bonus Road).
 *
 * Mayrik a d'abord suggéré un motif fixe pair/impair (lignes 1-3-5
 * "larges", 0-2-4 "étroites" — confirmé exact structurellement), puis
 * a lui-même nuancé : la ligne d'arrivée suit le même quinconce, donc
 * un motif pair/impair fixe n'est pas fiable partout sur le plateau.
 * Le vrai levier retenu, plus général : à danger d'arrivée ÉGAL,
 * préférer le chemin avec le MOINS de changements de ligne
 * (front-left/front-right), plutôt qu'un motif de parité codé en dur.
 *
 * À lancer avec : node test-ai-row-change-tiebreak.js
 */
const engine = require("./engine.js");
const ai = require("./ai-decision.js");
const { createTestTile, createCar, CAR_SIZE, TERRAIN, HAZARD_TYPES } = engine;

function section(t) { console.log("\n=== " + t + " ==="); }

// -----------------------------------------------------------------
// Cas 1 — Danger identique partout (aucun hazard) : le chemin le plus
// direct (0 changement de ligne) doit toujours l'emporter.
// -----------------------------------------------------------------
section("Cas 1 — Danger égal partout -> le chemin 100% 'front' gagne, jamais un détour diagonal");

let board = createTestTile(10, 6);
for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) board.grid[r][c].terrain = TERRAIN.ROAD;
let car = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
let candidates = ai.computeReachableDestinations(board, car, 4, [car], [], false);
let result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
console.log("Destination :", result.destination.col, result.destination.row);
console.log("Chemin 100% direct, 0 changement de ligne (attendu true) :", result.destination.path.every((d) => d === "front"));

// -----------------------------------------------------------------
// Cas 2 — Non-régression : le danger de hazard reste TOUJOURS
// prioritaire sur le nombre de changements de ligne (le nouveau
// critère n'est qu'un départage SECONDAIRE, jamais avant le danger).
// -----------------------------------------------------------------
section("Cas 2 — Non-régression : un danger réel l'emporte toujours sur un chemin plus direct mais dangereux");

board = createTestTile(10, 6);
for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) board.grid[r][c].terrain = TERRAIN.ROAD;
board.grid[2][5].hazard = HAZARD_TYPES.MINE; // voisin direct de (4,3), le chemin 100% "front"
car = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
candidates = ai.computeReachableDestinations(board, car, 4, [car], [], false);
result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
console.log("Destination (attendu (4,4), moins dangereuse malgré le détour) :", result.destination.col, result.destination.row);
console.log("Le chemin comporte bien un changement de ligne, accepté car plus sûr (attendu true) :", result.destination.path.some((d) => d !== "front"));

// -----------------------------------------------------------------
// Cas 3 — Le critère s'applique aussi à l'extension du bonus Road,
// pas seulement à la case de base (même fonction, deux usages).
// -----------------------------------------------------------------
section("Cas 3 — Le départage s'applique aussi au choix de l'extension du bonus Road");

board = createTestTile(10, 6);
for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) board.grid[r][c].terrain = TERRAIN.ROAD;
car = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
candidates = ai.computeReachableDestinations(board, car, 3, [car], [], false);
result = ai.chooseBestTrajectory(board, car, candidates, 1, [car], []);
console.log("Bonus utilisé (attendu true) :", result.roadBonusUsed);
console.log("Chemin du bonus, direct si possible (attendu ['front']) :", JSON.stringify(result.roadBonusPath));

console.log("\n=== Fin des tests dédiés (départage par changement de ligne) ===");

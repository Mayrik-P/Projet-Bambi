/**
 * Test dédié — unification des trois fonctions de trajectoire IA en
 * une seule (retour de Mayrik, 29/08 : "je veux exactement ce qui est
 * dessiné dans mon arbre"). `chooseGeneralTrajectory` et
 * `chooseEntryTrajectory` (deux implémentations plus anciennes et
 * plus simples, sans la gradation à 8 paliers de l'arbre) sont
 * retirées ; `findBestTrajectory` délègue systématiquement à
 * `chooseBestTrajectory`, quelle que soit la situation (entrée ou
 * mouvement, round 1 ou non).
 *
 * Deux vrais bugs ont été trouvés — et corrigés — en réalisant cette
 * fusion (des cas jamais exercés tant que chooseBestTrajectory ne
 * servait qu'à decideFirstRound) :
 *   1. `isValidStop` excluait "slam" de tous les paliers — une
 *      voiture totalement bloquée par des véhicules plus petits
 *      (aucune issue sauf les percuter) obtenait `destination: null`
 *      → crash. Corrigé : "slam" est un arrêt valide comme les
 *      autres, classé par paliers normalement (le terrain sous la
 *      voiture qui l'occupe ne change pas).
 *   2. Une sortie de plateau par l'avant (`exits-front`) n'a pas de
 *      terrain propre (hors tuile) — dans un plateau de test à plat,
 *      sans notion de tuiles, ça peut sembler dégrader le résultat
 *      par rapport à une case plus proche mais "route pure". EN JEU
 *      RÉEL, ce n'est jamais un problème : la tuile Finish Line est
 *      déjà codée en Route (createFinishLineTile, engine.js), donc
 *      une fois posée, l'atteindre est un arrêt "normal" classé
 *      normalement par la cascade — vérifié ci-dessous avec le vrai
 *      mécanisme d'assemblage du plateau (tuiles réelles), pas un
 *      plateau de test simplifié.
 *
 * À lancer avec : node test-ai-unified-trajectory.js
 */
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("./engine.js");
const ai = require("./ai-decision.js");
const { createCar, CAR_SIZE, TERRAIN, createFinishLineTile, buildBoardFromProgressionState, createTileProgressionState, setupTileProgressionFromRawData } = engine;

function section(t) { console.log("\n=== " + t + " ==="); }

console.log("Les deux anciennes fonctions ont bien disparu (attendu 'undefined' x2) :", typeof ai.chooseGeneralTrajectory, typeof ai.chooseEntryTrajectory);
console.log("findBestTrajectory est bien exportée (attendu 'function') :", typeof ai.findBestTrajectory);

// -----------------------------------------------------------------
// BUG 1 — Slam comme seule issue (voiture totalement bloquée par des
// véhicules plus petits) : ne doit plus jamais planter.
// -----------------------------------------------------------------
section("Bug 1 — Voiture bloquée de toutes parts par des véhicules plus petits -> Slam choisi, pas de crash");

const engine2 = engine;
function makeSmallTestBoard() {
  const board = engine2.createTestTile(6, 6);
  board.grid.forEach((row) => row.forEach((cell) => { cell.terrain = TERRAIN.ROAD; }));
  return board;
}
const board1 = makeSmallTestBoard();
const car1 = createCar("A", CAR_SIZE.MEDIUM, 2, 2);
const blockers1 = [
  createCar("B", CAR_SIZE.SMALL, 2, 1),
  createCar("B", CAR_SIZE.SMALL, 3, 2),
  createCar("B", CAR_SIZE.SMALL, 2, 3)
];
let threw = false;
let result1;
try {
  result1 = ai.findBestTrajectory(board1, car1, 6, [car1, ...blockers1], []);
} catch (e) {
  threw = true;
  console.log("Erreur inattendue :", e.message);
}
console.log("Aucune exception levée (attendu true) :", !threw);
console.log("Une destination a bien été choisie, pas null (attendu true) :", !!result1.destination);
console.log("C'est bien un Slam (seule issue possible ici) (attendu true) :", result1.destination.terminalReason === "slam");

// -----------------------------------------------------------------
// BUG 2 — Ligne d'arrivée : avec le vrai mécanisme d'assemblage de
// tuiles (pas un plateau de test à plat), l'atteindre est un arrêt
// "normal" classé T1 (route pure), jamais une sortie de plateau.
// -----------------------------------------------------------------
section("Bug 2 — Ligne d'arrivée (vraies tuiles) : atteinte normalement, classée Route pure");

function loadRealTiles() {
  const dir = "/home/claude/Projet-Bambi/tiles/data";
  return fs.readdirSync(dir).map((file) => {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    const varName = "TILE_VENDETTA_" + path.basename(file, ".js").replace("vendetta-", "").toUpperCase();
    const sandbox = { TERRAIN, module: { exports: null } };
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nmodule.exports = typeof ${varName} !== "undefined" ? ${varName} : null;`, sandbox);
    return sandbox.module.exports;
  }).filter(Boolean);
}

const rawTiles = loadRealTiles();
let setup, attempts = 0;
do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 }); attempts++; } while (!setup.ok && attempts < 20);
const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
progressionState.finishLineTile = createFinishLineTile(progressionState.rearTile.rows);
const board2 = buildBoardFromProgressionState(progressionState);
const finishColStart = progressionState.rearTile.cols + progressionState.middleTile.cols + progressionState.leadTile.cols;

const car2 = createCar("A", CAR_SIZE.SMALL, finishColStart - 4, 2);
const result2 = ai.findBestTrajectory(board2, car2, 6, [car2], []);
console.log("Ligne d'arrivée atteinte (attendu true) :", result2.destination.col >= finishColStart);
const cell2 = engine2.getSpace(board2, result2.destination.col, result2.destination.row);
console.log("Arrêt normal sur route, pas une sortie de plateau (attendu 'road') :", cell2.terrain);

// -----------------------------------------------------------------
// Non-régression — self-play déjà validé à 2000 parties par ailleurs
// (voir docs/rewrite-plan.md) ; ici, un simple contrôle direct que
// findBestTrajectory reste cohérente pour entrée ET mouvement.
// -----------------------------------------------------------------
section("Non-régression — findBestTrajectory fonctionne identiquement pour l'entrée ET le mouvement");

const board3 = makeSmallTestBoard();
const enteringCar = createCar("A", CAR_SIZE.MEDIUM, null, null);
const entryResult = ai.findBestTrajectory(board3, enteringCar, 4, [enteringCar], []);
console.log("Entrée en jeu : destination valide (attendu true) :", !!entryResult.destination && entryResult.destination.col > 0);

const board4 = makeSmallTestBoard();
const movingCar = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
const moveResult = ai.findBestTrajectory(board4, movingCar, 4, [movingCar], []);
console.log("Mouvement normal : destination valide (attendu true) :", !!moveResult.destination && moveResult.destination.col > 0);

console.log("\n=== Fin des tests dédiés (unification des trois fonctions de trajectoire) ===");

/**
 * Test dédié — pause visuelle case par case pendant le tour de l'IA
 * (demande de Mayrik, 28/08) : `options.emitSteps` fait `yield` un
 * objet {type:"step", car, col, row} à CHAQUE case franchie durant le
 * mouvement (normale, forcée par un Slam/Skid/Oil Slick), sans jamais
 * affecter les règles ni l'issue de la partie. Absent par défaut —
 * AUCUN changement de comportement pour tout code existant.
 * À lancer avec : node test-ai-step-pause.js
 */
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const {
  createTileProgressionState, setupTileProgressionFromRawData,
  createRoundState, createCar, CAR_SIZE, TERRAIN, getSpace,
  buildBoardFromProgressionState
} = require("./engine.js");
const { executeDecisionGen, driveInteractive } = require("./turn-executor.js");

function section(title) { console.log("\n=== " + title + " ==="); }

function loadRealTiles() {
  const dir = path.join(__dirname, "tiles", "data");
  return fs.readdirSync(dir).map((file) => {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    const varName = "TILE_VENDETTA_" + path.basename(file, ".js").replace("vendetta-", "").toUpperCase();
    const sandbox = { TERRAIN, module: { exports: null } };
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nmodule.exports = typeof ${varName} !== "undefined" ? ${varName} : null;`, sandbox);
    return sandbox.module.exports;
  }).filter(Boolean);
}

function freshProgressionState() {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 }); attempts++; } while (!setup.ok && attempts < 20);
  return createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
}

function clearHazardsAlong(progressionState, cells) {
  const board = buildBoardFromProgressionState(progressionState);
  for (const { col, row } of cells) {
    const cell = getSpace(board, col, row);
    if (cell) cell.hazard = null;
  }
}

// -----------------------------------------------------------------
// TEST 1 — emitSteps: true -> une pause "step" par case franchie,
// avec la position déjà mise à jour à CHAQUE pause (pas seulement à
// la toute fin).
// -----------------------------------------------------------------
section("Test 1 — emitSteps:true : une pause par case, position déjà à jour à chaque pause");

let progressionState = freshProgressionState();
clearHazardsAlong(progressionState, [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }]);
let roundState = createRoundState(["Vous", "IA"]);
let allCars = [];
const aiCar = createCar("IA", CAR_SIZE.SMALL, 3, 3);
allCars.push(aiCar);
roundState.dicePool["IA"] = [3, 4, 4, 1];

const decision = {
  car: aiCar, dieValue: 3, command: null, isEntry: false, isCoast: false,
  destination: { path: ["front", "front", "front"] }, slam: null, roadBonusPath: null
};

const gen = executeDecisionGen(progressionState, roundState, allCars, [], ["Vous", "IA"], "IA", decision, {
  isHumanOwner: (owner) => owner === "Vous",
  emitSteps: true
});

const positionsSeenAtPause = [];
let outcome = driveInteractive(gen);
while (!outcome.done) {
  if (outcome.pending.type === "step") {
    positionsSeenAtPause.push({ col: outcome.pending.car.col, row: outcome.pending.car.row });
  }
  outcome = outcome.resume();
}

console.log("Nombre de pauses 'step' obtenues (attendu 3, une par case) :", positionsSeenAtPause.length);
console.log("Positions vues, dans l'ordre (attendu 4,5,6 en colonne) :", positionsSeenAtPause.map((p) => p.col).join(","));
console.log("La voiture est bien arrivée en (col 6, row 3) au final (attendu true) :", aiCar.col === 6 && aiCar.row === 3);

// -----------------------------------------------------------------
// TEST 2 — Non-régression : SANS emitSteps (comportement par défaut,
// tout le code existant), AUCUNE pause de type "step" ne doit jamais
// apparaître — seul un Slam impliquant une voiture humaine pourrait
// encore mettre en pause (type "slam-reroll", inchangé).
// -----------------------------------------------------------------
section("Test 2 — Sans emitSteps : aucune pause 'step', comportement 100% inchangé");

progressionState = freshProgressionState();
clearHazardsAlong(progressionState, [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }]);
roundState = createRoundState(["Vous", "IA"]);
allCars = [];
const aiCar2 = createCar("IA", CAR_SIZE.SMALL, 3, 3);
allCars.push(aiCar2);
roundState.dicePool["IA"] = [3, 4, 4, 1];
const decision2 = { car: aiCar2, dieValue: 3, command: null, isEntry: false, isCoast: false, destination: { path: ["front", "front", "front"] }, slam: null, roadBonusPath: null };
const gen2 = executeDecisionGen(progressionState, roundState, allCars, [], ["Vous", "IA"], "IA", decision2, {
  isHumanOwner: (owner) => owner === "Vous"
  // pas de emitSteps
});
let stepPauses2 = 0;
let outcome2 = driveInteractive(gen2);
while (!outcome2.done) {
  if (outcome2.pending.type === "step") stepPauses2++;
  outcome2 = outcome2.resume(false);
}
console.log("Aucune pause 'step' obtenue (attendu 0) :", stepPauses2);
console.log("La voiture est bien arrivée au bon endroit malgré tout (attendu true) :", aiCar2.col === 6 && aiCar2.row === 3);

// -----------------------------------------------------------------
// TEST 3 — emitSteps + Slam en cours de route : les deux types de
// pause ({type:"step"} et {type:"slam-reroll"}) doivent cohabiter
// sans se marcher dessus dans la même exécution.
// -----------------------------------------------------------------
section("Test 3 — emitSteps + Slam contre une voiture humaine plus grande en cours de route : les 2 types de pause cohabitent");

progressionState = freshProgressionState();
clearHazardsAlong(progressionState, [{ col: 4, row: 3 }, { col: 5, row: 3 }]);
roundState = createRoundState(["Vous", "IA"]);
allCars = [];
const aiCar3 = createCar("IA", CAR_SIZE.SMALL, 3, 3);
const humanBlocker = createCar("Vous", CAR_SIZE.LARGE, 5, 3);
allCars.push(aiCar3, humanBlocker);
roundState.dicePool["IA"] = [2, 4, 4, 1];
const decision3 = { car: aiCar3, dieValue: 2, command: null, isEntry: false, isCoast: false, destination: { path: ["front", "front"] }, slam: null, roadBonusPath: null };
const gen3 = executeDecisionGen(progressionState, roundState, allCars, [], ["Vous", "IA"], "IA", decision3, {
  isHumanOwner: (owner) => owner === "Vous",
  emitSteps: true
});
const typesSeen = [];
let outcome3 = driveInteractive(gen3);
while (!outcome3.done) {
  typesSeen.push(outcome3.pending.type);
  outcome3 = outcome3.resume(outcome3.pending.type === "slam-reroll" ? false : undefined);
}
console.log("Séquence des types de pause obtenue (attendu : step, step, slam-reroll) :", typesSeen.join(", "));

console.log("\n=== Fin des tests dédiés (pause visuelle case par case, IA) ===");

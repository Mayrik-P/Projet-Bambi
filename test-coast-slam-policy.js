/**
 * Test manuel dédié — correctif "Coast oublié" (demande de Mayrik,
 * 28/08) : avant ce correctif, un tour Coast exécuté via
 * executeDecision/executeDecisionGen (turn-executor.js) ne transmettait
 * PAS `decideReroll`/`isHumanOwner` à playTurnCoastWithProgression —
 * un Slam survenant pendant un Coast retombait donc sur le défaut
 * neutre "jamais relancer" au lieu de la politique IA normale
 * (`ai.decideSlamRerollDefault` : relance TOUJOURS quand c'est la
 * propre voiture de l'IA qui bougerait suite au Slam).
 * À lancer avec : node test-coast-slam-policy.js
 */

const {
  createTileProgressionState, setupTileProgressionFromRawData,
  createRoundState, createCar, CAR_SIZE, CAR_STATUS,
  buildBoardFromProgressionState, getSpace, getFrontArc, getRearArc
} = require("./engine.js");
const { executeDecision, executeDecisionGen, driveInteractive } = require("./turn-executor.js");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { TERRAIN } = require("./engine.js");

function section(title) {
  console.log("\n=== " + title + " ===");
}

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

// Neutralise le hazard face cachée de (col,row) ET de ses 6 voisins —
// nécessaire pour rendre déterministe un scénario de Slam sur les
// vraies tuiles (sinon un hazard révélé avant même d'atteindre
// l'occupant peut couper le mouvement en cours de route, ou déclencher
// un Slam en chaîne aléatoire ; voir test-ui-ai-slam-reroll.js pour le
// même besoin déjà rencontré côté UI).
function clearHazardsAround(progressionState, col, row) {
  const board = buildBoardFromProgressionState(progressionState);
  getSpace(board, col, row).hazard = null;
  const front = getFrontArc({ col, row });
  const rear = getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = getSpace(board, c, r);
    if (cell) cell.hazard = null;
  }
}

let progressionState, roundState, allCars, allChoppers;

// -----------------------------------------------------------------
// TEST 1 — Coast : la politique IA (`ai.decideSlamRerollDefault`) est
// désormais bien CONSULTÉE pour un Slam pendant un Coast (avant le
// correctif, aucune `decideReroll` n'était transmise du tout à
// playTurnCoastWithProgression — le défaut neutre `() => false`
// s'appliquait silencieusement, sans jamais consulter la politique
// IA). On le vérifie en substituant temporairement
// `ai.decideSlamRerollDefault` par un espion, plutôt qu'en dépendant
// du dé de Slam aléatoire (non forçable via executeDecision).
// -----------------------------------------------------------------
section("Test 1 — executeDecision, tour Coast : la politique IA est bien consultée (elle ne l'était pas avant le correctif)");

const ai = require("./ai-decision.js");
const originalDecideSlamRerollDefault = ai.decideSlamRerollDefault;
let spyCalled = false;
let spyContext = null;
ai.decideSlamRerollDefault = (context) => {
  spyCalled = true;
  spyContext = context;
  return originalDecideSlamRerollDefault(context);
};

try {
  progressionState = freshProgressionState();
  clearHazardsAround(progressionState, 4, 3);
  roundState = createRoundState(["Vous", "IA"]);
  allCars = [];
  allChoppers = [];
  const aiCarCoast = createCar("IA", CAR_SIZE.LARGE, 3, 3);
  aiCarCoast.movedThisRound = true; // condition Coast : déjà activée ce round
  const humanCarCoast = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
  allCars.push(aiCarCoast, humanCarCoast);
  roundState.dicePool["IA"] = [1, 2, 3, 4];

  const decisionCoast = {
    car: aiCarCoast,
    dieValue: 1,
    command: null,
    isEntry: false,
    isCoast: true,
    destination: { path: ["front"] },
    slam: null,
    roadBonusPath: null
  };

  const result = executeDecision(progressionState, roundState, allCars, allChoppers, ["Vous", "IA"], "IA", decisionCoast);
  console.log("Exécution réussie (attendu true) :", result.ok);
  console.log("La politique IA a bien été consultée pour ce Slam pendant le Coast (attendu true — ne l'était PAS avant le correctif) :", spyCalled);
  console.log("Le contexte transmis désigne bien aiCarCoast/humanCarCoast comme les deux voitures en jeu (attendu true) :",
    !!spyContext && [spyContext.topCar, spyContext.bottomCar].every((c) => c === aiCarCoast || c === humanCarCoast));
} finally {
  ai.decideSlamRerollDefault = originalDecideSlamRerollDefault;
}

// -----------------------------------------------------------------
// TEST 2 — Non-régression : dans le même scénario, si c'est la
// voiture HUMAINE qui bougerait suite au Slam (donc PAS la politique
// IA "relance toujours pour sa propre voiture"), la politique par
// défaut ne relance pas non plus côté synchrone (executeDecision) —
// comportement inchangé pour l'IA vs IA / self-play.
// -----------------------------------------------------------------
section("Test 2 — executeDecision, tour Coast : la politique IA ne relance PAS pour une voiture qui n'est pas la sienne");

progressionState = freshProgressionState();
clearHazardsAround(progressionState, 4, 3);
roundState = createRoundState(["Vous", "IA"]);
allCars = [];
allChoppers = [];
const humanCarCoast2 = createCar("Vous", CAR_SIZE.LARGE, 5, 3);
const aiCarCoast2 = createCar("IA", CAR_SIZE.SMALL, 4, 3);
allCars.push(humanCarCoast2, aiCarCoast2);
// C'est ici la voiture IA (aiCarCoast2) qui "coaste" et avance en
// "front" (col 4 → col 5) directement sur la grande voiture humaine.
aiCarCoast2.movedThisRound = true;
roundState.dicePool["IA"] = [1, 2, 3, 4];
const decisionCoast2 = { car: aiCarCoast2, dieValue: 1, command: null, isEntry: false, isCoast: true, destination: { path: ["front"] }, slam: null, roadBonusPath: null };

const ai2 = require("./ai-decision.js");
const originalDefault2 = ai2.decideSlamRerollDefault;
let spy2Called = false;
let spy2Context = null;
ai2.decideSlamRerollDefault = (context) => {
  spy2Called = true;
  spy2Context = context;
  return originalDefault2(context);
};
let result2;
try {
  result2 = executeDecision(progressionState, roundState, allCars, allChoppers, ["Vous", "IA"], "IA", decisionCoast2);
} finally {
  ai2.decideSlamRerollDefault = originalDefault2;
}
console.log("Exécution réussie (attendu true) :", result2.ok);
console.log("La politique IA a bien été consultée (attendu true) :", spy2Called);
console.log("largerCar transmis à la politique = humanCarCoast2 (attendu true — c'est bien SA voiture qui est plus grande, jamais celle de l'IA ici) :",
  spy2Context?.largerCar === humanCarCoast2);

// -----------------------------------------------------------------
// TEST 3 — executeDecisionGen : un Slam pendant un Coast IA où la
// voiture plus grande est HUMAINE doit désormais aussi mettre la
// résolution en PAUSE (isHumanOwner), comme pour un mouvement normal.
// -----------------------------------------------------------------
section("Test 3 — executeDecisionGen, tour Coast : Slam direct, voiture humaine plus grande → doit YIELD (comme un mouvement normal)");

progressionState = freshProgressionState();
clearHazardsAround(progressionState, 4, 3);
roundState = createRoundState(["Vous", "IA"]);
allCars = [];
allChoppers = [];
const aiCarCoast3 = createCar("IA", CAR_SIZE.SMALL, 3, 3);
aiCarCoast3.movedThisRound = true;
const humanCarCoast3 = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
allCars.push(aiCarCoast3, humanCarCoast3);
roundState.dicePool["IA"] = [1, 2, 3, 4];
const decisionCoast3 = { car: aiCarCoast3, dieValue: 1, command: null, isEntry: false, isCoast: true, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const gen3 = executeDecisionGen(progressionState, roundState, allCars, allChoppers, ["Vous", "IA"], "IA", decisionCoast3, {
  isHumanOwner: (owner) => owner === "Vous"
});
const outcome3 = driveInteractive(gen3);
console.log("Pause obtenue (attendu true) :", !outcome3.done);
console.log("Type de pause (attendu 'slam-reroll') :", outcome3.pending?.type);
console.log("Voiture plus grande signalée = humanCarCoast3 (attendu true) :", outcome3.pending?.largerCar === humanCarCoast3);
const final3 = outcome3.resume(false);
console.log("Résolution terminée après reprise (attendu true) :", final3.done);

console.log("\n=== Fin des tests dédiés (correctif Coast) ===");

/**
 * Test manuel dédié — chantier "chaîne mouvement" (générateurs JS pour
 * pauses interactives de Slam), voir docs/rewrite-plan.md.
 * À lancer avec : node test-slam-reroll-generators.js
 *
 * Vérifie :
 *  1. Un Slam direct (occupant déjà présent) contre une voiture PLUS
 *     GRANDE appartenant à un joueur marqué "humain" (isHumanOwner)
 *     met bien la résolution en PAUSE (yield) au lieu de décider
 *     automatiquement — même en passant par moveCarGen SANS jamais
 *     appeler la version synchrone.
 *  2. Reprendre le générateur avec .next(true / false) applique
 *     exactement la réponse donnée (relance ou non), jusqu'au bout.
 *  3. Un Slam contre une voiture plus grande appartenant à l'IA
 *     (isHumanOwner renvoie false pour ce owner) NE met JAMAIS en
 *     pause — comportement synchrone inchangé, comme avant.
 *  4. Même mécanique pour un Slam révélé par un Wreck (owner humain).
 *  5. La version SYNCHRONE (moveCar, sans isHumanOwner) ne yield
 *     jamais, quel que soit le owner — garantie de compatibilité.
 *  6. executeDecisionGen (turn-executor.js) : bout en bout via
 *     driveInteractive, pour un Slam direct pendant un tour IA
 *     impliquant une voiture humaine.
 */

const {
  createTestTile, createCar, CAR_SIZE, CAR_STATUS, HAZARD_TYPES,
  moveCar, moveCarGen, buildBoardFromProgressionState, getSpace,
  getFrontArc, getRearArc
} = require("./engine.js");

function section(title) {
  console.log("\n=== " + title + " ===");
}

function drain(gen, responder) {
  let step = gen.next();
  let yields = 0;
  while (!step.done) {
    yields++;
    step = gen.next(responder(step.value));
  }
  return { value: step.value, yields };
}

// -----------------------------------------------------------------
// TEST 1 — Slam direct, voiture plus grande = joueur "Vous" (humain)
// -----------------------------------------------------------------
section("Test 1 — Slam direct, voiture plus grande humaine → doit YIELD");

let tile = createTestTile(8, 6);
let mover = createCar("IA", CAR_SIZE.SMALL, 3, 3);
let occupant = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
let cars = [mover, occupant];

const isHumanOwner = (owner) => owner === "Vous";

let gen = moveCarGen(tile, mover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front-left" },
  isHumanOwner
});

let first = gen.next();
console.log("Générateur en pause après le 1er next() (attendu false) :", first.done);
console.log("Type de la pause (attendu 'slam-reroll') :", first.value?.type);
console.log("Voiture plus grande = occupant (attendu true) :", first.value?.largerCar === occupant);
console.log("Voiture plus petite = mover (attendu true) :", first.value?.smallerCar === mover);

let resumed = gen.next(false); // le joueur répond "Non, garder ce résultat"
console.log("Générateur terminé après reprise (attendu true) :", resumed.done);
console.log("Résultat renvoyé a bien un slam (attendu true) :", !!resumed.value.slam);

// -----------------------------------------------------------------
// TEST 2 — Même scénario, le joueur répond "Oui, relancer"
// -----------------------------------------------------------------
section("Test 2 — Slam direct humain, réponse 'relancer'");

tile = createTestTile(8, 6);
mover = createCar("IA", CAR_SIZE.SMALL, 3, 3);
occupant = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
cars = [mover, occupant];

gen = moveCarGen(tile, mover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front-left", rerolledSlam: "top", rerolledDirection: "front" },
  isHumanOwner
});
first = gen.next();
console.log("Pause obtenue (attendu true) :", !first.done);
resumed = gen.next(true); // "Oui, relancer"
console.log("Terminé (attendu true) :", resumed.done);
console.log("Log mentionne la relance (attendu true) :", resumed.value.log.some((l) => l.includes("demande la relance")));
console.log("Log mentionne le lancer relancé 'top'/'front' (attendu true) :", resumed.value.log.some((l) => l.includes("Relance → Dé de slam : top | Dé de direction : front")));

// -----------------------------------------------------------------
// TEST 3 — Slam direct, voiture plus grande = IA → jamais de pause
// -----------------------------------------------------------------
section("Test 3 — Slam direct, voiture plus grande IA → PAS de pause (politique IA appliquée directement)");

tile = createTestTile(8, 6);
mover = createCar("Vous", CAR_SIZE.SMALL, 3, 3);
occupant = createCar("IA", CAR_SIZE.LARGE, 4, 3);
cars = [mover, occupant];

let neverCalled = true;
gen = moveCarGen(tile, mover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front-left" },
  isHumanOwner,
  decideReroll: () => { neverCalled = false; return true; } // politique IA : relance toujours (voir ai.decideSlamRerollDefault)
});
const { value: result3, yields } = drain(gen, () => true);
console.log("Zéro pause rencontrée (attendu 0) :", yields);
console.log("decideReroll (politique IA) bien appelée directement (attendu false) :", neverCalled);
console.log("Résolution allée jusqu'au bout sans intervention (attendu true) :", !!result3.slam);

// -----------------------------------------------------------------
// TEST 4 — Slam révélé par un Wreck, voiture humaine plus grande
// -----------------------------------------------------------------
section("Test 4 — Slam révélé par un Wreck, voiture humaine plus grande → doit YIELD");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.WRECK;
const wreckMover = createCar("Vous", CAR_SIZE.LARGE, 3, 3);
cars = [wreckMover];

gen = moveCarGen(tile, wreckMover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front" },
  isHumanOwner
});
first = gen.next();
console.log("Pause obtenue pour le Slam révélé par le Wreck (attendu true) :", !first.done);
console.log("La voiture plus grande est bien wreckMover, pas l'épave (attendu true) :", first.value?.largerCar === wreckMover);
resumed = gen.next(false);
console.log("Terminé, épave bien ajoutée à allCars (attendu 2) :", cars.length);

// -----------------------------------------------------------------
// TEST 5 — Version SYNCHRONE : jamais de yield, quel que soit le owner
// -----------------------------------------------------------------
section("Test 5 — moveCar() (synchrone, sans isHumanOwner) : comportement 100% inchangé");

tile = createTestTile(8, 6);
mover = createCar("IA", CAR_SIZE.SMALL, 3, 3);
occupant = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
cars = [mover, occupant];

let syncResult;
let threw = false;
try {
  syncResult = moveCar(tile, mover, 1, ["front"], cars, {
    forcedDice: { slam: "bottom", direction: "front-left" }
    // pas de isHumanOwner ni de decideReroll → défauts (jamais de pause, jamais de relance)
  });
} catch (e) {
  threw = true;
  console.log("Erreur inattendue :", e.message);
}
console.log("Aucune exception levée (attendu true) :", !threw);
console.log("Résolution synchrone allée jusqu'au bout (attendu true) :", !!syncResult?.slam);

// -----------------------------------------------------------------
// TEST 6 — Bout en bout via turn-executor.js (tour IA interactif)
// -----------------------------------------------------------------
section("Test 6 — executeDecisionGen + driveInteractive : Slam direct pendant un tour IA, adversaire humain plus grand");

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const {
  createTileProgressionState, setupTileProgressionFromRawData,
  createRoundState, TERRAIN
} = require("./engine.js");
const { executeDecisionGen, driveInteractive } = require("./turn-executor.js");

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

let progressionState;
try {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 }); attempts++; } while (!setup.ok && attempts < 20);
  progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
} catch (e) {
  console.log("Setup plateau réel indisponible dans ce contexte de test isolé :", e.message);
}

if (progressionState) {
  const allCars = [];
  const aiCar = createCar("IA", CAR_SIZE.SMALL, 3, 3);
  const humanCar = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
  allCars.push(aiCar, humanCar);
  // Neutralise tout hazard face cachée qui pourrait, par hasard, être
  // placé sur (4,3) ou une case adjacente sur ces vraies tuiles — voir
  // la même nécessité déjà rencontrée dans test-ui-ai-slam-reroll.js
  // et test-coast-slam-policy.js (sinon un hazard imprévu peut couper
  // le mouvement avant même d'atteindre l'occupant, rendant ce test
  // non déterministe).
  {
    const b = buildBoardFromProgressionState(progressionState);
    const destCell = getSpace(b, 4, 3);
    if (destCell) destCell.hazard = null;
    for (const { col, row } of [...getFrontArc({ col: 4, row: 3 }), ...getRearArc({ col: 4, row: 3 })]) {
      const cell = getSpace(b, col, row);
      if (cell) cell.hazard = null;
    }
  }
  const allChoppers = [];
  const playerNames = ["Vous", "IA"];
  const roundState = createRoundState(playerNames);

  const decision = {
    car: aiCar,
    dieValue: 1,
    command: null,
    isEntry: false,
    isCoast: false,
    destination: { path: ["front"] },
    slam: null,
    roadBonusPath: null
  };
  // Force le dé assigné dans le pool pour que drawSpecificDieFromPool réussisse.
  roundState.dicePool["IA"] = [1, 2, 3, 4];

  const gen6 = executeDecisionGen(progressionState, roundState, allCars, allChoppers, playerNames, "IA", decision, {
    isHumanOwner: (owner) => owner === "Vous"
  });
  // On force les dés de Slam via un forcedDice global : ici on s'appuie
  // sur le fait qu'aucun forcedDice n'est fourni (dés réels), donc on
  // se contente de vérifier qu'une pause de type slam-reroll PEUT se
  // produire (elle dépend du hasard du dé de Slam, "top"/"bottom" —
  // 1 chance sur 2 que ce soit justement humanCar/aiCar qui bouge, ce
  // qui ne change pas l'éligibilité à la relance, uniquement le sens).
  // Comme les tailles diffèrent TOUJOURS ici (SMALL vs LARGE), rerollEligible
  // est garanti vrai à chaque tirage, donc la pause est déterministe.
  const outcome = driveInteractive(gen6);
  console.log("Une pause a bien été obtenue (attendu true) :", !outcome.done);
  console.log("Type de pause (attendu 'slam-reroll') :", outcome.pending?.type);
  console.log("La voiture plus grande signalée est bien humanCar (attendu true) :", outcome.pending?.largerCar === humanCar);
  const final = outcome.resume(false);
  console.log("Résolution terminée après reprise (attendu true) :", final.done);
  console.log("Décision finale renvoyée (attendu true) :", !!final.result?.decision);
} else {
  console.log("(test 6 sauté faute de plateau minimal exploitable dans cet environnement isolé)");
}

console.log("\n=== Fin des tests dédiés (chantier générateurs) ===");

// ===================================================================
// ÉTAPE 2 — CHAÎNE TIR/DÉGÂTS (cascade Dazed) — tests dédiés
// ===================================================================
// Scénario exact signalé par Mayrik au départ de ce chantier : l'IA
// tire sur une voiture → dégât → jeton Dazed → la cascade pousse
// cette voiture sur UNE AUTRE voiture, plus grosse, appartenant au
// joueur humain. Doit désormais mettre la résolution en pause (yield)
// exactement comme un Slam direct ou révélé par un Wreck.
// -----------------------------------------------------------------
const { resolveShootGen, applyDamageGen, TOKEN_TYPES } = require("./engine.js");

section("Test 7 — Tir → dégât Dazed → cascade → Slam contre une voiture humaine plus grande → doit YIELD");

let tile2 = createTestTile(8, 6);
const shooter = createCar("IA", CAR_SIZE.MEDIUM, 2, 3);
const dazedTarget = createCar("IA", CAR_SIZE.SMALL, 3, 3); // dans l'arc avant du tireur
const humanBigCar = createCar("Vous", CAR_SIZE.LARGE, 4, 3); // une case plus loin, sur le trajet du Dazed
let cars7 = [shooter, dazedTarget, humanBigCar];

let gen7 = resolveShootGen(tile2, cars7, shooter, dazedTarget, {
  forcedDice: {
    shootingDie: "small-medium", // touche small ou medium — dazedTarget est small
    dazedStunt: 1,
    dazedDirections: ["front"]
  },
  tokenType: TOKEN_TYPES.DAZED, // force le jeton pour ne pas dépendre de la pioche aléatoire
  isHumanOwner
});

let first7 = gen7.next();
console.log("Le tir touche bien la cible (résolution atteint le Dazed, pas de raté) — pause obtenue (attendu true) :", !first7.done);
console.log("Type de la pause (attendu 'slam-reroll') :", first7.value?.type);
console.log("Voiture plus grande = humanBigCar (attendu true) :", first7.value?.largerCar === humanBigCar);
console.log("Voiture plus petite = dazedTarget, la voiture touchée par le tir (attendu true) :", first7.value?.smallerCar === dazedTarget);

let resumed7 = gen7.next(false);
console.log("Résolution terminée après reprise (attendu true) :", resumed7.done);
console.log("Le tir est bien marqué comme touché (attendu true) :", resumed7.value?.hit === true);

// -----------------------------------------------------------------
// TEST 8 — Même scénario, mais la voiture plus grande est celle de
// l'IA elle-même → PAS de pause, politique IA appliquée directement
// (non-régression, exactement comme pour un Slam direct/Wreck).
// -----------------------------------------------------------------
section("Test 8 — Tir → dégât Dazed → cascade → Slam contre une voiture IA plus grande → PAS de pause");

tile2 = createTestTile(8, 6);
const shooter8 = createCar("IA", CAR_SIZE.MEDIUM, 2, 3);
const dazedTarget8 = createCar("Vous", CAR_SIZE.SMALL, 3, 3);
const aiBigCar8 = createCar("IA", CAR_SIZE.LARGE, 4, 3);
let cars8 = [shooter8, dazedTarget8, aiBigCar8];

let policyCalled8 = false;
let gen8 = resolveShootGen(tile2, cars8, shooter8, dazedTarget8, {
  forcedDice: { shootingDie: "small-medium", dazedStunt: 1, dazedDirections: ["front"] },
  tokenType: TOKEN_TYPES.DAZED,
  isHumanOwner,
  decideReroll: (ctx) => { policyCalled8 = true; return false; }
});
const { value: result8, yields: yields8 } = drain(gen8, () => true);
console.log("Zéro pause rencontrée (attendu 0) :", yields8);
console.log("decideReroll (politique) bien appelée directement (attendu true) :", policyCalled8);

// -----------------------------------------------------------------
// TEST 9 — Cascade Dazed en PLUSIEURS étapes : une pause survenant à
// la 2e étape de la cascade (pas la première) doit aussi fonctionner
// — vérifie que le mécanisme tient sur toute la longueur de la
// boucle DAZED, pas seulement au premier pas.
// -----------------------------------------------------------------
section("Test 9 — Cascade Dazed sur 2 étapes, pause à la 2e étape seulement");

tile2 = createTestTile(8, 6);
const shooter9 = createCar("IA", CAR_SIZE.MEDIUM, 1, 3);
const dazedTarget9 = createCar("IA", CAR_SIZE.SMALL, 2, 3);
const humanBigCar9 = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
let cars9 = [shooter9, dazedTarget9, humanBigCar9];

let gen9 = resolveShootGen(tile2, cars9, shooter9, dazedTarget9, {
  forcedDice: {
    shootingDie: "small-medium",
    dazedStunt: 2,
    dazedDirections: ["front", "front"] // (2,3)->(3,3) puis (3,3)->(4,3), où se trouve humanBigCar9
  },
  tokenType: TOKEN_TYPES.DAZED,
  isHumanOwner
});
let first9 = gen9.next();
console.log("Pause obtenue à la 2e étape de la cascade (attendu true) :", !first9.done);
console.log("Voiture plus grande = humanBigCar9 (attendu true) :", first9.value?.largerCar === humanBigCar9);
gen9.next(false);

// -----------------------------------------------------------------
// TEST 10 — Version SYNCHRONE (resolveShoot, sans isHumanOwner) :
// jamais de yield, comportement 100% inchangé pour tout code existant.
// -----------------------------------------------------------------
section("Test 10 — resolveShoot() (synchrone) : comportement inchangé même avec une cascade Dazed contre une voiture humaine plus grande");

const { resolveShoot } = require("./engine.js");
tile2 = createTestTile(8, 6);
const shooter10 = createCar("IA", CAR_SIZE.MEDIUM, 2, 3);
const dazedTarget10 = createCar("IA", CAR_SIZE.SMALL, 3, 3);
const humanBigCar10 = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
let cars10 = [shooter10, dazedTarget10, humanBigCar10];

let threw10 = false;
let syncResult10;
try {
  syncResult10 = resolveShoot(tile2, cars10, shooter10, dazedTarget10, {
    forcedDice: { shootingDie: "small-medium", dazedStunt: 1, dazedDirections: ["front"] },
    tokenType: TOKEN_TYPES.DAZED
    // pas de isHumanOwner ni decideReroll → défauts, jamais de pause
  });
} catch (e) {
  threw10 = true;
  console.log("Erreur inattendue :", e.message);
}
console.log("Aucune exception levée (attendu true) :", !threw10);
console.log("Tir résolu jusqu'au bout (attendu true) :", syncResult10?.hit === true);

console.log("\n=== Fin des tests dédiés étape 2 (chaîne tir/dégâts) ===");

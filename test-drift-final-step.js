/**
 * Test dédié — correctif Drift / isFinalStep (retour de Mayrik, 28/08,
 * capture des règles p.8 : "This turn, your car may pass through the
 * FIRST space it enters that contains another road vehicle, without
 * slamming it. If you end your turn in a space with a road vehicle,
 * you still slam it, even if it is your first slam.")
 *
 * Bug corrigé : `isFinalStep` (engine.js, moveCarGen ET
 * moveCarEnteringBoardGen) se basait à tort sur la position DANS LE
 * `chosenPath` reçu par CET appel précis (`i < chosenPath.length - 1`),
 * une notion qui n'a de sens que si tout le chemin est fourni d'un
 * coup (le cas de l'IA). Pour le tour HUMAIN, chaque case est jouée
 * par un appel séparé avec un `chosenPath` d'UNE seule direction (voir
 * tools/ui-script.js, pickMoveStep) — dans ce cas, cette condition
 * valait TOUJOURS faux, empêchant Drift de jamais s'appliquer, quelle
 * que soit la suite réelle du mouvement.
 *
 * À lancer avec : node test-drift-final-step.js
 */

const {
  createTestTile, createCar, CAR_SIZE, CAR_STATUS,
  moveCar, moveCarEnteringBoard
} = require("./engine.js");

function section(title) {
  console.log("\n=== " + title + " ===");
}

// -----------------------------------------------------------------
// TEST 1 — Style IA (chemin complet fourni d'un coup) : Drift protège
// la PREMIÈRE case occupée croisée en cours de route, PAS la
// dernière (déjà couvert par test-engine.js #65, non-régression ici).
// -----------------------------------------------------------------
section("Test 1 — Style IA, chemin complet : Drift protège le 1er véhicule croisé, slam sur le 2e (case finale)");

let tile = createTestTile(8, 6);
let mover = createCar("IA", CAR_SIZE.SMALL, 1, 3);
let firstBlocker = createCar("Adversaire", CAR_SIZE.SMALL, 2, 3);
let secondBlocker = createCar("Adversaire", CAR_SIZE.LARGE, 3, 3); // case finale : DOIT slammer malgré Drift
let cars = [mover, firstBlocker, secondBlocker];

let result = moveCar(tile, mover, 2, ["front", "front"], cars, { driftAvailable: true, forcedDice: { slam: "bottom", direction: "front" } });
console.log("Traverse le 1er véhicule sans slam (attendu true) :", result.log.some((l) => l.includes("sans la slammer (Drift)")));
console.log("Un Slam se produit bien sur la case FINALE malgré Drift (attendu true) :", !!result.slam);

// -----------------------------------------------------------------
// TEST 2 — Style HUMAIN (un seul pas par appel, comme
// tools/ui-script.js/pickMoveStep) : MÊME scénario que le Test 1,
// rejoué case par case. Doit produire EXACTEMENT le même résultat —
// c'est précisément le cas qui était cassé avant le correctif (Drift
// ne s'appliquait JAMAIS avec cette façon d'appeler le moteur).
// -----------------------------------------------------------------
section("Test 2 — Style HUMAIN, un pas à la fois : même scénario, Drift doit s'appliquer identiquement");

tile = createTestTile(8, 6);
mover = createCar("Vous", CAR_SIZE.SMALL, 1, 3);
firstBlocker = createCar("IA", CAR_SIZE.SMALL, 2, 3);
secondBlocker = createCar("IA", CAR_SIZE.LARGE, 3, 3);
cars = [mover, firstBlocker, secondBlocker];

// Étape 1/2 : UN SEUL pas, chosenPath = ["front"] (exactement comme
// executeMoveStepGen/pickMoveStep, jamais le chemin complet).
let step1 = moveCar(tile, mover, 2, ["front"], cars, { driftAvailable: true });
console.log("Étape 1 — traverse le 1er véhicule sans slam (attendu true, AVANT le correctif : false) :",
  step1.log.some((l) => l.includes("sans la slammer (Drift)")));
console.log("Étape 1 — pas de Slam remonté (attendu true) :", !step1.slam);
console.log("Étape 1 — il reste bien 1 point de déplacement (attendu 1) :", step1.remaining);

// Étape 2/2 : le pas suivant, remaining=1, sur la case finale occupée.
let step2 = moveCar(tile, mover, step1.remaining, ["front"], cars, { driftAvailable: true, forcedDice: { slam: "bottom", direction: "front" } });
console.log("Étape 2 — un Slam se produit bien sur la case FINALE malgré Drift (attendu true) :", !!step2.slam);

// -----------------------------------------------------------------
// TEST 3 — Non-régression : SANS Drift, le style humain slamme
// normalement dès le premier véhicule croisé (comportement toujours
// inchangé, driftAvailable absent).
// -----------------------------------------------------------------
section("Test 3 — Style HUMAIN, sans Drift : slam normal dès le premier véhicule (non-régression)");

tile = createTestTile(8, 6);
mover = createCar("Vous", CAR_SIZE.SMALL, 1, 3);
firstBlocker = createCar("IA", CAR_SIZE.LARGE, 2, 3);
cars = [mover, firstBlocker];

let noD = moveCar(tile, mover, 2, ["front"], cars, {});
console.log("Slam dès le 1er véhicule sans Drift (attendu true) :", !!noD.slam);

// -----------------------------------------------------------------
// TEST 4 — Entrée en jeu (moveCarEnteringBoard) : Drift protège
// l'entrée SEULEMENT si le mouvement continue après (predictedRemaining
// > 0) — pas si le dé de mouvement s'épuise pile sur la case d'entrée.
// -----------------------------------------------------------------
section("Test 4 — Entrée en jeu : Drift ne protège PAS si le mouvement se termine pile à l'entrée (dé=1)");

tile = createTestTile(8, 6);
let blockerEntry = createCar("IA", CAR_SIZE.LARGE, 0, 3);
let enteringCar = createCarOffBoardFor("Vous");
function createCarOffBoardFor(owner) {
  const c = createCar(owner, CAR_SIZE.SMALL, null, null);
  return c;
}
let carsEntry = [enteringCar, blockerEntry];

let entryResult = moveCarEnteringBoard(tile, enteringCar, 1, 3, [], carsEntry, { driftAvailable: true, forcedDice: { slam: "bottom", direction: "front" } });
console.log("Slam se produit bien à l'entrée malgré Drift, car le dé (1) s'épuise pile ici (attendu true) :", !!entryResult.slam);

section("Test 5 — Entrée en jeu : Drift protège bien si le mouvement continue après l'entrée (dé=4, non-régression du test-engine.js #194)");

tile = createTestTile(8, 6);
let blockerEntry2 = createCar("IA", CAR_SIZE.SMALL, 0, 3);
let enteringCar2 = createCar("Vous", CAR_SIZE.MEDIUM, null, null);
let carsEntry2 = [enteringCar2, blockerEntry2];

let entryResult2 = moveCarEnteringBoard(tile, enteringCar2, 4, 3, [], carsEntry2, { driftAvailable: true });
console.log("Traverse sans slam à l'entrée, mouvement continue (attendu true) :", entryResult2.log.some((l) => l.includes("sans la slammer (Drift)")));
console.log("Statut toujours opérable (attendu 'operable') :", enteringCar2.status);

console.log("\n=== Fin des tests dédiés (correctif Drift / isFinalStep) ===");

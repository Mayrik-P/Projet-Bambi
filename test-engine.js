/**
 * Test manuel du moteur — à lancer avec : node test-engine.js
 * Pas de framework de test pour l'instant, juste des console.log
 * lisibles pour vérifier à l'œil que le comportement est correct.
 */

const {
  TERRAIN,
  createTestTile,
  getSpace,
  createCar,
  moveCar,
  CAR_SIZE,
  CAR_STATUS
} = require("./engine.js");

function section(title) {
  console.log("\n=== " + title + " ===");
}

// -----------------------------------------------------------------
// TEST 1 : déplacement simple en ligne droite sur route
// -----------------------------------------------------------------
section("Test 1 — Ligne droite sur route, dé = 3");

let tile = createTestTile(8, 6);
let car = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
console.log("Position de départ :", car.col, car.row);

let result = moveCar(tile, car, 3, ["front", "front", "front"]);
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Position finale :", car.col, car.row, "| Restant :", result.remaining);

// -----------------------------------------------------------------
// TEST 2 : traversée de boue (coûte 2)
// -----------------------------------------------------------------
section("Test 2 — Une case de boue au milieu, dé = 3");

tile = createTestTile(8, 6);
tile.grid[3][1].terrain = TERRAIN.MUD; // case juste devant le départ
car = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);

result = moveCar(tile, car, 3, ["front", "front"]);
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Position finale :", car.col, car.row, "| Restant attendu 0 :", result.remaining);

// -----------------------------------------------------------------
// TEST 3 : case impassable → élimination
// -----------------------------------------------------------------
section("Test 3 — Case impassable devant, dé = 2");

tile = createTestTile(8, 6);
tile.grid[3][1].terrain = TERRAIN.IMPASSABLE;
car = createCar("Mayrik", CAR_SIZE.SMALL, 0, 3);

result = moveCar(tile, car, 2, ["front", "front"]);
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Statut de la voiture (attendu 'eliminated') :", car.status);

// -----------------------------------------------------------------
// TEST 4 : sortie par le bord latéral (row hors grille) → élimination
// -----------------------------------------------------------------
section("Test 4 — Voiture en bord de tuile qui dévie vers l'extérieur");

tile = createTestTile(8, 6);
car = createCar("Mayrik", CAR_SIZE.LARGE, 0, 0); // row 0 = tout en haut
result = moveCar(tile, car, 1, ["front-left"]); // front-left = row -1 → hors grille
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Statut de la voiture (attendu 'eliminated') :", car.status);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 5 : boue atteinte avec le DERNIER point de mouvement (exception p.7)
// -----------------------------------------------------------------
section("Test 5 — 3 points de mouvement, boue en 3e case (dernier point)");

tile = createTestTile(8, 6);
tile.grid[3][3].terrain = TERRAIN.MUD; // 3e case devant le départ
car = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
console.log("Position de départ :", car.col, car.row);

result = moveCar(tile, car, 3, ["front", "front", "front"]);
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 3, row 3, donc SUR la boue) :", car.col, car.row);
console.log("Restant (attendu 0) :", result.remaining);

// -----------------------------------------------------------------
// TEST 6 : slam simple — une voiture avance sur une case occupée,
// dé de slam forcé sur "bottom" (la voiture percutée bouge)
// -----------------------------------------------------------------
section("Test 6 — Slam simple : dé forcé 'bottom' bouge, direction 'front'");

const { resolveSlam, forceMoveOneSpace, getCarAt } = require("./engine.js");

tile = createTestTile(8, 6);
const attacker = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const victim = createCar("IA", CAR_SIZE.SMALL, 1, 3); // juste devant l'attaquant
const allCars = [attacker, victim];

result = moveCar(tile, attacker, 1, ["front"], allCars);
console.log("Résultat :", result.ok ? "OK" : "ÉCHEC : " + result.reason);
result.log?.forEach((l) => console.log("  " + l));
console.log("Attaquant final (attendu col 1, row 3 - a pris la place) :", attacker.col, attacker.row);
console.log("Victime finale (dé forcé 'bottom' → bouge, direction random ici) :", victim.col, victim.row);

// -----------------------------------------------------------------
// TEST 7 : slam avec dés forcés précis (bottom + front-left)
// -----------------------------------------------------------------
section("Test 7 — Slam, dés forcés : slam='bottom', direction='front-left'");

tile = createTestTile(8, 6);
const top = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const bottom = createCar("IA", CAR_SIZE.SMALL, 3, 3); // même case, empilées directement
const cars2 = [top, bottom];

const slamResult = resolveSlam(tile, cars2, top, bottom, { forcedDice: { slam: "bottom", direction: "front-left" } });
slamResult.log.forEach((l) => console.log("  " + l));
console.log("Bottom (attendu col 4, row 2 - projetée front-left) :", bottom.col, bottom.row);
console.log("Top (attendu inchangé col 3, row 3) :", top.col, top.row);

// -----------------------------------------------------------------
// TEST 8 : slam qui projette une voiture hors du bord latéral → élimination
// -----------------------------------------------------------------
section("Test 8 — Slam qui projette la voiture percutée hors du plateau");

tile = createTestTile(8, 6);
const topB = createCar("Mayrik", CAR_SIZE.LARGE, 3, 0); // row 0 = tout en haut du plateau
const bottomB = createCar("IA", CAR_SIZE.SMALL, 3, 0);
const cars3 = [topB, bottomB];

const slamResult2 = resolveSlam(tile, cars3, topB, bottomB, { forcedDice: { slam: "bottom", direction: "front-left" } });
slamResult2.log.forEach((l) => console.log("  " + l));
console.log("Statut de bottomB (attendu 'eliminated', projetée hors du bord) :", bottomB.status);

// -----------------------------------------------------------------
// TEST 9 : slam EN CHAÎNE — une voiture percutée atterrit sur une 3e voiture
// -----------------------------------------------------------------
section("Test 9 — Slam en chaîne : la voiture projetée atterrit sur une autre voiture");

tile = createTestTile(8, 6);
const c1 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3); // top
const c2 = createCar("IA-1", CAR_SIZE.SMALL, 3, 3);    // bottom, sera projetée
const c3 = createCar("IA-2", CAR_SIZE.SMALL, 4, 2);    // se trouve juste là où c2 va atterrir (front-left de 3,3)
const cars4 = [c1, c2, c3];

const chainResult = resolveSlam(tile, cars4, c1, c2, { forcedDice: { slam: "bottom", direction: "front-left" } });
chainResult.log.forEach((l) => console.log("  " + l));
console.log("c2 finale (attendu là où était c3, col 4 row 2 - a pris sa place) :", c2.col, c2.row);
console.log("c3 a-t-elle bougé suite au slam en chaîne (position) :", c3.col, c3.row);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 10 : relance REFUSÉE — tailles différentes, mais decideReroll dit "non"
// -----------------------------------------------------------------
section("Test 10 — Slam entre tailles différentes, relance refusée");

tile = createTestTile(8, 6);
const large10 = createCar("Mayrik", CAR_SIZE.LARGE, 3, 3); // top
const small10 = createCar("IA", CAR_SIZE.SMALL, 3, 3);     // bottom
const cars10 = [large10, small10];

const result10 = resolveSlam(tile, cars10, large10, small10, {
  forcedDice: { slam: "bottom", direction: "front" },
  decideReroll: () => false // le propriétaire de la voiture plus grande refuse
});
result10.log.forEach((l) => console.log("  " + l));
console.log("Nombre de lignes de log (attendu 3, PAS de relance) :", result10.log.length);

// -----------------------------------------------------------------
// TEST 11 : relance ACCEPTÉE — tailles différentes, decideReroll dit "oui",
// et on vérifie que le contexte transmis à decideReroll est correct
// -----------------------------------------------------------------
section("Test 11 — Slam entre tailles différentes, relance acceptée");

tile = createTestTile(8, 6);
const large11 = createCar("Mayrik", CAR_SIZE.LARGE, 3, 3); // top
const small11 = createCar("IA", CAR_SIZE.SMALL, 3, 3);     // bottom
const cars11 = [large11, small11];

let receivedContext = null;
const result11 = resolveSlam(tile, cars11, large11, small11, {
  forcedDice: {
    slam: "bottom",
    direction: "front",
    rerolledSlam: "top",
    rerolledDirection: "rear"
  },
  decideReroll: (context) => {
    receivedContext = context;
    return true; // le propriétaire de la voiture plus grande accepte
  }
});
result11.log.forEach((l) => console.log("  " + l));
console.log("Voiture plus grande transmise au contexte (attendu large11) :", receivedContext.largerCar === large11);
console.log("Voiture plus petite transmise au contexte (attendu small11) :", receivedContext.smallerCar === small11);
console.log("Résultat AVANT relance transmis au contexte (attendu bottom/front) :", receivedContext.slamRoll, receivedContext.directionRoll);
console.log("large11 finale (attendu inchangée, col 3 row 3 - c'est 'top' qui bouge après relance) :", large11.col, large11.row);
console.log("small11 finale (attendu inchangée, dé de slam relancé = 'top' donc c'est large11 qui aurait dû bouger) :", small11.col, small11.row);

// -----------------------------------------------------------------
// TEST 12 : PAS de relance proposée si les deux voitures ont la même taille
// (même si decideReroll dirait "oui", elle ne doit jamais être appelée)
// -----------------------------------------------------------------
section("Test 12 — Même taille : la relance ne doit jamais être proposée");

tile = createTestTile(8, 6);
const med1 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const med2 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const cars12 = [med1, med2];

let decideRerollWasCalled = false;
const result12 = resolveSlam(tile, cars12, med1, med2, {
  forcedDice: { slam: "bottom", direction: "front" },
  decideReroll: () => {
    decideRerollWasCalled = true;
    return true;
  }
});
result12.log.forEach((l) => console.log("  " + l));
console.log("decideReroll appelée (attendu false, tailles identiques) :", decideRerollWasCalled);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 13 : vérification explicite — la voiture qui percute perd
// TOUT son déplacement restant, même s'il lui en restait beaucoup
// -----------------------------------------------------------------
section("Test 13 — Dé de 5, mais slam dès la 1ère case → doit perdre les 4 restants");

tile = createTestTile(8, 6);
const attacker13 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const victim13 = createCar("IA", CAR_SIZE.SMALL, 1, 3); // juste devant, 1 seule case parcourue
const cars13 = [attacker13, victim13];

// dé de 5 : s'il n'y avait pas de slam, la voiture pourrait avancer
// jusqu'en col 5. On vérifie qu'elle s'arrête bien net à col 1.
result = moveCar(tile, attacker13, 5, ["front", "front", "front", "front", "front"], cars13, {
  forcedDice: { slam: "bottom", direction: "front" }
});
result.log?.forEach((l) => console.log("  " + l));
console.log("Déplacement restant renvoyé par moveCar (attendu 0, PAS 4) :", result.remaining);
console.log("Position finale de l'attaquant (attendu col 1, PAS col 5 ou plus) :", attacker13.col, attacker13.row);

section("Fin des tests");

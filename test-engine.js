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

const slamResult = resolveSlam(tile, cars2, top, bottom, { slam: "bottom", direction: "front-left" });
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

const slamResult2 = resolveSlam(tile, cars3, topB, bottomB, { slam: "bottom", direction: "front-left" });
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

const chainResult = resolveSlam(tile, cars4, c1, c2, { slam: "bottom", direction: "front-left" });
chainResult.log.forEach((l) => console.log("  " + l));
console.log("c2 finale (attendu là où était c3, col 4 row 2 - a pris sa place) :", c2.col, c2.row);
console.log("c3 a-t-elle bougé suite au slam en chaîne (position) :", c3.col, c3.row);

section("Fin des tests");

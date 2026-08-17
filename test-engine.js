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

// -----------------------------------------------------------------
// TEST 14 : 1er dégât → reste opérable
// -----------------------------------------------------------------
section("Test 14 — Premier dégât : la voiture reste opérable");

const { applyDamage, repairCar } = require("./engine.js");
let dmgCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 0);

let dmgResult = applyDamage(dmgCar);
dmgResult.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'operable') :", dmgCar.status);
console.log("Nombre de jetons (attendu 1) :", dmgCar.damageTokens.length);
console.log("applied (attendu true) :", dmgResult.applied);

// -----------------------------------------------------------------
// TEST 15 : 2e dégât → devient inopérable, face arrière
// -----------------------------------------------------------------
section("Test 15 — Deuxième dégât : devient inopérable");

dmgResult = applyDamage(dmgCar);
dmgResult.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'inoperable') :", dmgCar.status);
console.log("facingReversed (attendu true) :", dmgCar.facingReversed);

// -----------------------------------------------------------------
// TEST 16 : 3e dégât sur une voiture déjà inopérable → ignoré
// -----------------------------------------------------------------
section("Test 16 — Dégât supplémentaire sur voiture déjà inopérable : ignoré");

dmgResult = applyDamage(dmgCar);
dmgResult.log.forEach((l) => console.log("  " + l));
console.log("Nombre de jetons (attendu toujours 2, PAS 3) :", dmgCar.damageTokens.length);
console.log("applied (attendu false) :", dmgResult.applied);

// -----------------------------------------------------------------
// TEST 17 : voiture inopérable ne peut pas être assignée à un mouvement
// -----------------------------------------------------------------
section("Test 17 — Voiture inopérable : moveCar doit refuser");

tile = createTestTile(8, 6);
result = moveCar(tile, dmgCar, 3, ["front", "front", "front"]);
console.log("Résultat (attendu ÉCHEC) :", result.ok ? "OK (ERREUR, ne devrait pas bouger)" : "ÉCHEC : " + result.reason);

// -----------------------------------------------------------------
// TEST 18 : Repair retire un dégât et rend l'opérabilité
// -----------------------------------------------------------------
section("Test 18 — Repair : retire un dégât, redevient opérable");

let repairResult = repairCar(dmgCar);
repairResult.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'operable') :", dmgCar.status);
console.log("facingReversed (attendu false) :", dmgCar.facingReversed);
console.log("Nombre de jetons (attendu 1) :", dmgCar.damageTokens.length);

// -----------------------------------------------------------------
// TEST 19 : Repair sur une voiture sans aucun dégât → rien ne se passe
// -----------------------------------------------------------------
section("Test 19 — Repair sur voiture saine : aucun effet");

let freshCar = createCar("Mayrik", CAR_SIZE.SMALL, 0, 0);
let repairResult2 = repairCar(freshCar);
repairResult2.log.forEach((l) => console.log("  " + l));
console.log("repaired (attendu false) :", repairResult2.repaired);

// -----------------------------------------------------------------
// TEST 20 : une voiture inopérable PEUT toujours être slammée
// (règle : "It can still be affected by the FX dice, such as being slammed")
// -----------------------------------------------------------------
section("Test 20 — Voiture inopérable : peut quand même être slammée");

tile = createTestTile(8, 6);
const inopCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
applyDamage(inopCar);
applyDamage(inopCar); // devient inopérable
const otherCar = createCar("IA", CAR_SIZE.SMALL, 3, 3); // même case
const cars20 = [inopCar, otherCar];

console.log("Statut avant slam (attendu 'inoperable') :", inopCar.status);
const slamResult20 = resolveSlam(tile, cars20, inopCar, otherCar, {
  forcedDice: { slam: "top", direction: "front" } // on force le déplacement de l'inopérable
});
slamResult20.log.forEach((l) => console.log("  " + l));
console.log("La voiture inopérable a quand même bougé (attendu col 4, row 3) :", inopCar.col, inopCar.row);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 21 : jeton DENT — aucun effet, juste le compteur
// -----------------------------------------------------------------
section("Test 21 — Jeton DENT : aucun effet");

const { TOKEN_TYPES, resolveDamageToken, drawDamageToken } = require("./engine.js");

tile = createTestTile(8, 6);
const dentCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const dentResult = applyDamage(dentCar, { tokenType: TOKEN_TYPES.DENT, tile, allCars: [dentCar] });
dentResult.log.forEach((l) => console.log("  " + l));
console.log("Position inchangée (attendu col 3, row 3) :", dentCar.col, dentCar.row);

// -----------------------------------------------------------------
// TEST 22 : jeton SHRAPNEL — touche la première voiture dans l'axe
// -----------------------------------------------------------------
section("Test 22 — Jeton SHRAPNEL : touche la voiture dans l'axe");

tile = createTestTile(8, 6);
const shooter22 = createCar("Mayrik", CAR_SIZE.MEDIUM, 2, 3);
const target22 = createCar("IA", CAR_SIZE.SMALL, 5, 3); // droit devant, à distance
const cars22 = [shooter22, target22];

const dmgResult22 = applyDamage(shooter22, {
  tokenType: TOKEN_TYPES.SHRAPNEL,
  tile,
  allCars: cars22,
  forcedDice: { shrapnelDirection: "front" }
});
dmgResult22.log.forEach((l) => console.log("  " + l));
console.log("target22 a pris un dégât (attendu 1) :", target22.damageTokens.length);
console.log("shooter22 n'a pas bougé (attendu col 2, row 3) :", shooter22.col, shooter22.row);

// -----------------------------------------------------------------
// TEST 23 : jeton SHRAPNEL — rien dans l'axe, rien ne se passe
// -----------------------------------------------------------------
section("Test 23 — Jeton SHRAPNEL : rien dans l'axe (bord du plateau)");

tile = createTestTile(8, 6);
const shooter23 = createCar("Mayrik", CAR_SIZE.MEDIUM, 2, 3);
const cars23 = [shooter23];

const dmgResult23 = applyDamage(shooter23, {
  tokenType: TOKEN_TYPES.SHRAPNEL,
  tile,
  allCars: cars23,
  forcedDice: { shrapnelDirection: "rear" }
});
dmgResult23.log.forEach((l) => console.log("  " + l));
console.log("Aucun crash, shooter23 toujours à sa place :", shooter23.col, shooter23.row);

// -----------------------------------------------------------------
// TEST 24 : jeton SKID — 1 case dans la direction fixe du jeton,
// coût de terrain IGNORÉ (comme le slam)
// -----------------------------------------------------------------
section("Test 24 — Jeton SKID : ignore le coût de terrain (case de boue)");

tile = createTestTile(8, 6);
tile.grid[3][4].terrain = TERRAIN.MUD; // juste devant la voiture, en front
const skidCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars24 = [skidCar];

const dmgResult24 = applyDamage(skidCar, {
  tokenType: TOKEN_TYPES.SKID,
  tile,
  allCars: cars24,
  skidDirection: "front"
});
dmgResult24.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 4, row 3 - a bien traversé la boue en 1 case) :", skidCar.col, skidCar.row);

// -----------------------------------------------------------------
// TEST 25 : jeton SKID — atterrit sur une autre voiture → slam
// -----------------------------------------------------------------
section("Test 25 — Jeton SKID : déclenche un slam si case occupée");

tile = createTestTile(8, 6);
const skidCar25 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const otherCar25 = createCar("IA", CAR_SIZE.SMALL, 4, 3); // juste devant
const cars25 = [skidCar25, otherCar25];

const dmgResult25 = applyDamage(skidCar25, {
  tokenType: TOKEN_TYPES.SKID,
  tile,
  allCars: cars25,
  skidDirection: "front",
  forcedDice: { slam: "bottom", direction: "front" }
});
dmgResult25.log.forEach((l) => console.log("  " + l));
console.log("skidCar25 a pris la place (attendu col 4, row 3) :", skidCar25.col, skidCar25.row);
console.log("otherCar25 a été projetée (attendu col 5, row 3) :", otherCar25.col, otherCar25.row);

// -----------------------------------------------------------------
// TEST 26 : jeton DAZED — respecte le coût de terrain (contrairement à Skid)
// -----------------------------------------------------------------
section("Test 26 — Jeton DAZED : dé de cascade=3, une case de boue au milieu");

tile = createTestTile(8, 6);
tile.grid[3][4].terrain = TERRAIN.MUD; // 2e case du trajet
const dazedCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars26 = [dazedCar];

const dmgResult26 = applyDamage(dazedCar, {
  tokenType: TOKEN_TYPES.DAZED,
  tile,
  allCars: cars26,
  forcedDice: {
    dazedStunt: 3,
    dazedDirections: ["front", "front", "front"]
  }
});
dmgResult26.log.forEach((l) => console.log("  " + l));
// road(1) + mud(2) = 3 déplacements consommés en 2 cases seulement
console.log("Position finale (attendu col 5, row 3 - 2 cases parcourues, la boue a consommé les 2 derniers points) :", dazedCar.col, dazedCar.row);

// -----------------------------------------------------------------
// TEST 27 : jeton DAZED — s'arrête plus tôt si slam en cours de route
// -----------------------------------------------------------------
section("Test 27 — Jeton DAZED : s'arrête plus tôt à cause d'un slam");

tile = createTestTile(8, 6);
const dazedCar27 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const blocker27 = createCar("IA", CAR_SIZE.SMALL, 4, 3); // sur la 1ère case du trajet
const cars27 = [dazedCar27, blocker27];

const dmgResult27 = applyDamage(dazedCar27, {
  tokenType: TOKEN_TYPES.DAZED,
  tile,
  allCars: cars27,
  forcedDice: {
    dazedStunt: 4, // devrait faire 4 cases, mais va s'arrêter avant
    dazedDirections: ["front", "front", "front", "front"],
    slam: "bottom",
    direction: "front"
  }
});
dmgResult27.log.forEach((l) => console.log("  " + l));
console.log("dazedCar27 s'est arrêtée dès le slam (attendu col 4, row 3) :", dazedCar27.col, dazedCar27.row);

// -----------------------------------------------------------------
// TEST 28 : jeton BLAST OFF — saute en ignorant les cases intermédiaires
// (y compris une case impassable au milieu du trajet, sans effet)
// -----------------------------------------------------------------
section("Test 28 — Jeton BLAST OFF : ignore les cases intermédiaires (même impassables)");

tile = createTestTile(8, 6);
tile.grid[3][4].terrain = TERRAIN.IMPASSABLE; // case intermédiaire, ne doit PAS éliminer
const blastCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars28 = [blastCar];

const dmgResult28 = applyDamage(blastCar, {
  tokenType: TOKEN_TYPES.BLAST_OFF,
  tile,
  allCars: cars28,
  forcedDice: { blastOffDirection: "front", blastOffStunt: 3 }
});
dmgResult28.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'operable', PAS éliminé malgré la case impassable traversée) :", blastCar.status);
console.log("Position finale (attendu col 6, row 3) :", blastCar.col, blastCar.row);

// -----------------------------------------------------------------
// TEST 29 : jeton BLAST OFF — atterrissage SUR une case impassable → élimination
// -----------------------------------------------------------------
section("Test 29 — Jeton BLAST OFF : atterrit sur une case impassable → éliminé");

tile = createTestTile(8, 6);
tile.grid[3][6].terrain = TERRAIN.IMPASSABLE; // case d'ARRIVÉE cette fois
const blastCar29 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars29 = [blastCar29];

const dmgResult29 = applyDamage(blastCar29, {
  tokenType: TOKEN_TYPES.BLAST_OFF,
  tile,
  allCars: cars29,
  forcedDice: { blastOffDirection: "front", blastOffStunt: 3 }
});
dmgResult29.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'eliminated') :", blastCar29.status);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 30 : la composition totale fait bien 20 jetons
// -----------------------------------------------------------------
section("Test 30 — Composition des jetons : total = 20");

const { DAMAGE_TOKEN_COMPOSITION, drawDamageToken: drawToken } = require("./engine.js");
const total = DAMAGE_TOKEN_COMPOSITION.reduce((sum, entry) => sum + entry.count, 0);
console.log("Total de jetons (attendu 20) :", total);

// -----------------------------------------------------------------
// TEST 31 : tirage forcé d'un jeton Skid → la direction suit
// automatiquement, sans avoir à la préciser séparément
// -----------------------------------------------------------------
section("Test 31 — Tirage d'un jeton Skid : la direction est transmise automatiquement");

tile = createTestTile(8, 6);
const skidCar31 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars31 = [skidCar31];

const dmgResult31 = applyDamage(skidCar31, {
  tile,
  allCars: cars31,
  forcedDice: { drawnToken: { type: TOKEN_TYPES.SKID, skidDirection: "rear-left" } }
});
dmgResult31.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 2, row 2 - direction rear-left prise automatiquement) :", skidCar31.col, skidCar31.row);

// -----------------------------------------------------------------
// TEST 32 : sur un grand nombre de tirages, la proportion de chaque
// type colle globalement à la composition officielle (test statistique
// large pour repérer une erreur grossière, pas une vérification exacte)
// -----------------------------------------------------------------
section("Test 32 — Vérification statistique du tirage (10000 tirages)");

const counts = {};
for (let i = 0; i < 10000; i++) {
  const t = drawToken();
  counts[t.type] = (counts[t.type] || 0) + 1;
}
console.log("Répartition observée sur 10000 tirages :", counts);
console.log("Attendu approximatif : dent≈1500, skid≈3000, shrapnel≈1500, dazed≈1500, blast_off≈2500");

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 33 : composition des hazards = 26 au total
// -----------------------------------------------------------------
section("Test 33 — Composition des hazards : total = 26");

const { HAZARD_TYPES, HAZARD_TOKEN_COMPOSITION } = require("./engine.js");
const hazardTotal = HAZARD_TOKEN_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
console.log("Total de jetons hazard (attendu 26) :", hazardTotal);

// -----------------------------------------------------------------
// TEST 34 : hazard BLANK — la case devient une route, jeton défaussé,
// mouvement continue normalement
// -----------------------------------------------------------------
section("Test 34 — Hazard BLANK : case devient route, mouvement continue");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.BLANK;
const blankCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars34 = [blankCar];

result = moveCar(tile, blankCar, 3, ["front", "front", "front"], cars34);
result.log.forEach((l) => console.log("  " + l));
console.log("Case transformée en route (attendu 'road') :", tile.grid[3][4].terrain);
console.log("Hazard défaussé (attendu null) :", tile.grid[3][4].hazard);
console.log("Position finale (attendu col 6, row 3 - mouvement pas interrompu) :", blankCar.col, blankCar.row);

// -----------------------------------------------------------------
// TEST 35 : hazard DIRT — la case devient de la boue (coûte 2 pour
// la traverser à l'avenir), jeton défaussé
// -----------------------------------------------------------------
section("Test 35 — Hazard DIRT : case devient boue");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.DIRT;
const dirtCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars35 = [dirtCar];

result = moveCar(tile, dirtCar, 1, ["front"], cars35);
result.log.forEach((l) => console.log("  " + l));
console.log("Case transformée en boue (attendu 'mud') :", tile.grid[3][4].terrain);

// -----------------------------------------------------------------
// TEST 36 : hazard MINE — dégât infligé, jeton défaussé, TOUT le
// déplacement restant est perdu
// -----------------------------------------------------------------
section("Test 36 — Hazard MINE : dégât + perte totale du déplacement restant");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.MINE;
const mineCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars36 = [mineCar];

// dé de 5 : sans la mine, irait jusqu'en col 8. On vérifie l'arrêt net.
result = moveCar(tile, mineCar, 5, ["front", "front", "front", "front", "front"], cars36, {
  tokenType: undefined // pas utilisé ici, applyDamage tirera un jeton dégât aléatoire
});
result.log.forEach((l) => console.log("  " + l));
console.log("Nombre de dégâts reçus (attendu 1) :", mineCar.damageTokens.length);
console.log("Hazard défaussé (attendu null) :", tile.grid[3][4].hazard);
console.log("Position finale (attendu col 4, row 3 - arrêt net, PAS col 8) :", mineCar.col, mineCar.row);
console.log("Déplacement restant renvoyé (attendu 0) :", result.remaining);

// -----------------------------------------------------------------
// TEST 37 : hazard WRECK — crée une épave, slam immédiat
// -----------------------------------------------------------------
section("Test 37 — Hazard WRECK : crée une épave et déclenche un slam");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.WRECK;
const wreckHitCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars37 = [wreckHitCar];

result = moveCar(tile, wreckHitCar, 1, ["front"], cars37, {
  forcedDice: { slam: "bottom", direction: "front" }
});
result.log.forEach((l) => console.log("  " + l));
console.log("Nombre de voitures dans allCars après résolution (attendu 2 - l'épave a été ajoutée) :", cars37.length);
const spawnedWreck = cars37.find((c) => c.isWreck);
console.log("Une épave a bien été créée :", !!spawnedWreck);
console.log("L'épave est inopérable (attendu 'inoperable') :", spawnedWreck?.status);

// -----------------------------------------------------------------
// TEST 38 : hazard OIL_SLICK — glissade gratuite, mouvement continue
// -----------------------------------------------------------------
section("Test 38 — Hazard OIL SLICK : glissade gratuite (ne coûte pas de déplacement)");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.OIL_SLICK;
const oilCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars38 = [oilCar];

// dé de 1 : la voiture entre sur l'oil slick (coûte 1), PUIS glisse
// gratuitement d'une case supplémentaire — donc 2 cases parcourues
// au total avec un dé de seulement 1.
result = moveCar(tile, oilCar, 1, ["front"], cars38, {
  forcedDice: { oilSlickDirection: "front" }
});
result.log.forEach((l) => console.log("  " + l));
console.log("Case oil slick transformée en route (attendu 'road') :", tile.grid[3][4].terrain);
console.log("Position finale (attendu col 5, row 3 - 1 case payée + 1 case gratuite) :", oilCar.col, oilCar.row);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 39 : hazard OIL_SLICK dont la glissade atterrit sur une autre
// voiture → doit se comporter EXACTEMENT comme un slam normal
// (perte totale du déplacement restant, relance possible, etc.)
// -----------------------------------------------------------------
section("Test 39 — Oil Slick + slam pendant la glissade : règles normales du slam");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.OIL_SLICK;
const oilCar39 = createCar("Mayrik", CAR_SIZE.LARGE, 3, 3);       // plus grande, pour aussi vérifier la relance
const blocker39 = createCar("IA", CAR_SIZE.SMALL, 5, 3);          // sur la case où la glissade va atterrir
const cars39 = [oilCar39, blocker39];

// dé de 5 : sans le slam, la voiture continuerait après la glissade.
// On vérifie qu'elle s'arrête bien net avec 0 restant, comme un slam classique.
let rerollCalled = false;
result = moveCar(tile, oilCar39, 5, ["front", "front", "front", "front", "front"], cars39, {
  forcedDice: { oilSlickDirection: "front", slam: "bottom", direction: "front" },
  decideReroll: (context) => {
    rerollCalled = true; // vérifie que la relance EST bien proposée (tailles différentes)
    return false;
  }
});
result.log.forEach((l) => console.log("  " + l));
console.log("Déplacement restant renvoyé (attendu 0, comme un slam classique) :", result.remaining);
console.log("La relance a bien été proposée (voiture plus grande impliquée) :", rerollCalled);
console.log("oilCar39 a pris la place de blocker39 (attendu col 5, row 3) :", oilCar39.col, oilCar39.row);
console.log("blocker39 a été projetée par le slam (attendu col 6, row 3) :", blocker39.col, blocker39.row);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 40 : vérification explicite — seuls les hazards qui infligent
// un dégât (Mine) ou qui déclenchent un slam font perdre le
// déplacement restant. Blank/Dirt/Oil Slick (sans slam) NE le font PAS.
// -----------------------------------------------------------------
section("Test 40 — Blank ne fait PAS perdre le déplacement restant (dé=4)");

tile = createTestTile(8, 6);
tile.grid[3][4].hazard = HAZARD_TYPES.BLANK; // 2e case du trajet
const blankCar40 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars40 = [blankCar40];

result = moveCar(tile, blankCar40, 4, ["front", "front", "front", "front"], cars40);
result.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 7, row 3 - les 4 points de mouvement ont bien été utilisés) :", blankCar40.col, blankCar40.row);
console.log("Déplacement restant renvoyé (attendu 0 car tout utilisé normalement, PAS coupé prématurément) :", result.remaining);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 41 : tir réussi — dé correspond exactement à la taille de la cible
// -----------------------------------------------------------------
section("Test 41 — Tir réussi : dé 'medium' contre cible medium");

const { resolveShoot } = require("./engine.js");

tile = createTestTile(8, 6);
const shooter41 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const target41 = createCar("IA", CAR_SIZE.MEDIUM, 4, 3); // dans l'arc avant
const cars41 = [shooter41, target41];

let shootResult = resolveShoot(tile, cars41, shooter41, target41, {
  forcedDice: { shootingDie: "medium" }
});
shootResult.log.forEach((l) => console.log("  " + l));
console.log("Touché (attendu true) :", shootResult.hit);
console.log("Nombre de dégâts sur la cible (attendu 1) :", target41.damageTokens.length);

// -----------------------------------------------------------------
// TEST 42 : tir raté — dé ne correspond pas à la taille de la cible
// -----------------------------------------------------------------
section("Test 42 — Tir raté : dé 'large' contre cible small");

tile = createTestTile(8, 6);
const shooter42 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const target42 = createCar("IA", CAR_SIZE.SMALL, 4, 3);
const cars42 = [shooter42, target42];

shootResult = resolveShoot(tile, cars42, shooter42, target42, {
  forcedDice: { shootingDie: "large" }
});
shootResult.log.forEach((l) => console.log("  " + l));
console.log("Touché (attendu false) :", shootResult.hit);
console.log("Nombre de dégâts sur la cible (attendu 0) :", target42.damageTokens.length);

// -----------------------------------------------------------------
// TEST 43 : dé 'any' touche n'importe quelle taille
// -----------------------------------------------------------------
section("Test 43 — Dé 'any' : touche n'importe quelle taille");

tile = createTestTile(8, 6);
const shooter43 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const target43 = createCar("IA", CAR_SIZE.LARGE, 4, 3);
const cars43 = [shooter43, target43];

shootResult = resolveShoot(tile, cars43, shooter43, target43, {
  forcedDice: { shootingDie: "any" }
});
console.log("Touché (attendu true, 'any' touche tout) :", shootResult.hit);

// -----------------------------------------------------------------
// TEST 44 : dé 'small-medium' touche small OU medium, pas large
// -----------------------------------------------------------------
section("Test 44 — Dé 'small-medium' : touche small et medium, pas large");

tile = createTestTile(8, 6);
const shooter44 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const smallTarget = createCar("IA", CAR_SIZE.SMALL, 4, 3);
const mediumTarget44 = createCar("IA2", CAR_SIZE.MEDIUM, 4, 3);
const largeTarget44 = createCar("IA3", CAR_SIZE.LARGE, 4, 3);

let r1 = resolveShoot(tile, [shooter44, smallTarget], shooter44, smallTarget, { forcedDice: { shootingDie: "small-medium" } });
let r2 = resolveShoot(tile, [shooter44, mediumTarget44], shooter44, mediumTarget44, { forcedDice: { shootingDie: "small-medium" } });
let r3 = resolveShoot(tile, [shooter44, largeTarget44], shooter44, largeTarget44, { forcedDice: { shootingDie: "small-medium" } });
console.log("Touche small (attendu true) :", r1.hit);
console.log("Touche medium (attendu true) :", r2.hit);
console.log("Touche large (attendu false) :", r3.hit);

// -----------------------------------------------------------------
// TEST 45 : cible hors de l'arc avant → tir refusé
// -----------------------------------------------------------------
section("Test 45 — Cible hors de l'arc avant : tir impossible");

tile = createTestTile(8, 6);
const shooter45 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const behindTarget = createCar("IA", CAR_SIZE.MEDIUM, 1, 3); // derrière, pas dans l'arc avant
const cars45 = [shooter45, behindTarget];

shootResult = resolveShoot(tile, cars45, shooter45, behindTarget, { forcedDice: { shootingDie: "any" } });
shootResult.log.forEach((l) => console.log("  " + l));
console.log("Touché (attendu false, hors arc) :", shootResult.hit);

// -----------------------------------------------------------------
// TEST 46 : tirer sur une épave — le moindre dégât l'élimine
// (contrairement à une voiture normale qui a droit à 2 dégâts)
// -----------------------------------------------------------------
section("Test 46 — Tir sur une épave : éliminée par le moindre dégât");

tile = createTestTile(8, 6);
const shooter46 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const wreckTarget = createCar(null, CAR_SIZE.SMALL, 4, 3);
wreckTarget.status = CAR_STATUS.INOPERABLE;
wreckTarget.isWreck = true;
const cars46 = [shooter46, wreckTarget];

shootResult = resolveShoot(tile, cars46, shooter46, wreckTarget, { forcedDice: { shootingDie: "small-medium" } });
shootResult.log.forEach((l) => console.log("  " + l));
console.log("Statut de l'épave (attendu 'eliminated', PAS juste 1 dégât) :", wreckTarget.status);

// -----------------------------------------------------------------
// TEST 47 : tirer sur sa propre voiture — autorisé (pas de restriction)
// -----------------------------------------------------------------
section("Test 47 — Tir sur sa propre voiture : autorisé");

tile = createTestTile(8, 6);
const shooter47 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const ownCar47 = createCar("Mayrik", CAR_SIZE.MEDIUM, 4, 3); // même owner
const cars47 = [shooter47, ownCar47];

shootResult = resolveShoot(tile, cars47, shooter47, ownCar47, { forcedDice: { shootingDie: "medium" } });
console.log("Touché (attendu true, aucune restriction sur les tirs amis) :", shootResult.hit);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 48 : Airstrike réussi sur une case vide
// -----------------------------------------------------------------
section("Test 48 — Airstrike : placement sur case vide");

const { createChopper, placeChopperAirstrike, eliminateCarsOnChoppers } = require("./engine.js");

tile = createTestTile(8, 6);
const chopper48 = createChopper("Mayrik");
const cars48 = [];
const choppers48 = [chopper48];

let placeResult = placeChopperAirstrike(tile, cars48, choppers48, chopper48, 4, 3);
console.log("Résultat (attendu ok:true) :", placeResult.ok);
console.log("Position du chopper (attendu col 4, row 3) :", chopper48.col, chopper48.row);
console.log("placed (attendu true) :", chopper48.placed);

// -----------------------------------------------------------------
// TEST 49 : Airstrike refusé sur case occupée par une voiture
// -----------------------------------------------------------------
section("Test 49 — Airstrike : refusé sur case occupée");

tile = createTestTile(8, 6);
const occupyingCar = createCar("IA", CAR_SIZE.MEDIUM, 4, 3);
const chopper49 = createChopper("Mayrik");
const cars49 = [occupyingCar];
const choppers49 = [chopper49];

placeResult = placeChopperAirstrike(tile, cars49, choppers49, chopper49, 4, 3);
console.log("Résultat (attendu ok:false) :", placeResult.ok, "-", placeResult.reason);
console.log("placed (attendu toujours false) :", chopper49.placed);

// -----------------------------------------------------------------
// TEST 50 : Airstrike refusé sur case impassable et sur case hazard
// -----------------------------------------------------------------
section("Test 50 — Airstrike : refusé sur case impassable / hazard");

tile = createTestTile(8, 6);
tile.grid[3][4].terrain = TERRAIN.IMPASSABLE;
tile.grid[3][5].hazard = HAZARD_TYPES.MINE;
const chopper50 = createChopper("Mayrik");
const choppers50 = [chopper50];

let chopR1 = placeChopperAirstrike(tile, [], choppers50, chopper50, 4, 3);
let chopR2 = placeChopperAirstrike(tile, [], choppers50, chopper50, 5, 3);
console.log("Refusé sur impassable (attendu false) :", chopR1.ok);
console.log("Refusé sur hazard (attendu false) :", chopR2.ok);

// -----------------------------------------------------------------
// TEST 51 : Airstrike refusé sur case occupée par un AUTRE chopper
// -----------------------------------------------------------------
section("Test 51 — Airstrike : refusé sur case occupée par un autre chopper");

tile = createTestTile(8, 6);
const chopperA = createChopper("Mayrik");
const chopperB = createChopper("IA");
const choppers51 = [chopperA, chopperB];
placeChopperAirstrike(tile, [], choppers51, chopperA, 4, 3); // chopperA se place en premier

placeResult = placeChopperAirstrike(tile, [], choppers51, chopperB, 4, 3);
console.log("Résultat (attendu ok:false) :", placeResult.ok, "-", placeResult.reason);

// -----------------------------------------------------------------
// TEST 52 : élimination des voitures qui finissent sur la case d'un
// chopper — MÊME les siennes propres
// -----------------------------------------------------------------
section("Test 52 — Fin de tour : voitures sur la case d'un chopper éliminées (même les siennes)");

tile = createTestTile(8, 6);
const chopper52 = createChopper("Mayrik");
placeChopperAirstrike(tile, [], [chopper52], chopper52, 4, 3);
const ownCarOnChopper = createCar("Mayrik", CAR_SIZE.MEDIUM, 4, 3);   // sa PROPRE voiture
const enemyCarOnChopper = createCar("IA", CAR_SIZE.MEDIUM, 4, 3);     // celle de l'adversaire
const safeCarElsewhere = createCar("Mayrik", CAR_SIZE.SMALL, 0, 0);   // ailleurs, doit survivre
const cars52 = [ownCarOnChopper, enemyCarOnChopper, safeCarElsewhere];

const elimResult = eliminateCarsOnChoppers(cars52, [chopper52]);
elimResult.log.forEach((l) => console.log("  " + l));
console.log("Voiture du propriétaire du chopper (attendu 'eliminated', même la sienne) :", ownCarOnChopper.status);
console.log("Voiture adverse (attendu 'eliminated') :", enemyCarOnChopper.status);
console.log("Voiture ailleurs (attendu 'operable', épargnée) :", safeCarElsewhere.status);

// -----------------------------------------------------------------
// TEST 53 : impossible de tirer sur un chopper
// -----------------------------------------------------------------
section("Test 53 — Impossible de tirer sur un chopper");

tile = createTestTile(8, 6);
const shooter53 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const chopper53 = createChopper("IA");
placeChopperAirstrike(tile, [], [chopper53], chopper53, 4, 3);

const shootAtChopper = resolveShoot(tile, [shooter53], shooter53, chopper53, { forcedDice: { shootingDie: "any" } });
shootAtChopper.log.forEach((l) => console.log("  " + l));
console.log("Touché (attendu false, impossible par nature) :", shootAtChopper.hit);

// -----------------------------------------------------------------
// TEST 54 : un chopper PEUT tirer (utilise le même moteur de tir
// générique — vérifie juste que resolveShoot accepte un chopper
// comme TIREUR, ce qui était déjà le cas sans modification)
// -----------------------------------------------------------------
section("Test 54 — Un chopper peut tirer sur une voiture");

tile = createTestTile(8, 6);
const chopper54 = createChopper("Mayrik");
placeChopperAirstrike(tile, [], [chopper54], chopper54, 3, 3);
const enemyTarget54 = createCar("IA", CAR_SIZE.MEDIUM, 4, 3); // dans l'arc avant du chopper
const cars54 = [enemyTarget54];

const chopperShootResult = resolveShoot(tile, cars54, chopper54, enemyTarget54, { forcedDice: { shootingDie: "medium" } });
chopperShootResult.log.forEach((l) => console.log("  " + l));
console.log("Touché (attendu true) :", chopperShootResult.hit);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 55 : tour complet réussi — Assign + Move + End of turn
// -----------------------------------------------------------------
section("Test 55 — Tour complet : Assign + Move + End of turn");

const { playTurnAssignMove } = require("./engine.js");

tile = createTestTile(8, 6);
const turnCar55 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars55 = [turnCar55];

let turnResult = playTurnAssignMove(tile, turnCar55, 3, ["front", "front", "front"], cars55, []);
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Résultat (attendu ok:true) :", turnResult.ok);
console.log("Position finale (attendu col 3, row 3) :", turnCar55.col, turnCar55.row);
console.log("movedThisRound (attendu true) :", turnCar55.movedThisRound);

// -----------------------------------------------------------------
// TEST 56 : impossible d'assigner deux fois la même voiture le même round
// -----------------------------------------------------------------
section("Test 56 — Refus d'assigner une voiture déjà jouée ce round");

turnResult = playTurnAssignMove(tile, turnCar55, 2, ["front", "front"], cars55, []);
console.log("Résultat (attendu ok:false) :", turnResult.ok, "-", turnResult.reason);
console.log("Position INCHANGÉE (attendu toujours col 3, row 3, le 2e essai n'a rien fait) :", turnCar55.col, turnCar55.row);

// -----------------------------------------------------------------
// TEST 57 : impossible d'assigner une voiture inopérable
// -----------------------------------------------------------------
section("Test 57 — Refus d'assigner une voiture inopérable");

tile = createTestTile(8, 6);
const brokenCar57 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
applyDamage(brokenCar57);
applyDamage(brokenCar57); // inopérable après 2 dégâts

turnResult = playTurnAssignMove(tile, brokenCar57, 3, ["front"], [brokenCar57], []);
console.log("Résultat (attendu ok:false) :", turnResult.ok, "-", turnResult.reason);

// -----------------------------------------------------------------
// TEST 58 : POINT CRITIQUE — une voiture qui finit son mouvement sur
// la case d'un chopper doit être éliminée par la vérification de fin
// de tour, MÊME SI moveCar lui-même ne connaît rien aux choppers
// -----------------------------------------------------------------
section("Test 58 — Fin de tour : élimination par chopper après un mouvement normal");

tile = createTestTile(8, 6);
const chopper58 = createChopper("IA");
placeChopperAirstrike(tile, [], [chopper58], chopper58, 3, 3); // exactement là où la voiture va finir
const doomedCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars58 = [doomedCar];

turnResult = playTurnAssignMove(tile, doomedCar, 3, ["front", "front", "front"], cars58, [chopper58]);
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Statut de la voiture (attendu 'eliminated', malgré un mouvement par ailleurs réussi) :", doomedCar.status);

// -----------------------------------------------------------------
// TEST 59 : la vérification de fin de tour porte sur TOUTES les
// voitures, pas seulement celle qui vient de jouer (ex. une voiture
// immobile depuis un tour précédent, déjà sur la case d'un chopper
// placé entre-temps par Airstrike)
// -----------------------------------------------------------------
section("Test 59 — Fin de tour : élimination d'une voiture qui n'a PAS bougé ce tour-ci");

tile = createTestTile(8, 6);
const chopper59 = createChopper("Mayrik");
const placeResult59 = placeChopperAirstrike(tile, [], [chopper59], chopper59, 5, 5); // case vide, placement réussi
console.log("Placement du chopper réussi (attendu true) :", placeResult59.ok);

// La voiture "stationnaire" est déjà sur cette case (simulateur d'un
// tour précédent), le chopper vient d'être placé là APRÈS coup —
// scénario volontairement artificiel pour isoler ce qu'on teste ici :
// eliminateCarsOnChoppers() doit repérer CETTE voiture même si elle
// n'est pas celle qui a joué le tour en cours.
const stationaryCar = createCar("IA", CAR_SIZE.SMALL, 5, 5);
const movingCar59 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3); // c'est ELLE qui joue ce tour
const cars59 = [stationaryCar, movingCar59];

turnResult = playTurnAssignMove(tile, movingCar59, 1, ["front"], cars59, [chopper59]);
turnResult.log.forEach((l) => console.log("  " + l));
console.log("stationaryCar éliminée (attendu 'eliminated', alors qu'elle n'a pas bougé ce tour) :", stationaryCar.status);
console.log("movingCar59 toujours opérable (attendu 'operable', elle n'était pas sur le chopper) :", movingCar59.status);

section("Fin des tests");

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
console.log("Position finale (attendu col 3, row 2 - direction rear-left prise automatiquement, corrigé pour la géométrie chevron réelle) :", skidCar31.col, skidCar31.row);

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

// -----------------------------------------------------------------
// TEST 60 : Nitro — dé valide (1-3) accepté, hors plage refusé
// -----------------------------------------------------------------
section("Test 60 — Nitro : validation du dé");

const { resolveNitroCommand, resolveDriftCommand, resolveRepairCommand, resolveAirstrikeCommand } = require("./engine.js");

let nitroResult = resolveNitroCommand(2);
console.log("Dé=2 (attendu ok:true, bonus:2) :", nitroResult.ok, nitroResult.bonus);
nitroResult = resolveNitroCommand(5);
console.log("Dé=5, hors plage 1-3 (attendu ok:false) :", nitroResult.ok, "-", nitroResult.reason);

// -----------------------------------------------------------------
// TEST 61 : Nitro appliqué concrètement — le mouvement dépasse 6
// -----------------------------------------------------------------
section("Test 61 — Nitro appliqué : mouvement total supérieur à 6");

tile = createTestTile(8, 6);
const nitroCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const bonus = resolveNitroCommand(3).bonus; // dé mouvement normal = 5, + nitro 3 = 8
result = moveCar(tile, nitroCar, 5 + bonus, ["front", "front", "front", "front", "front", "front", "front", "front"], [nitroCar]);
result.log.forEach((l) => console.log("  " + l));
// La tuile de test fait 8 colonnes (indices 0 à 7) : la dernière case
// valide est donc col 7, pas col 8 (qui sortirait de la tuile).
console.log("Position finale (attendu col 7, row 3 - a bien parcouru 7 cases avec un mouvement de 8, la 8e sort de la tuile de test) :", nitroCar.col, nitroCar.row);

// -----------------------------------------------------------------
// TEST 62 : Repair — dé différent de 6 refusé
// -----------------------------------------------------------------
section("Test 62 — Repair : validation du dé");

const repairTestCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 0);
applyDamage(repairTestCar);

let repairCmdResult = resolveRepairCommand(4, repairTestCar);
console.log("Dé=4 (attendu ok:false) :", repairCmdResult.ok, "-", repairCmdResult.reason);
console.log("Dégât toujours présent (attendu 1) :", repairTestCar.damageTokens.length);

repairCmdResult = resolveRepairCommand(6, repairTestCar);
console.log("Dé=6 (attendu ok:true, repaired:true) :", repairCmdResult.ok, repairCmdResult.repaired);
console.log("Dégât réparé (attendu 0) :", repairTestCar.damageTokens.length);

// -----------------------------------------------------------------
// TEST 63 : Airstrike — placement + tir "if able"
// -----------------------------------------------------------------
section("Test 63 — Airstrike : placement puis tir sur cible fournie");

tile = createTestTile(8, 6);
const airChopper = createChopper("Mayrik");
const airTarget = createCar("IA", CAR_SIZE.MEDIUM, 5, 3); // sera dans l'arc avant du chopper une fois placé en (4,3)

let airResult = resolveAirstrikeCommand(tile, [airTarget], [airChopper], airChopper, 4, 3, {
  shootTarget: airTarget,
  forcedDice: { shootingDie: "medium" }
});
airResult.log.forEach((l) => console.log("  " + l));
console.log("Chopper placé (attendu col 4, row 3) :", airChopper.col, airChopper.row);
console.log("Cible touchée (attendu 1 dégât) :", airTarget.damageTokens.length);

// -----------------------------------------------------------------
// TEST 64 : Airstrike SANS cible fournie — pas de tir, pas d'erreur
// -----------------------------------------------------------------
section("Test 64 — Airstrike : sans cible, aucun tir (pas une erreur)");

tile = createTestTile(8, 6);
const airChopper64 = createChopper("Mayrik");
airResult = resolveAirstrikeCommand(tile, [], [airChopper64], airChopper64, 4, 3, {});
console.log("Résultat (attendu ok:true) :", airResult.ok);
console.log("shootResult (attendu null, aucun tir tenté) :", airResult.shootResult);

// -----------------------------------------------------------------
// TEST 65 : DRIFT — traverse la 1ère voiture sans la slammer,
// car ce n'est PAS la case finale du mouvement
// -----------------------------------------------------------------
section("Test 65 — Drift : traverse sans slam (pas la case finale)");

tile = createTestTile(8, 6);
const driftCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const occupantOnPath = createCar("IA", CAR_SIZE.SMALL, 1, 3); // 1ère case du trajet, PAS la dernière
const cars65 = [driftCar, occupantOnPath];

result = moveCar(tile, driftCar, 3, ["front", "front", "front"], cars65, { driftAvailable: true });
result.log.forEach((l) => console.log("  " + l));
console.log("driftCar a bien continué (attendu col 3, row 3, PAS arrêtée en col 1) :", driftCar.col, driftCar.row);
console.log("occupantOnPath n'a PAS bougé (attendu col 1, row 3, pas slammée) :", occupantOnPath.col, occupantOnPath.row);
console.log("Déplacement restant (attendu 0, tout utilisé normalement) :", result.remaining);

// -----------------------------------------------------------------
// TEST 66 : DRIFT — la voiture rencontrée EST la case finale du
// mouvement → doit quand même slammer, malgré Drift actif
// -----------------------------------------------------------------
section("Test 66 — Drift : slam quand même si c'est la case finale");

tile = createTestTile(8, 6);
const driftCar66 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const occupantAtEnd = createCar("IA", CAR_SIZE.SMALL, 2, 3); // exactement où le mouvement va se terminer
const cars66 = [driftCar66, occupantAtEnd];

result = moveCar(tile, driftCar66, 2, ["front", "front"], cars66, {
  driftAvailable: true,
  forcedDice: { slam: "bottom", direction: "front" }
});
result.log.forEach((l) => console.log("  " + l));
console.log("driftCar66 a pris la place (attendu col 2, row 3 - slam malgré Drift) :", driftCar66.col, driftCar66.row);
console.log("occupantAtEnd a été projetée (attendu col 3, row 3) :", occupantAtEnd.col, occupantAtEnd.row);

// -----------------------------------------------------------------
// TEST 67 : DRIFT — ne s'applique qu'à la 1ère voiture rencontrée ;
// une 2e voiture sur le trajet (même si pas la case finale) slamme normalement
// -----------------------------------------------------------------
section("Test 67 — Drift : ne protège que la 1ère voiture rencontrée");

tile = createTestTile(8, 6);
const driftCar67 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const firstOccupant = createCar("IA-1", CAR_SIZE.SMALL, 1, 3);  // 1ère rencontre : traversée
const secondOccupant = createCar("IA-2", CAR_SIZE.SMALL, 2, 3); // 2e rencontre : slam normal
const cars67 = [driftCar67, firstOccupant, secondOccupant];

result = moveCar(tile, driftCar67, 3, ["front", "front", "front"], cars67, {
  driftAvailable: true,
  forcedDice: { slam: "bottom", direction: "front" }
});
result.log.forEach((l) => console.log("  " + l));
console.log("firstOccupant PAS slammée (attendu col 1, row 3, inchangée) :", firstOccupant.col, firstOccupant.row);
console.log("driftCar67 a pris la place de secondOccupant (attendu col 2, row 3) :", driftCar67.col, driftCar67.row);
console.log("secondOccupant a été slammée/projetée (attendu col 3, row 3) :", secondOccupant.col, secondOccupant.row);

// -----------------------------------------------------------------
// TEST 68 : Drift sans dé valide → refusé, aucun effet
// -----------------------------------------------------------------
section("Test 68 — Drift : validation du dé (hors plage 3-5)");

let driftCmdResult = resolveDriftCommand(2);
console.log("Dé=2, hors plage (attendu ok:false) :", driftCmdResult.ok, "-", driftCmdResult.reason);
driftCmdResult = resolveDriftCommand(4);
console.log("Dé=4 (attendu ok:true) :", driftCmdResult.ok, driftCmdResult.driftAvailable);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 69 : tir intégré au tour — réussi (round normal, cible fournie)
// -----------------------------------------------------------------
section("Test 69 — Tour complet avec tir : réussi");

tile = createTestTile(8, 6);
const turnShooter = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const turnTarget = createCar("IA", CAR_SIZE.MEDIUM, 4, 3); // dans l'arc avant après le mouvement
const cars69 = [turnShooter, turnTarget];

turnResult = playTurnAssignMove(tile, turnShooter, 3, ["front", "front", "front"], cars69, [], {
  shootTarget: turnTarget,
  roundNumber: 2,
  forcedDice: { shootingDie: "medium" }
});
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Tir réussi (attendu hit:true) :", turnResult.shootResult?.hit);
console.log("Cible touchée (attendu 1 dégât) :", turnTarget.damageTokens.length);

// -----------------------------------------------------------------
// TEST 70 : POINT CRITIQUE — pas de tir au 1er round, même avec une
// cible valide fournie
// -----------------------------------------------------------------
section("Test 70 — Tour complet : PAS de tir au round 1");

tile = createTestTile(8, 6);
const turnShooter70 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const turnTarget70 = createCar("IA", CAR_SIZE.MEDIUM, 4, 3);
const cars70 = [turnShooter70, turnTarget70];

turnResult = playTurnAssignMove(tile, turnShooter70, 3, ["front", "front", "front"], cars70, [], {
  shootTarget: turnTarget70,
  roundNumber: 1, // <-- premier round
  forcedDice: { shootingDie: "medium" }
});
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Aucun tir tenté (attendu shootResult:null) :", turnResult.shootResult);
console.log("Cible AUCUN dégât (attendu 0) :", turnTarget70.damageTokens.length);

// -----------------------------------------------------------------
// TEST 71 : tir toujours possible après un slam (p.10)
// -----------------------------------------------------------------
section("Test 71 — Tir possible même après un slam en cours de mouvement");

tile = createTestTile(8, 6);
const slamShooter = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const slamVictim = createCar("IA-1", CAR_SIZE.SMALL, 1, 3);   // provoque un slam dès la 1ère case
// IMPORTANT : décalée en row 2 (pas row 3) pour ne PAS se trouver sur
// la trajectoire de la voiture projetée par le slam (qui atterrirait
// en col 2, row 3) — sinon ça déclenche un 2e slam en chaîne imprévu
// qui la repousserait hors de l'arc avant du tireur.
const shootTarget71 = createCar("IA-2", CAR_SIZE.MEDIUM, 2, 2);
const cars71 = [slamShooter, slamVictim, shootTarget71];

turnResult = playTurnAssignMove(tile, slamShooter, 3, ["front", "front", "front"], cars71, [], {
  shootTarget: shootTarget71,
  roundNumber: 2,
  forcedDice: { slam: "bottom", direction: "front", shootingDie: "medium" }
});
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Le mouvement s'est arrêté sur un slam (attendu présence de slam) :", !!turnResult.moveResult.slam);
console.log("Position finale du tireur après le slam (attendu col 1, row 3) :", slamShooter.col, slamShooter.row);
console.log("Le tir a quand même été tenté et a touché (attendu hit:true) :", turnResult.shootResult?.hit);

// -----------------------------------------------------------------
// TEST 72 : pas de tir si la voiture devient inopérable pendant son
// propre mouvement (ex. Mine hazard qui l'amène à 2 dégâts)
// -----------------------------------------------------------------
section("Test 72 — Pas de tir si la voiture devient inopérable pendant le mouvement");

tile = createTestTile(8, 6);
tile.grid[3][1].hazard = HAZARD_TYPES.MINE;
const fragileCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
applyDamage(fragileCar); // déjà 1 dégât avant le tour — la mine sera le 2e
const target72 = createCar("IA", CAR_SIZE.MEDIUM, 2, 3);
const cars72 = [fragileCar, target72];

turnResult = playTurnAssignMove(tile, fragileCar, 3, ["front", "front", "front"], cars72, [], {
  shootTarget: target72,
  roundNumber: 2,
  forcedDice: { shootingDie: "medium" }
});
turnResult.log.forEach((l) => console.log("  " + l));
console.log("Statut de fragileCar après la mine (attendu 'inoperable') :", fragileCar.status);
console.log("Aucun tir tenté (attendu shootResult:null) :", turnResult.shootResult);
console.log("target72 AUCUN dégât (attendu 0) :", target72.damageTokens.length);

// -----------------------------------------------------------------
// TEST 73 : aucune cible fournie — pas de tir tenté, pas d'erreur,
// le reste du tour se déroule normalement
// -----------------------------------------------------------------
section("Test 73 — Pas de cible fournie : aucun tir tenté, tour normal");

tile = createTestTile(8, 6);
const soloCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
turnResult = playTurnAssignMove(tile, soloCar, 3, ["front", "front", "front"], [soloCar], [], { roundNumber: 2 });
console.log("Résultat (attendu ok:true) :", turnResult.ok);
console.log("shootResult (attendu null) :", turnResult.shootResult);
console.log("Position finale (attendu col 3, row 3) :", soloCar.col, soloCar.row);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 74 : Coast refusé si la voiture n'a pas encore été activée
// -----------------------------------------------------------------
section("Test 74 — Coast refusé : voiture pas encore activée ce round");

const { playTurnCoast } = require("./engine.js");

tile = createTestTile(8, 6);
const freshCoastCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
let coastResult = playTurnCoast(tile, freshCoastCar, ["front"], [freshCoastCar], []);
console.log("Résultat (attendu ok:false) :", coastResult.ok, "-", coastResult.reason);

// -----------------------------------------------------------------
// TEST 75 : POINT CRITIQUE — Coast refusé tant qu'il reste une
// voiture opérable non activée chez le même joueur
// -----------------------------------------------------------------
section("Test 75 — Coast refusé : une autre voiture du joueur n'a pas encore joué");

tile = createTestTile(8, 6);
const movedCar75 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const unmovedCar75 = createCar("Mayrik", CAR_SIZE.SMALL, 5, 5); // même joueur, PAS encore activée
const cars75 = [movedCar75, unmovedCar75];

playTurnAssignMove(tile, movedCar75, 2, ["front", "front"], cars75, []); // active movedCar75 normalement

coastResult = playTurnCoast(tile, movedCar75, ["front"], cars75, []);
console.log("Résultat (attendu ok:false, unmovedCar75 bloque le coast) :", coastResult.ok, "-", coastResult.reason);

// -----------------------------------------------------------------
// TEST 76 : Coast autorisé une fois TOUTES les voitures opérables du
// joueur activées — le dé compte comme 1, peu importe la valeur fournie
// -----------------------------------------------------------------
section("Test 76 — Coast autorisé : dé toujours compté comme 1");

tile = createTestTile(8, 6);
const soloPlayerCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars76 = [soloPlayerCar];

playTurnAssignMove(tile, soloPlayerCar, 3, ["front", "front", "front"], cars76, []); // activation normale, arrive en col 3

coastResult = playTurnCoast(tile, soloPlayerCar, ["front", "front", "front"], cars76, []); // chemin de 3, mais 1 seul point réel
coastResult.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 4, row 3 - seulement 1 case malgré un chemin de 3) :", soloPlayerCar.col, soloPlayerCar.row);
console.log("coastCount (attendu 1) :", soloPlayerCar.coastCount);

// -----------------------------------------------------------------
// TEST 77 : une voiture INOPÉRABLE du même joueur ne bloque PAS le
// coast (seules les opérables non activées bloquent)
// -----------------------------------------------------------------
section("Test 77 — Coast autorisé malgré une voiture inopérable non activée");

tile = createTestTile(8, 6);
const activeCar77 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const brokenCar77 = createCar("Mayrik", CAR_SIZE.SMALL, 5, 5);
applyDamage(brokenCar77);
applyDamage(brokenCar77); // inopérable, jamais activée ce round
const cars77 = [activeCar77, brokenCar77];

playTurnAssignMove(tile, activeCar77, 1, ["front"], cars77, []);
coastResult = playTurnCoast(tile, activeCar77, ["front"], cars77, []);
console.log("Résultat (attendu ok:true, la voiture cassée ne compte pas) :", coastResult.ok);

// -----------------------------------------------------------------
// TEST 78 : maximum 2 coasts par voiture par round — le 3e est refusé
// -----------------------------------------------------------------
section("Test 78 — Maximum 2 coasts par round : le 3e est refusé");

tile = createTestTile(8, 6);
const maxCoastCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars78 = [maxCoastCar];

playTurnAssignMove(tile, maxCoastCar, 1, ["front"], cars78, []);
let coast1 = playTurnCoast(tile, maxCoastCar, ["front"], cars78, []);
let coast2 = playTurnCoast(tile, maxCoastCar, ["front"], cars78, []);
let coast3 = playTurnCoast(tile, maxCoastCar, ["front"], cars78, []);
console.log("1er coast (attendu ok:true) :", coast1.ok);
console.log("2e coast (attendu ok:true) :", coast2.ok);
console.log("3e coast (attendu ok:false, maximum atteint) :", coast3.ok, "-", coast3.reason);
console.log("coastCount final (attendu 2, pas 3) :", maxCoastCar.coastCount);

// -----------------------------------------------------------------
// TEST 79 : impossible d'activer une commande (Drift) pendant un coast
// -----------------------------------------------------------------
section("Test 79 — Coast : impossible d'activer Drift en même temps");

tile = createTestTile(8, 6);
const noCommandCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars79 = [noCommandCar];

playTurnAssignMove(tile, noCommandCar, 1, ["front"], cars79, []);
coastResult = playTurnCoast(tile, noCommandCar, ["front"], cars79, [], { driftAvailable: true });
console.log("Résultat (attendu ok:false, Drift refusé pendant un coast) :", coastResult.ok, "-", coastResult.reason);

// -----------------------------------------------------------------
// TEST 80 : le tir fonctionne normalement pendant un tour de coast
// -----------------------------------------------------------------
section("Test 80 — Coast : le tir fonctionne normalement");

tile = createTestTile(8, 6);
const coastShooter = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
// coastShooter va se déplacer en front-left depuis (0,3) → (1,2).
// Son arc avant depuis (1,2) couvre (2,1)/(2,2)/(2,3) — la cible doit
// donc être placée là, pas à côté de la position de départ.
const coastTarget = createCar("IA", CAR_SIZE.MEDIUM, 2, 2);
const cars80 = [coastShooter, coastTarget];

playTurnAssignMove(tile, coastShooter, 0, [], cars80, []); // "activation normale" avec un chemin vide pour simplifier le test
coastResult = playTurnCoast(tile, coastShooter, ["front-left"], cars80, [], {
  shootTarget: coastTarget,
  roundNumber: 2,
  forcedDice: { shootingDie: "medium" }
});
coastResult.log.forEach((l) => console.log("  " + l));
console.log("Tir réussi pendant le coast (attendu hit:true) :", coastResult.shootResult?.hit);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 81 : rotation de base — 2 joueurs, un tour à la fois (PAS
// 3 tours d'affilée pour le même joueur)
// -----------------------------------------------------------------
section("Test 81 — Rotation à un tour à la fois entre 2 joueurs");

const { createRoundState, getCurrentPlayer, advanceTurn, isPlayerOutOfGame, ensureRoadDieRolled } = require("./engine.js");

const carsRound1 = [
  createCar("Alice", CAR_SIZE.MEDIUM, 0, 0),
  createCar("Bob", CAR_SIZE.MEDIUM, 0, 1)
];
let roundState = createRoundState(["Alice", "Bob"]);

const sequence = [getCurrentPlayer(roundState)];
for (let i = 0; i < 5; i++) {
  advanceTurn(roundState, carsRound1);
  sequence.push(getCurrentPlayer(roundState));
}
console.log("Séquence des 6 premiers joueurs (attendu Alice,Bob,Alice,Bob,Alice,Bob) :", sequence.join(","));

// -----------------------------------------------------------------
// TEST 82 : détection correcte de fin de round après 3 tours chacun
// -----------------------------------------------------------------
section("Test 82 — Fin de round détectée après 3 tours par joueur (2 joueurs = 6 tours)");

const carsRound2 = [
  createCar("Alice", CAR_SIZE.MEDIUM, 0, 0),
  createCar("Bob", CAR_SIZE.MEDIUM, 0, 1)
];
roundState = createRoundState(["Alice", "Bob"]);

let roundEndLog = [];
for (let i = 0; i < 6; i++) {
  const result = advanceTurn(roundState, carsRound2);
  roundEndLog.push(...result.log);
}
console.log("Round après 6 tours (attendu 2) :", roundState.roundNumber);
console.log("Compteurs remis à 0 (attendu 0,0) :", roundState.turnsThisRound["Alice"], roundState.turnsThisRound["Bob"]);
console.log("roadDie remis à null (attendu null) :", roundState.roadDie);
roundEndLog.forEach((l) => { if (l.includes("round")) console.log("  " + l); });

// -----------------------------------------------------------------
// TEST 83 : dé Road tiré une seule fois par round, même si on
// appelle ensureRoadDieRolled plusieurs fois
// -----------------------------------------------------------------
section("Test 83 — Dé Road : tiré une seule fois par round (idempotent)");

roundState = createRoundState(["Alice", "Bob"]);
let roadResult1 = ensureRoadDieRolled(roundState, 2);
let roadResult2 = ensureRoadDieRolled(roundState, 3); // valeur différente, ne doit RIEN changer
console.log("1er appel (attendu value:2, log non vide) :", roadResult1.value, roadResult1.log.length > 0);
console.log("2e appel (attendu value:2 INCHANGÉ, log vide) :", roadResult2.value, roadResult2.log.length === 0);

// -----------------------------------------------------------------
// TEST 84 : POINT CRITIQUE — un joueur hors jeu (toutes voitures
// éliminées/inopérables) est SAUTÉ dans la rotation
// -----------------------------------------------------------------
section("Test 84 — Joueur hors jeu sauté dans la rotation");

const carsRound3 = [
  createCar("Alice", CAR_SIZE.MEDIUM, 0, 0),
  createCar("Bob", CAR_SIZE.MEDIUM, 0, 1),
  createCar("Charlie", CAR_SIZE.MEDIUM, 0, 2)
];
carsRound3[1].status = CAR_STATUS.ELIMINATED; // Bob n'a qu'une voiture, éliminée → hors jeu
console.log("Bob hors jeu (attendu true) :", isPlayerOutOfGame("Bob", carsRound3));

roundState = createRoundState(["Alice", "Bob", "Charlie"]);
const sequence3 = [getCurrentPlayer(roundState)];
for (let i = 0; i < 3; i++) {
  advanceTurn(roundState, carsRound3);
  sequence3.push(getCurrentPlayer(roundState));
}
console.log("Séquence (attendu Alice,Charlie,Alice,Charlie — Bob jamais présent) :", sequence3.join(","));

// -----------------------------------------------------------------
// TEST 85 : le prochain round démarre avec le bon 1er joueur
// (celui qui suit dans l'ordre de table)
// -----------------------------------------------------------------
section("Test 85 — Le round suivant démarre avec le joueur suivant dans l'ordre");

const carsRound4 = [
  createCar("Alice", CAR_SIZE.MEDIUM, 0, 0),
  createCar("Bob", CAR_SIZE.MEDIUM, 0, 1)
];
roundState = createRoundState(["Alice", "Bob"]); // Alice commence le round 1
for (let i = 0; i < 6; i++) advanceTurn(roundState, carsRound4); // termine le round 1 (3 tours chacun)
console.log("1er joueur du round 2 (attendu Bob, celui après Alice) :", getCurrentPlayer(roundState));

// -----------------------------------------------------------------
// TEST 86 : cas limite — un seul joueur encore en jeu (les autres
// hors jeu) : il rejoue ses tours restants sans blocage
// -----------------------------------------------------------------
section("Test 86 — Cas limite : un seul joueur encore en jeu");

const carsRound5 = [
  createCar("Alice", CAR_SIZE.MEDIUM, 0, 0),
  createCar("Bob", CAR_SIZE.MEDIUM, 0, 1)
];
carsRound5[1].status = CAR_STATUS.ELIMINATED; // Bob hors jeu dès le départ

roundState = createRoundState(["Alice", "Bob"]);
const sequence5 = [getCurrentPlayer(roundState)];
for (let i = 0; i < 3; i++) {
  advanceTurn(roundState, carsRound5);
  sequence5.push(getCurrentPlayer(roundState));
}
console.log("Séquence (attendu Alice à chaque fois, aucun blocage) :", sequence5.join(","));
// Alice seule active : après ses 3 tours, la règle "chaque joueur
// ENCORE EN JEU a pris 3 tours" est satisfaite (trivialement, elle est
// seule) → le round se termine normalement, passage au round 2.
console.log("Round passé à 2 après les 3 tours d'Alice seule (règle satisfaite dès qu'elle a fini) :", roundState.roundNumber);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 87 : éligible — voiture restée 100% sur route, bonus appliqué
// -----------------------------------------------------------------
section("Test 87 — Bonus Road : éligible, tout le trajet sur route");

const { applyRoadBonus } = require("./engine.js");

tile = createTestTile(8, 6);
const roadCar87 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3); // départ sur route (grille par défaut = tout route)
const cars87 = [roadCar87];

let moveRes = moveCar(tile, roadCar87, 2, ["front", "front"], cars87);
console.log("roadEligible après le mouvement (attendu true) :", moveRes.roadEligible);

let bonusRes = applyRoadBonus(tile, roadCar87, moveRes, cars87, 3, ["front", "front", "front"]);
bonusRes.log.forEach((l) => console.log("  " + l));
console.log("Bonus appliqué (attendu ok:true) :", bonusRes.ok);
console.log("Position finale (attendu col 5, row 3 - 2 normal + 3 bonus) :", roadCar87.col, roadCar87.row);

// -----------------------------------------------------------------
// TEST 88 : NON éligible — une case du trajet n'est pas de la route
// -----------------------------------------------------------------
section("Test 88 — Bonus Road : refusé si une case n'est pas route");

tile = createTestTile(8, 6);
tile.grid[3][1].terrain = TERRAIN.OFF_ROAD; // 1ère case du trajet
const offRoadCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars88 = [offRoadCar];

moveRes = moveCar(tile, offRoadCar, 2, ["front", "front"], cars88);
console.log("roadEligible (attendu false, une case off-road traversée) :", moveRes.roadEligible);

bonusRes = applyRoadBonus(tile, offRoadCar, moveRes, cars88, 3, ["front"]);
console.log("Bonus refusé (attendu ok:false) :", bonusRes.ok, "-", bonusRes.reason);

// -----------------------------------------------------------------
// TEST 89 : hazard Blank résolu en route pendant le trajet — ne casse
// PAS l'éligibilité
// -----------------------------------------------------------------
section("Test 89 — Bonus Road : hazard Blank résolu en route ne casse pas l'éligibilité");

tile = createTestTile(8, 6);
tile.grid[3][1].hazard = HAZARD_TYPES.BLANK; // case avec un hazard "vide" sur le trajet
const blankRoadCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars89 = [blankRoadCar];

moveRes = moveCar(tile, blankRoadCar, 2, ["front", "front"], cars89);
console.log("roadEligible (attendu true, Blank devient route) :", moveRes.roadEligible);

// -----------------------------------------------------------------
// TEST 90 : hazard Oil Slick qui glisse VERS une case route — ne
// casse PAS l'éligibilité (précision de Mayrik)
// -----------------------------------------------------------------
section("Test 90 — Bonus Road : Oil Slick qui glisse vers une case route reste éligible");

tile = createTestTile(8, 6);
tile.grid[3][1].hazard = HAZARD_TYPES.OIL_SLICK; // 1ère case, glissade ensuite vers une route
const oilRoadCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars90 = [oilRoadCar];

moveRes = moveCar(tile, oilRoadCar, 1, ["front"], cars90, {
  forcedDice: { oilSlickDirection: "front" } // glisse vers col2, qui est une route normale
});
moveRes.log.forEach((l) => console.log("  " + l));
console.log("roadEligible (attendu true, la glissade atterrit sur une route) :", moveRes.roadEligible);

// -----------------------------------------------------------------
// TEST 91 : hazard Dirt (devient boue) casse bien l'éligibilité
// -----------------------------------------------------------------
section("Test 91 — Bonus Road : hazard Dirt (boue) casse l'éligibilité");

tile = createTestTile(8, 6);
tile.grid[3][1].hazard = HAZARD_TYPES.DIRT;
const dirtRoadCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars91 = [dirtRoadCar];

moveRes = moveCar(tile, dirtRoadCar, 2, ["front", "front"], cars91);
console.log("roadEligible (attendu false, Dirt devient boue) :", moveRes.roadEligible);

// -----------------------------------------------------------------
// TEST 92 : 1er tour — zone de départ hors plateau considérée route
// -----------------------------------------------------------------
section("Test 92 — Bonus Road : zone de départ (1er tour) considérée route");

tile = createTestTile(8, 6);
// La voiture est déjà "sur" la tuile à (0,3) dans notre modèle actuel
// (pas encore de vraie notion de zone hors plateau) — on simule le
// 1er tour via le flag dédié, même si la case (0,3) était autre chose.
tile.grid[3][0].terrain = TERRAIN.OFF_ROAD; // la case de départ elle-même n'est PAS de la route
const firstTurnCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars92 = [firstTurnCar];

moveRes = moveCar(tile, firstTurnCar, 2, ["front", "front"], cars92, {
  startedInStartingArea: true // 1er tour : la zone de départ compte comme route par convention
});
console.log("roadEligible (attendu true malgré la case de départ non-route, grâce au flag 1er tour) :", moveRes.roadEligible);

// Contre-test : sans le flag, la même situation doit être refusée
tile = createTestTile(8, 6);
tile.grid[3][0].terrain = TERRAIN.OFF_ROAD;
const noFlagCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
moveRes = moveCar(tile, noFlagCar, 2, ["front", "front"], [noFlagCar]); // pas de flag
console.log("Sans le flag (attendu false, comportement normal) :", moveRes.roadEligible);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 93 : le plateau (3 tuiles collées) a bien les bonnes dimensions
// -----------------------------------------------------------------
section("Test 93 — createBoard : dimensions correctes");

const { createBoard } = require("./engine.js");

const rear93 = createTestTile(8, 6);
const middle93 = createTestTile(8, 6);
const lead93 = createTestTile(8, 6);
let board93 = createBoard(rear93, middle93, lead93);

console.log("Colonnes totales (attendu 24) :", board93.cols);
console.log("Lignes (attendu 6) :", board93.rows);
console.log("tileCols (attendu 8) :", board93.tileCols);

// -----------------------------------------------------------------
// TEST 94 : une voiture peut traverser rear → middle → lead SANS
// AUCUNE modification du moteur — preuve que l'astuce fonctionne
// -----------------------------------------------------------------
section("Test 94 — Traversée rear → middle → lead, moteur inchangé");

const rear94 = createTestTile(8, 6);
const middle94 = createTestTile(8, 6);
const lead94 = createTestTile(8, 6);
const board94 = createBoard(rear94, middle94, lead94);

// Départ en col 6 (rear), dé de 10 : doit traverser toute la tuile
// rear (2 cases restantes), toute la middle (8 cases), et entrer de
// 0 case sur la lead (10-2-8=0) → doit finir en col 16 (tout début
// de la tuile lead, col globale 16 = tileCols*2).
const crossingCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 6, 3);
const cars94 = [crossingCar];

let result94 = moveCar(board94, crossingCar, 10, Array(10).fill("front"), cars94);
result94.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 16, row 3 - sur la tuile LEAD) :", crossingCar.col, crossingCar.row);
console.log("Restant (attendu 0) :", result94.remaining);

// -----------------------------------------------------------------
// TEST 95 : un hazard placé sur la tuile MIDDLE (via la vraie tuile,
// pas le plateau) se déclenche correctement quand on l'atteint via
// des coordonnées globales du plateau
// -----------------------------------------------------------------
section("Test 95 — Hazard sur la tuile middle, atteint via coordonnées globales");

const rear95 = createTestTile(8, 6);
const middle95 = createTestTile(8, 6);
const lead95 = createTestTile(8, 6);
middle95.grid[3][2].hazard = HAZARD_TYPES.MINE; // col LOCALE 2 sur middle = col GLOBALE 10 sur le plateau
const board95 = createBoard(rear95, middle95, lead95);

const mineCar95 = createCar("Mayrik", CAR_SIZE.MEDIUM, 7, 3); // juste avant la frontière rear/middle (col globale 7)
const cars95 = [mineCar95];

let result95 = moveCar(board95, mineCar95, 4, ["front", "front", "front", "front"], cars95, {
  tokenType: TOKEN_TYPES.DENT // jeton forcé pour un résultat déterministe (sinon un Skid/Dazed tiré au hasard déplacerait encore la voiture après le dégât)
});
result95.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 10, row 3 - la mine a coupé le mouvement net) :", mineCar95.col, mineCar95.row);
console.log("Dégâts reçus (attendu 1) :", mineCar95.damageTokens.length);

// -----------------------------------------------------------------
// TEST 96 : la MÊME cellule est bien partagée entre le plateau et la
// vraie tuile (pas une copie) — une mutation via le plateau doit être
// visible directement sur middle95.grid
// -----------------------------------------------------------------
section("Test 96 — Les cellules du plateau sont les MÊMES objets que celles des tuiles");

const rear96 = createTestTile(8, 6);
const middle96 = createTestTile(8, 6);
const lead96 = createTestTile(8, 6);
middle96.grid[3][2].hazard = HAZARD_TYPES.BLANK; // deviendra route une fois résolu
const board96 = createBoard(rear96, middle96, lead96);

console.log("Terrain AVANT résolution sur la vraie tuile middle (attendu 'road', pas encore résolu) :", middle96.grid[3][2].terrain);

const testCar96 = createCar("Mayrik", CAR_SIZE.MEDIUM, 9, 3);
moveCar(board96, testCar96, 1, ["front"], [testCar96]); // col globale 10 = middle[3][2]

console.log("Terrain APRÈS résolution sur la vraie tuile middle (attendu 'road' toujours, mais hazard consommé) :", middle96.grid[3][2].terrain);
console.log("Hazard consommé sur la VRAIE tuile (attendu null, pas juste sur le plateau) :", middle96.grid[3][2].hazard);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 97 : signal frontExit renvoyé quand une voiture atteint le
// bord avant du plateau (pas une élimination)
// -----------------------------------------------------------------
section("Test 97 — Sortie par l'avant : signal frontExit, PAS une élimination");

const { createTileProgressionState, buildBoardFromProgressionState, checkGameEndConditions, advanceBoardOnFrontExit } = require("./engine.js");

const rear97 = createTestTile(8, 6);
const middle97 = createTestTile(8, 6);
const lead97 = createTestTile(8, 6);
const board97 = createBoard(rear97, middle97, lead97);

const edgeCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3); // 2 cases avant le bord (col 24 = hors plateau)
let result97 = moveCar(board97, edgeCar, 3, ["front", "front", "front"], [edgeCar]);
result97.log.forEach((l) => console.log("  " + l));
console.log("frontExit (attendu true) :", result97.frontExit);
console.log("Statut (attendu 'operable', PAS éliminée) :", edgeCar.status);
console.log("Position (attendu col 23, row 3 - dernière case valide atteinte) :", edgeCar.col, edgeCar.row);

// -----------------------------------------------------------------
// TEST 98 : sortie par l'ARRIÈRE (col < 0) → élimination, via slam
// -----------------------------------------------------------------
section("Test 98 — Sortie par l'arrière (slam) : élimination");

tile = createTestTile(8, 6);
const rearVictim = createCar("Mayrik", CAR_SIZE.SMALL, 0, 3); // tout au bord arrière
const rearAttacker = createCar("IA", CAR_SIZE.MEDIUM, 0, 3); // même case pour forcer le slam direct
const cars98 = [rearAttacker, rearVictim];

const slamResult98 = resolveSlam(tile, cars98, rearAttacker, rearVictim, {
  forcedDice: { slam: "bottom", direction: "rear" } // projette rearVictim vers col -1
});
slamResult98.log.forEach((l) => console.log("  " + l));
console.log("Statut de rearVictim (attendu 'eliminated') :", rearVictim.status);

// -----------------------------------------------------------------
// TEST 99 : décalage complet des tuiles — élimination sur rear,
// chopper rendu, positions rebasées correctement
// -----------------------------------------------------------------
section("Test 99 — Décalage complet : élimination, chopper rendu, rebasage");

const rear99 = createTestTile(8, 6);
const middle99 = createTestTile(8, 6);
const lead99 = createTestTile(8, 6);
const newLead99 = createTestTile(8, 6);
let progState99 = createTileProgressionState(rear99, middle99, lead99, [newLead99]);

const carOnRear = createCar("IA", CAR_SIZE.SMALL, 3, 3);      // sur rear (col 0-7) → doit être éliminée
const carOnMiddle = createCar("Mayrik", CAR_SIZE.MEDIUM, 10, 3); // sur middle (col 8-15) → doit devenir col 2
const carOnLead = createCar("Mayrik", CAR_SIZE.LARGE, 20, 3);   // sur lead (col 16-23) → doit devenir col 12
const chopperOnRear = createChopper("IA");
placeChopperAirstrike(buildBoardFromProgressionState(progState99), [], [chopperOnRear], chopperOnRear, 5, 2); // sur rear
const allCars99 = [carOnRear, carOnMiddle, carOnLead];
const allChoppers99 = [chopperOnRear];

let advanceResult = advanceBoardOnFrontExit(progState99, allCars99, allChoppers99);
advanceResult.log.forEach((l) => console.log("  " + l));

console.log("carOnRear (attendu 'eliminated') :", carOnRear.status);
console.log("carOnMiddle position rebasée (attendu col 2, row 3) :", carOnMiddle.col, carOnMiddle.row);
console.log("carOnLead position rebasée (attendu col 12, row 3) :", carOnLead.col, carOnLead.row);
console.log("chopperOnRear rendu (attendu placed:false, col:null) :", chopperOnRear.placed, chopperOnRear.col);
console.log("Nouvelle disposition : rear=ancien middle (attendu true) :", progState99.rearTile === middle99);
console.log("Nouvelle disposition : middle=ancien lead (attendu true) :", progState99.middleTile === lead99);
console.log("Nouvelle disposition : lead=nouvelle tuile piochée (attendu true) :", progState99.leadTile === newLead99);
console.log("tilesPlacedCount (attendu 2) :", progState99.tilesPlacedCount);

// -----------------------------------------------------------------
// TEST 100 : le nouveau plateau reconstruit fonctionne bien avec le
// reste du moteur (une voiture peut continuer à bouger dessus)
// -----------------------------------------------------------------
section("Test 100 — Le plateau reconstruit après décalage est pleinement fonctionnel");

let newBoard99 = advanceResult.newBoard;
result = moveCar(newBoard99, carOnMiddle, 2, ["front", "front"], allCars99);
result.log.forEach((l) => console.log("  " + l));
console.log("Position finale (attendu col 4, row 3) :", carOnMiddle.col, carOnMiddle.row);

// -----------------------------------------------------------------
// TEST 101 : tuile finale — règle des 5 tuiles à 2 joueurs
// -----------------------------------------------------------------
section("Test 101 — Finish Line : 5e tuile à 2 joueurs");

const rear101 = createTestTile(8, 6);
const middle101 = createTestTile(8, 6);
const lead101 = createTestTile(8, 6);
let progState101 = createTileProgressionState(rear101, middle101, lead101);
progState101.tilesPlacedCount = 5; // simulateur : on a déjà posé 5 tuiles

let endCheck101 = checkGameEndConditions(progState101, [], [], ["Alice", "Bob"]);
endCheck101.log.forEach((l) => console.log("  " + l));
console.log("Finish Line attachée (attendu true) :", !!progState101.finishLineTile);
console.log("Partie pas encore terminée (attendu false, personne ne l'a encore atteinte) :", endCheck101.gameOver);

// Contre-test : avant la 5e tuile, pas encore de Finish Line
const rear101b = createTestTile(8, 6);
const middle101b = createTestTile(8, 6);
const lead101b = createTestTile(8, 6);
let progState101b = createTileProgressionState(rear101b, middle101b, lead101b);
progState101b.tilesPlacedCount = 4;
let endCheck101b = checkGameEndConditions(progState101b, [], [], ["Alice", "Bob"]);
console.log("Avant la 5e tuile (attendu false) :", !!progState101b.finishLineTile);

// -----------------------------------------------------------------
// TEST 102 : Finish Line — un joueur hors jeu (3-4 joueurs)
// -----------------------------------------------------------------
section("Test 102 — Finish Line : joueur hors jeu (3-4 joueurs)");

const rear102 = createTestTile(8, 6);
const middle102 = createTestTile(8, 6);
const lead102 = createTestTile(8, 6);
let progState102 = createTileProgressionState(rear102, middle102, lead102);

const aliceCar102 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 0);
const bobCar102 = createCar("Bob", CAR_SIZE.MEDIUM, 0, 1);
bobCar102.status = CAR_STATUS.ELIMINATED; // Bob hors jeu
const charlieCar102 = createCar("Charlie", CAR_SIZE.MEDIUM, 0, 2);
const cars102 = [aliceCar102, bobCar102, charlieCar102];

let endCheck102 = checkGameEndConditions(progState102, cars102, [], ["Alice", "Bob", "Charlie"]);
endCheck102.log.forEach((l) => console.log("  " + l));
console.log("Finish Line attachée (attendu true, Bob est hors jeu) :", !!progState102.finishLineTile);
console.log("Partie pas encore terminée (attendu false, 2 joueurs actifs restants) :", endCheck102.gameOver);

// -----------------------------------------------------------------
// TEST 102bis : victoire par "dernier joueur restant" (sans Finish Line)
// -----------------------------------------------------------------
section("Test 102bis — Victoire : dernier joueur restant");

const rear102c = createTestTile(8, 6);
const middle102c = createTestTile(8, 6);
const lead102c = createTestTile(8, 6);
let progState102c = createTileProgressionState(rear102c, middle102c, lead102c);

const aliceCar102c = createCar("Alice", CAR_SIZE.MEDIUM, 0, 0);
const bobCar102c = createCar("Bob", CAR_SIZE.MEDIUM, 0, 1);
bobCar102c.status = CAR_STATUS.ELIMINATED; // Bob hors jeu, partie à 2 joueurs → Alice seule restante
const cars102c = [aliceCar102c, bobCar102c];

let endCheck102c = checkGameEndConditions(progState102c, cars102c, [], ["Alice", "Bob"]);
endCheck102c.log.forEach((l) => console.log("  " + l));
console.log("Partie terminée (attendu true) :", endCheck102c.gameOver);
console.log("Gagnant (attendu 'Alice') :", endCheck102c.winner);
console.log("Raison (attendu 'last-player-standing') :", endCheck102c.reason);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 103 : createBoard accepte maintenant 4 tuiles (rétrocompatible
// avec les appels à 3 déjà utilisés partout ailleurs, vérifié plus haut)
// -----------------------------------------------------------------
section("Test 103 — createBoard avec 4 tuiles (rear+middle+lead+arrivée)");

const { createFinishLineTile, moveCarWithProgression } = require("./engine.js");

const rear103 = createTestTile(8, 6);
const middle103 = createTestTile(8, 6);
const lead103 = createTestTile(8, 6);
const finish103 = createFinishLineTile(6);
const board103 = createBoard(rear103, middle103, lead103, finish103);

console.log("Colonnes totales (attendu 25 = 8+8+8+1) :", board103.cols);
console.log("La tuile d'arrivée fait bien 1 colonne :", finish103.cols);

// -----------------------------------------------------------------
// TEST 104 : orchestrateur — décalage classique (pas encore la tuile
// finale), le mouvement restant continue sur le nouveau plateau
// -----------------------------------------------------------------
section("Test 104 — Orchestrateur : décalage classique, mouvement continue");

const rear104 = createTestTile(8, 6);
const middle104 = createTestTile(8, 6);
const lead104 = createTestTile(8, 6);
const nextLead104 = createTestTile(8, 6);
let progState104 = createTileProgressionState(rear104, middle104, lead104, [nextLead104]);

const travelCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3); // 2 cases avant le bord
const cars104 = [travelCar];

let orchResult = moveCarWithProgression(progState104, travelCar, 5, Array(5).fill("front"), cars104, [], ["Mayrik", "IA"]);
orchResult.log.forEach((l) => console.log("  " + l));
console.log("Gagnant (attendu null, pas encore la tuile finale) :", orchResult.winner);
// Trajet réel : col22→23 (1 case), sortie avant, décalage (rebasage
// col23→15), puis 4 cases de plus sur le nouveau plateau : 15→19.
console.log("Position finale (attendu col 19, row 3 sur le NOUVEAU plateau) :", travelCar.col, travelCar.row);
console.log("La tuile rear a bien changé (attendu true, = ancien middle) :", progState104.rearTile === middle104);

// -----------------------------------------------------------------
// TEST 105 : orchestrateur — scénario complet de victoire (partie à
// 2 joueurs, 5e tuile atteinte, la voiture entre sur la ligne d'arrivée)
// -----------------------------------------------------------------
section("Test 105 — Orchestrateur : victoire complète (5e tuile, ligne d'arrivée)");

const rear105 = createTestTile(8, 6);
const middle105 = createTestTile(8, 6);
const lead105 = createTestTile(8, 6);
let progState105 = createTileProgressionState(rear105, middle105, lead105);
progState105.tilesPlacedCount = 5; // on simule qu'on est déjà à la 5e tuile (partie à 2 joueurs)

const winnerCar = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3); // 2 cases avant le bord de la lead (= tuile finale)
const cars105 = [winnerCar];

let winResult = moveCarWithProgression(progState105, winnerCar, 3, ["front", "front", "front"], cars105, [], ["Mayrik", "IA"]);
winResult.log.forEach((l) => console.log("  " + l));
console.log("Gagnant (attendu 'Mayrik') :", winResult.winner);
console.log("finishLineTile bien attachée à l'état (attendu true) :", !!progState105.finishLineTile);
console.log("Position finale (attendu col 24 - sur la tuile d'arrivée) :", winnerCar.col, winnerCar.row);

// -----------------------------------------------------------------
// TEST 106 : orchestrateur — victoire à 3+ joueurs (joueur hors jeu
// déclenche la tuile finale immédiatement, peu importe le compte de tuiles)
// -----------------------------------------------------------------
section("Test 106 — Orchestrateur : victoire à 3+ joueurs (joueur hors jeu)");

const rear106 = createTestTile(8, 6);
const middle106 = createTestTile(8, 6);
const lead106 = createTestTile(8, 6);
let progState106 = createTileProgressionState(rear106, middle106, lead106);
// tilesPlacedCount reste à 1 — la règle des 5 tuiles ne s'applique pas ici (3 joueurs)

const eliminatedPlayerCar = createCar("Bob", CAR_SIZE.SMALL, 0, 5);
eliminatedPlayerCar.status = CAR_STATUS.ELIMINATED; // Bob est hors jeu
const winnerCar106 = createCar("Mayrik", CAR_SIZE.MEDIUM, 23, 3); // 1 case avant le bord
const cars106 = [eliminatedPlayerCar, winnerCar106];

let winResult106 = moveCarWithProgression(progState106, winnerCar106, 2, ["front", "front"], cars106, [], ["Mayrik", "Bob", "Charlie"]);
winResult106.log.forEach((l) => console.log("  " + l));
console.log("Gagnant (attendu 'Mayrik', malgré tilesPlacedCount=1 seulement) :", winResult106.winner);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 107 : tour complet AVEC progression — décalage de tuile en
// plein tour, tir après, END OF TURN, aucune victoire
// -----------------------------------------------------------------
section("Test 107 — Tour complet avec progression : décalage + tir, pas de victoire");

const { playTurnAssignMoveWithProgression, playTurnCoastWithProgression } = require("./engine.js");

const rear107 = createTestTile(8, 6);
const middle107 = createTestTile(8, 6);
const lead107 = createTestTile(8, 6);
const nextLead107 = createTestTile(8, 6);
let progState107 = createTileProgressionState(rear107, middle107, lead107, [nextLead107]);

const travelCar107 = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3);
const targetCar107 = createCar("IA", CAR_SIZE.MEDIUM, 17, 3); // sera dans l'arc avant après le décalage (nouvelle position)
const cars107 = [travelCar107, targetCar107];

let turnResult107 = playTurnAssignMoveWithProgression(
  progState107, travelCar107, 5, Array(5).fill("front"), cars107, [], ["Mayrik", "IA"],
  { shootTarget: targetCar107, roundNumber: 2, forcedDice: { shootingDie: "medium" } }
);
turnResult107.log.forEach((l) => console.log("  " + l));
console.log("Résultat (attendu ok:true) :", turnResult107.ok);
console.log("gameOver (attendu false) :", turnResult107.gameOver);
console.log("movedThisRound (attendu true) :", travelCar107.movedThisRound);
console.log("Tir tenté (attendu shootResult non-null) :", !!turnResult107.shootResult);

// -----------------------------------------------------------------
// TEST 108 : tour complet AVEC progression — victoire en cours de
// mouvement (entrée sur la Finish Line), le tour s'arrête net
// -----------------------------------------------------------------
section("Test 108 — Tour complet avec progression : victoire en plein mouvement");

const rear108 = createTestTile(8, 6);
const middle108 = createTestTile(8, 6);
const lead108 = createTestTile(8, 6);
let progState108 = createTileProgressionState(rear108, middle108, lead108);
progState108.tilesPlacedCount = 5; // partie à 2 joueurs, déjà à la 5e tuile

const winnerCar108 = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3);
const cars108 = [winnerCar108];

let turnResult108 = playTurnAssignMoveWithProgression(
  progState108, winnerCar108, 3, ["front", "front", "front"], cars108, [], ["Mayrik", "IA"], {}
);
turnResult108.log.forEach((l) => console.log("  " + l));
console.log("gameOver (attendu true) :", turnResult108.gameOver);
console.log("Gagnant (attendu 'Mayrik') :", turnResult108.winner);

// -----------------------------------------------------------------
// TEST 109 : Coast avec progression — fonctionne aussi de bout en bout
// -----------------------------------------------------------------
section("Test 109 — Coast avec progression : fonctionne de bout en bout");

const rear109 = createTestTile(8, 6);
const middle109 = createTestTile(8, 6);
const lead109 = createTestTile(8, 6);
let progState109 = createTileProgressionState(rear109, middle109, lead109);

const coastCar109 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const cars109 = [coastCar109];

playTurnAssignMoveWithProgression(progState109, coastCar109, 1, ["front"], cars109, [], ["Mayrik", "IA"], {});
let coastResult109 = playTurnCoastWithProgression(progState109, coastCar109, ["front"], cars109, [], ["Mayrik", "IA"], {});
coastResult109.log.forEach((l) => console.log("  " + l));
console.log("Résultat (attendu ok:true) :", coastResult109.ok);
console.log("coastCount (attendu 1) :", coastCar109.coastCount);
console.log("Position finale (attendu col 2, row 3) :", coastCar109.col, coastCar109.row);

// -----------------------------------------------------------------
// TEST 110 : victoire détectée en fin de tour même SANS que le
// mouvement lui-même n'ait atteint la Finish Line (ex. le tir de ce
// tour élimine le dernier adversaire actif)
// -----------------------------------------------------------------
section("Test 110 — Victoire détectée en fin de tour via le tir (pas via le mouvement)");

const rear110 = createTestTile(8, 6);
const middle110 = createTestTile(8, 6);
const lead110 = createTestTile(8, 6);
let progState110 = createTileProgressionState(rear110, middle110, lead110);

const shooterCar110 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
const lastEnemyCar110 = createCar("IA", CAR_SIZE.SMALL, 1, 3); // sera dans l'arc avant, et c'est la SEULE voiture de "IA"
const cars110 = [shooterCar110, lastEnemyCar110];

let turnResult110 = playTurnAssignMoveWithProgression(
  progState110, shooterCar110, 1, ["front"], cars110, [], ["Mayrik", "IA"],
  { shootTarget: lastEnemyCar110, roundNumber: 2, forcedDice: { shootingDie: "any" } }
);
// Remarque : un seul tir suffit à rendre "IA" inopérable seulement si
// c'est déjà son 2e dégât — on force donc un 2e coup pour simuler le
// KO. Ici on vérifie surtout la MÉCANIQUE de détection, pas un
// scénario de dégâts réaliste à 1 coup.
lastEnemyCar110.status = CAR_STATUS.INOPERABLE; // on simule directement l'état "hors jeu" après ce tour
turnResult110.log.forEach((l) => console.log("  " + l));

// On revérifie manuellement l'état de fin de partie pour confirmer
// que la mécanique réagit bien à cette situation simulée.
let manualEndCheck = checkGameEndConditions(progState110, cars110, [], ["Mayrik", "IA"]);
console.log("Partie terminée après élimination du dernier adversaire (attendu true) :", manualEndCheck.gameOver);
console.log("Gagnant (attendu 'Mayrik') :", manualEndCheck.winner);

section("Fin des tests");

// -----------------------------------------------------------------
// TEST 111 : Blast Off qui dépasse le bord avant, SANS Finish Line
// encore en place → déclenche le décalage normal des tuiles
// -----------------------------------------------------------------
section("Test 111 — Blast Off qui dépasse le bord avant : décalage de tuile");

const rear111 = createTestTile(8, 6);
const middle111 = createTestTile(8, 6);
const lead111 = createTestTile(8, 6);
const nextLead111 = createTestTile(8, 6);
let progState111 = createTileProgressionState(rear111, middle111, lead111, [nextLead111]);

const blastCar111 = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3); // proche du bord avant (col 24)
const cars111 = [blastCar111];

const dmgResult111 = applyDamage(blastCar111, {
  tokenType: TOKEN_TYPES.BLAST_OFF,
  tile: buildBoardFromProgressionState(progState111),
  allCars: cars111,
  progressionState: progState111,
  allChoppers: [],
  forcedDice: { blastOffDirection: "front", blastOffStunt: 4 } // 22+4=26, dépasse largement les 24 colonnes
});
dmgResult111.log.forEach((l) => console.log("  " + l));
console.log("La tuile rear a bien changé (attendu true, = ancien middle) :", progState111.rearTile === middle111);
console.log("Position finale rebasée (attendu col 18, row 3 - 26 moins 8 de décalage) :", blastCar111.col, blastCar111.row);

// -----------------------------------------------------------------
// TEST 112 : Blast Off qui atterrit sur la Finish Line déjà en place
// → position au-delà du seuil, détectée comme victoire par
// checkGameEndConditions ensuite
// -----------------------------------------------------------------
section("Test 112 — Blast Off qui atterrit sur la Finish Line : victoire");

const rear112 = createTestTile(8, 6);
const middle112 = createTestTile(8, 6);
const lead112 = createTestTile(8, 6);
let progState112 = createTileProgressionState(rear112, middle112, lead112);
progState112.tilesPlacedCount = 5; // partie à 2 joueurs, on force la 5e tuile
progState112.finishLineTile = createFinishLineTile(6); // Finish Line déjà posée manuellement pour ce test

const blastWinner112 = createCar("Mayrik", CAR_SIZE.MEDIUM, 22, 3);
const cars112 = [blastWinner112];

const dmgResult112 = applyDamage(blastWinner112, {
  tokenType: TOKEN_TYPES.BLAST_OFF,
  tile: buildBoardFromProgressionState(progState112),
  allCars: cars112,
  progressionState: progState112,
  allChoppers: [],
  forcedDice: { blastOffDirection: "front", blastOffStunt: 3 } // 22+3=25, atteint tout juste la Finish Line (seuil=24)
});
dmgResult112.log.forEach((l) => console.log("  " + l));

const endCheck112 = checkGameEndConditions(progState112, cars112, [], ["Mayrik", "IA"]);
console.log("Partie terminée après le Blast Off (attendu true) :", endCheck112.gameOver);
console.log("Gagnant (attendu 'Mayrik') :", endCheck112.winner);

// -----------------------------------------------------------------
// TEST 113 : comportement SANS progressionState fourni — inchangé
// (rétrocompatibilité avec l'ancien comportement simplifié)
// -----------------------------------------------------------------
section("Test 113 — Blast Off sans progressionState : ancien comportement inchangé");

tile = createTestTile(8, 6);
tile.grid[3][6].terrain = TERRAIN.IMPASSABLE;
const blastCarNoProgress = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const cars113 = [blastCarNoProgress];

const dmgResult113 = applyDamage(blastCarNoProgress, {
  tokenType: TOKEN_TYPES.BLAST_OFF,
  tile,
  allCars: cars113,
  forcedDice: { blastOffDirection: "front", blastOffStunt: 3 }
});
dmgResult113.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'eliminated', comportement identique à avant) :", blastCarNoProgress.status);

// -----------------------------------------------------------------
// TEST 114 : instantiateTile() — convertit le format exporté par
// l'outil de tagging (hazard = booléen fixe d'éligibilité) vers le
// format utilisé en jeu (hazardSpace = booléen fixe, hazard = jeton
// dynamique, vide au départ). Tuile minimale écrite à la main, pas
// besoin de charger un vrai fichier tiles/data/ pour ce test.
// -----------------------------------------------------------------
const { instantiateTile, populateTileHazards } = require("./engine.js");

section("Test 114 — instantiateTile() : conversion du format outil vers le format moteur");

const rawTile114 = {
  id: "vendetta-99a",
  name: "test tile",
  format: "vendetta",
  extension: "base",
  cols: 2,
  rows: 1,
  grid: [
    [{ terrain: TERRAIN.ROAD, hazardSpace: true }, { terrain: TERRAIN.OFF_ROAD, hazardSpace: false }]
  ]
};
const instantiated114 = instantiateTile(rawTile114);

console.log("Métadonnées transmises (id/name) :", instantiated114.id, "|", instantiated114.name);
console.log("Terrain conservé case 0 (attendu 'road') :", instantiated114.grid[0][0].terrain);
console.log("hazardSpace case 0 (attendu true, marquée sur la vraie tuile) :", instantiated114.grid[0][0].hazardSpace);
console.log("hazardSpace case 1 (attendu false) :", instantiated114.grid[0][1].hazardSpace);
console.log("hazard (jeton actuel) des deux cases (attendu null, null — rien posé encore) :", instantiated114.grid[0][0].hazard, instantiated114.grid[0][1].hazard);

// -----------------------------------------------------------------
// TEST 115 : populateTileHazards() — pose un jeton sur chaque case
// hazardSpace=true, aucune sur les autres. Séquence forcée pour un
// résultat déterministe.
// -----------------------------------------------------------------
section("Test 115 — populateTileHazards() : pose les jetons sur les cases marquées uniquement");

const rawTile115 = {
  id: "vendetta-99b", name: "test tile 2", format: "vendetta", extension: "base",
  cols: 3, rows: 1,
  grid: [[
    { terrain: TERRAIN.ROAD, hazardSpace: true },
    { terrain: TERRAIN.ROAD, hazardSpace: false },
    { terrain: TERRAIN.ROAD, hazardSpace: true }
  ]]
};
const instantiated115 = instantiateTile(rawTile115);
populateTileHazards(instantiated115, [HAZARD_TYPES.MINE, HAZARD_TYPES.WRECK]);

console.log("Case 0 (hazardSpace=true, attendu 'mine') :", instantiated115.grid[0][0].hazard);
console.log("Case 1 (hazardSpace=false, attendu null) :", instantiated115.grid[0][1].hazard);
console.log("Case 2 (hazardSpace=true, attendu 'wreck') :", instantiated115.grid[0][2].hazard);

// -----------------------------------------------------------------
// TEST 116 : createTileProgressionState() pose désormais
// automatiquement les hazards sur les 3 tuiles de départ (mise en
// place physique du jeu) — sans rien casser sur des tuiles de test
// qui n'ont pas de case marquée (no-op silencieux).
// -----------------------------------------------------------------
section("Test 116 — createTileProgressionState() pose les hazards de départ sur les vraies tuiles");

const rearRaw116 = { id: "r116", name: "r", format: "vendetta", extension: "base", cols: 1, rows: 1, grid: [[{ terrain: TERRAIN.ROAD, hazardSpace: true }]] };
const middleRaw116 = { id: "m116", name: "m", format: "vendetta", extension: "base", cols: 1, rows: 1, grid: [[{ terrain: TERRAIN.ROAD, hazardSpace: false }]] };
const leadRaw116 = { id: "l116", name: "l", format: "vendetta", extension: "base", cols: 1, rows: 1, grid: [[{ terrain: TERRAIN.ROAD, hazardSpace: true }]] };

const rear116 = instantiateTile(rearRaw116);
const middle116 = instantiateTile(middleRaw116);
const lead116 = instantiateTile(leadRaw116);

createTileProgressionState(rear116, middle116, lead116, [], {
  forcedRearHazards: [HAZARD_TYPES.DIRT],
  forcedLeadHazards: [HAZARD_TYPES.BLANK]
});

console.log("Rear (hazardSpace=true, attendu 'dirt') :", rear116.grid[0][0].hazard);
console.log("Middle (hazardSpace=false, attendu null, jamais marquée) :", middle116.grid[0][0].hazard);
console.log("Lead (hazardSpace=true, attendu 'blank') :", lead116.grid[0][0].hazard);

// Tuiles de test classiques (createTestTile) : aucun marquage, donc
// aucun effet — vérifie l'absence de régression sur l'ancien chemin.
const rearTest116 = createTestTile(8, 6);
const middleTest116 = createTestTile(8, 6);
const leadTest116 = createTestTile(8, 6);
createTileProgressionState(rearTest116, middleTest116, leadTest116);
console.log("Tuile de test (createTestTile) inchangée (attendu null) :", rearTest116.grid[0][0].hazard);

// -----------------------------------------------------------------
// TEST 117 : advanceBoardOnFrontExit() pose désormais les hazards sur
// la nouvelle tuile lead piochée (p.11, étape 7 — jusqu'ici
// documentée mais jamais codée).
// -----------------------------------------------------------------
section("Test 117 — advanceBoardOnFrontExit() : hazards posés sur la nouvelle tuile lead");

const rear117 = createTestTile(8, 6);
const middle117 = createTestTile(8, 6);
const lead117 = createTestTile(8, 6);
let progState117 = createTileProgressionState(rear117, middle117, lead117);

const nextLeadRaw117 = { id: "n117", name: "n", format: "vendetta", extension: "base", cols: 8, rows: 6, grid: [] };
for (let r = 0; r < 6; r++) {
  const row = [];
  for (let c = 0; c < 8; c++) row.push({ terrain: TERRAIN.ROAD, hazardSpace: c === 2 }); // 1 seule case marquée par rangée, colonne 2
  nextLeadRaw117.grid.push(row);
}
const nextLead117 = instantiateTile(nextLeadRaw117);

const advanceCar117 = createCar("Mayrik", CAR_SIZE.MEDIUM, 23, 3);
const advanceResult117 = advanceBoardOnFrontExit(progState117, [advanceCar117], [], {
  forcedNextTile: nextLead117,
  forcedLeadHazards: [HAZARD_TYPES.MINE]
});
advanceResult117.log.forEach((l) => console.log("  " + l));

console.log("Case marquée (row 0, col 2) de la nouvelle lead (attendu 'mine') :", progState117.leadTile.grid[0][2].hazard);
console.log("Case NON marquée (row 0, col 0) de la nouvelle lead (attendu null) :", progState117.leadTile.grid[0][0].hazard);
console.log("Message de log ne dit plus 'pas encore modélisé' (attendu true) :", advanceResult117.log.some((l) => l.includes("hazards placés")));

// -----------------------------------------------------------------
// TESTS 118-121 : setupTileProgressionFromRawData() — pièce reliant
// les vraies données de tuile (fichiers tiles/data/*.js) à un vrai
// tirage aléatoire de partie. Jeu de données factice pour ces tests :
// 5 numéros (01-05), 2 faces chacun (a/b), grilles minimales 1x1 —
// seuls id/format/extension/grid comptent ici, pas le contenu réel.
// -----------------------------------------------------------------
const { groupTilesByNumber, setupTileProgressionFromRawData } = require("./engine.js");

function makeFakeRawTile(number, face, hazardSpace) {
  return {
    id: `vendetta-${number}${face}`,
    name: `tuile ${number}${face}`,
    format: "vendetta",
    extension: face === "b" ? "ext1" : "base", // mélange volontaire pour tester le filtre par extension
    cols: 1,
    rows: 1,
    grid: [[{ terrain: TERRAIN.ROAD, hazardSpace }]]
  };
}

const fakeTiles118 = [];
for (const n of ["01", "02", "03", "04", "05"]) {
  fakeTiles118.push(makeFakeRawTile(n, "a", n === "02")); // seule 02a a une case hazard, pour un test plus loin
  fakeTiles118.push(makeFakeRawTile(n, "b", false));
}

section("Test 118 — groupTilesByNumber() : regroupement par numéro physique + détection d'incomplétude");

const grouped118 = groupTilesByNumber(fakeTiles118);
console.log("5 numéros regroupés (attendu true) :", Object.keys(grouped118.byNumber).length === 5);
console.log("Numéro 01 a bien ses 2 faces (attendu true) :", !!grouped118.byNumber["01"].a && !!grouped118.byNumber["01"].b);

const incompleteTiles118 = [makeFakeRawTile("09", "a", false)]; // face b manquante
const grouped118b = groupTilesByNumber(incompleteTiles118);
console.log("Numéro incomplet exclu (attendu 0 numéro retenu) :", Object.keys(grouped118b.byNumber).length);
console.log("Log signale l'incomplétude (attendu true) :", grouped118b.log.some((l) => l.includes("incomplète")));

section("Test 119 — setupTileProgressionFromRawData() : tirage entièrement forcé, déterministe");

const setup119 = setupTileProgressionFromRawData(fakeTiles118, {
  forcedFaces: { "01": "a", "03": "b", "04": "a", "05": "b" },
  forcedDrawOrder: ["03", "04", "05"] // middle=03, lead=04, pioche=[05]
});
console.log("Résultat ok (attendu true) :", setup119.ok);
console.log("Rear = numéro de départ 01, face a (attendu 'vendetta-01a') :", setup119.rearTile.id);
console.log("Middle = 03, face forcée b (attendu 'vendetta-03b') :", setup119.middleTile.id);
console.log("Lead = 04, face forcée a (attendu 'vendetta-04a') :", setup119.leadTile.id);
console.log("Pioche = 1 tuile restante, numéro 05 (attendu 'vendetta-05b') :", setup119.drawPile.length, setup119.drawPile[0].id);
console.log("Numéro 02 n'apparaît nulle part (jamais tiré, attendu true) :", ![setup119.rearTile, setup119.middleTile, setup119.leadTile, ...setup119.drawPile].some((t) => t.id.startsWith("vendetta-02")));

section("Test 120 — setupTileProgressionFromRawData() : hazards PAS encore posés (rôle de createTileProgressionState ensuite)");

console.log("hazardSpace présent sur rear mais hazard (jeton) encore vide (attendu true, null) :", setup119.rearTile.grid[0][0].hazardSpace !== undefined, setup119.rearTile.grid[0][0].hazard);

section("Test 121 — Pipeline complet : données brutes → setup → createTileProgressionState → hazards réels posés");

const setup121 = setupTileProgressionFromRawData(fakeTiles118, {
  forcedFaces: { "01": "b", "02": "a" }, // rear=01b (pas de hazard), middle ou lead pourrait tomber sur 02a (a un hazardSpace)
  forcedDrawOrder: ["02", "03", "04", "05"]
});
let progState121 = createTileProgressionState(setup121.rearTile, setup121.middleTile, setup121.leadTile, setup121.drawPile, {
  forcedMiddleHazards: [HAZARD_TYPES.MINE]
});
console.log("Middle = 02a (celle avec hazardSpace) (attendu 'vendetta-02a') :", progState121.middleTile.id);
console.log("Hazard posé sur la case marquée de 02a (attendu 'mine') :", progState121.middleTile.grid[0][0].hazard);

section("Test 122 — setupTileProgressionFromRawData() : tuile de départ introuvable → échec propre");

const setup122 = setupTileProgressionFromRawData(fakeTiles118, { startingTileNumber: "99" });
console.log("ok (attendu false) :", setup122.ok);
console.log("reason présente (attendu true) :", typeof setup122.reason === "string" && setup122.reason.length > 0);

section("Test 123 — setupTileProgressionFromRawData() : filtrage par extension (allowedExtensions)");

// Dans le jeu factice, toutes les faces 'a' sont extension 'base', toutes les 'b' sont 'ext1'.
// En limitant à 'base' seulement, plus aucune tuile numéro n'a ses 2 faces (b manquante) SAUF
// qu'on ne demande qu'une face par numéro au tirage — donc le regroupement doit échouer partout
// puisque chaque numéro perd sa face b et devient incomplet.
const setup123 = setupTileProgressionFromRawData(fakeTiles118, { allowedExtensions: ["base"] });
console.log("Échec attendu (toutes les tuiles perdent leur face b, donc incomplètes) — ok :", setup123.ok);
console.log("Log mentionne bien des tuiles incomplètes (attendu true) :", setup123.log.some((l) => l.includes("incomplète")));

// -----------------------------------------------------------------
// TESTS 124-125 : question posée par Mayrik sur la robustesse du
// tirage — 1) une tuile ne peut jamais être présente deux fois en
// même temps sur le plateau (A+B, ou toute répétition), 2) une tuile
// défaussée revient neuve (pas avec le terrain/jetons de son passage
// précédent), et pas "en avance" sur les tuiles jamais encore vues.
// -----------------------------------------------------------------
section("Test 124 — Aucun numéro de tuile en double sur le plateau, même après plusieurs cycles de pioche");

const fakeCycleTiles = [];
for (const n of ["01", "02", "03", "04", "05"]) {
  fakeCycleTiles.push(makeFakeRawTile(n, "a", false));
  fakeCycleTiles.push(makeFakeRawTile(n, "b", false));
}
const setup124 = setupTileProgressionFromRawData(fakeCycleTiles, {
  forcedFaces: { "01": "a" },
  forcedDrawOrder: ["02", "03", "04", "05"]
});
let progState124 = createTileProgressionState(setup124.rearTile, setup124.middleTile, setup124.leadTile, setup124.drawPile);
const cycleCar124 = createCar("Test", CAR_SIZE.MEDIUM, progState124.rearTile.cols - 1, 0);

let duplicateFound = false;
const extractNumber = (t) => t.id.match(/(\d+)[ab]$/)[1];
for (let i = 0; i < 12; i++) {
  advanceBoardOnFrontExit(progState124, [cycleCar124], []);
  const nums = [extractNumber(progState124.rearTile), extractNumber(progState124.middleTile), extractNumber(progState124.leadTile)];
  if (new Set(nums).size !== 3) duplicateFound = true;
}
console.log("Doublon détecté sur 12 cycles (attendu false) :", duplicateFound);

section("Test 125 — Une tuile défaussée puis repiochée revient dans son état d'origine (pas mutée)");

const setup125 = setupTileProgressionFromRawData(fakeCycleTiles, {
  forcedFaces: { "01": "a" },
  forcedDrawOrder: ["02", "03", "04", "05"]
});
let progState125 = createTileProgressionState(setup125.rearTile, setup125.middleTile, setup125.leadTile, setup125.drawPile);
const originalStartingTile = progState125.rearTile;
originalStartingTile.grid[0][0].terrain = TERRAIN.MUD; // simule un hazard Dirt résolu en tout début de partie

const cycleCar125 = createCar("Test", CAR_SIZE.MEDIUM, progState125.rearTile.cols - 1, 0);
// La face du recyclage est désormais tirée au hasard à chaque
// défausse (voir Test 126) — sans intérêt pour CE test, qui porte sur
// la remise à neuf de l'état, pas sur la face. On la force donc sur
// le tout 1er décalage (celui qui défausse justement la tuile 01) pour
// garder une assertion déterministe sur son identifiant.
advanceBoardOnFrontExit(progState125, [cycleCar125], [], { forcedDiscardFace: "a" });
for (let i = 0; i < 2; i++) advanceBoardOnFrontExit(progState125, [cycleCar125], []); // 2 cycles de plus = la tuile de départ redevient lead

console.log("La tuile de départ (numéro 01) est bien redevenue lead (attendu 'vendetta-01a') :", progState125.leadTile.id);
console.log("Ce n'est PLUS le même objet (attendu false, réinstanciée) :", progState125.leadTile === originalStartingTile);
console.log("Terrain remis à neuf (attendu 'road', PAS 'mud') :", progState125.leadTile.grid[0][0].terrain);

section("Test 126 — Recyclage depuis la défausse : la face se retire au hasard, pas figée sur celle d'origine");

const setup126 = setupTileProgressionFromRawData(fakeCycleTiles, {
  forcedFaces: { "01": "a" },
  forcedDrawOrder: ["02", "03", "04", "05"]
});
let progState126 = createTileProgressionState(setup126.rearTile, setup126.middleTile, setup126.leadTile, setup126.drawPile);
const cycleCar126 = createCar("Test", CAR_SIZE.MEDIUM, progState126.rearTile.cols - 1, 0);

// La tuile de départ (numéro 01, face 'a') est en rear dès le début —
// donc le tout 1er décalage la défausse. On force cette fois-là sa
// face à 'b' (différente de son 'a' d'origine) pour prouver que le
// recyclage peut bien tirer une autre face, pas seulement par hasard.
advanceBoardOnFrontExit(progState126, [cycleCar126], [], { forcedDiscardFace: "b" });
console.log("Dernière entrée de la pioche = numéro 01, face forcée 'b' bien que tirée en 'a' au départ (attendu 'vendetta-01b') :", progState126.drawPile[progState126.drawPile.length - 1].id);

// -----------------------------------------------------------------
// TESTS 127-130 : simulation en auto-jeu — bot minimal aléatoire qui
// fait vraiment tourner le moteur de bout en bout (test d'intégration
// + base de la future IA). Découverte pendant l'écriture de ces
// tests : movedThisRound/coastCount n'étaient JAMAIS remis à zéro en
// fin de round (bug corrigé dans advanceTurn — voir son code source),
// jamais détecté par un test unitaire car aucun ne traversait une
// frontière de round en le vérifiant. Exactement le genre de bug
// qu'un test d'intégration est censé attraper.
// -----------------------------------------------------------------
const { rollMovementDie, pickRandomForwardPath, playOneRandomTurn, simulateRandomGame } = require("./engine.js");

section("Test 127 — rollMovementDie() et pickRandomForwardPath() : bases du bot");

console.log("Dé forcé respecté (attendu 4) :", rollMovementDie(4));
const forcedPath127 = pickRandomForwardPath(3, ["front", "front-left", "front"]);
console.log("Chemin forcé respecté (attendu 3 éléments identiques à l'entrée) :", forcedPath127.join(","));
const randomPath127 = pickRandomForwardPath(4);
console.log("Chemin aléatoire a la bonne longueur (attendu 4) :", randomPath127.length);
console.log("Chemin aléatoire ne contient que des directions avant (attendu true) :", randomPath127.every((d) => ["front", "front-left", "front-right"].includes(d)));

section("Test 128 — movedThisRound et coastCount sont bien remis à zéro à chaque nouveau round");

let roundState128 = createRoundState(["Alice", "Bob"]);
const car128 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const otherCar128 = createCar("Bob", CAR_SIZE.MEDIUM, 0, 4);
const cars128 = [car128, otherCar128];
car128.movedThisRound = true;
car128.coastCount = 2;
for (let i = 0; i < 6; i++) advanceTurn(roundState128, cars128); // termine le round 1 (3 tours × 2 joueurs)
console.log("Round bien passé à 2 (attendu 2) :", roundState128.roundNumber);
console.log("movedThisRound remis à false pour le nouveau round (attendu false) :", car128.movedThisRound);
console.log("coastCount remis à 0 pour le nouveau round (attendu 0) :", car128.coastCount);

section("Test 129 — playOneRandomTurn() : joue un tour complet du joueur courant, fait avancer la rotation");

const rawTiles129 = [];
for (const n of ["01", "02", "03"]) {
  rawTiles129.push({ id: `vendetta-${n}a`, name: `t${n}a`, format: "vendetta", extension: "base", cols: 8, rows: 6, grid: Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => ({ terrain: TERRAIN.ROAD, hazardSpace: false }))) });
  rawTiles129.push({ id: `vendetta-${n}b`, name: `t${n}b`, format: "vendetta", extension: "base", cols: 8, rows: 6, grid: Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => ({ terrain: TERRAIN.ROAD, hazardSpace: false }))) });
}
const setup129 = setupTileProgressionFromRawData(rawTiles129);
let progState129 = createTileProgressionState(setup129.rearTile, setup129.middleTile, setup129.leadTile, setup129.drawPile);
let roundState129 = createRoundState(["Alice", "Bob"]);
const carAlice129 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const carBob129 = createCar("Bob", CAR_SIZE.MEDIUM, 0, 4);
const cars129 = [carAlice129, carBob129];

const turn129 = playOneRandomTurn(progState129, roundState129, cars129, [], ["Alice", "Bob"], { forcedDieValue: 3, forcedPath: ["front", "front", "front"] });
turn129.log.forEach((l) => console.log("  " + l));
console.log("Résultat ok (attendu true) :", turn129.ok);
console.log("La voiture d'Alice a bien avancé de 3 (attendu col 3) :", carAlice129.col);
console.log("Tour bien comptabilisé pour Alice (attendu 1) :", roundState129.turnsThisRound["Alice"]);
console.log("C'est maintenant au tour de Bob (attendu 'Bob') :", getCurrentPlayer(roundState129));

section("Test 130 — simulateRandomGame() : une partie complète en auto-jeu se termine sans erreur ni blocage");

const rawTiles130 = [];
for (const n of ["01", "02", "03", "04", "05"]) {
  for (const face of ["a", "b"]) {
    rawTiles130.push({ id: `vendetta-${n}${face}`, name: `t${n}${face}`, format: "vendetta", extension: "base", cols: 8, rows: 6, grid: Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => ({ terrain: TERRAIN.ROAD, hazardSpace: false }))) });
  }
}
const setup130 = setupTileProgressionFromRawData(rawTiles130);
let progState130 = createTileProgressionState(setup130.rearTile, setup130.middleTile, setup130.leadTile, setup130.drawPile);
let roundState130 = createRoundState(["Alice", "Bob"]);
const cars130 = [createCar("Alice", CAR_SIZE.MEDIUM, 0, 3), createCar("Bob", CAR_SIZE.MEDIUM, 0, 4)];

const sim130 = simulateRandomGame(progState130, roundState130, cars130, [], ["Alice", "Bob"]);
console.log("Partie terminée normalement (attendu true) :", sim130.completed);
console.log("Plafond de sécurité PAS atteint (attendu false) :", sim130.safetyCapHit);
console.log("Un gagnant a bien été désigné (attendu true) :", !!sim130.winner);
console.log("Une raison de victoire est bien renseignée (attendu true) :", !!sim130.reason);
console.log("Nombre de tours joués (informatif) :", sim130.turns);

// -----------------------------------------------------------------
// TESTS 131-138 : IA — MOVE (chooseAiMoveTrajectory), traduction
// fidèle de l'arbre logique fourni par Mayrik ("TRV initiative IA").
// Chaque test construit une tuile minimale forçant précisément UN
// palier à s'activer, pour vérifier que la cascade des 7 paliers sûrs
// + le repli fonctionne exactement comme documenté.
// -----------------------------------------------------------------
const { chooseAiMoveTrajectory, computeAiStepCost, isAiHiddenHazard } = require("./engine.js");

section("Test 131 — Palier 1 (Route pure, sans hazard, sans finir au bord) : cas simple, tout est route");

const board131 = createTestTile(8, 6);
const car131 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const path131 = chooseAiMoveTrajectory(board131, car131, 2, [car131]);
console.log("Longueur du chemin (attendu 2) :", path131.length);
console.log("Toutes les directions sont avant (attendu true) :", path131.every((d) => ["front", "front-left", "front-right"].includes(d)));
const moveCheck131 = moveCar(board131, car131, 2, path131, [car131]);
console.log("Le chemin choisi par l'IA s'exécute bien via moveCar (attendu ok:true) :", moveCheck131.ok);

section("Test 132 — Palier 1 refusé (finirait au bord), Palier 2 accepté");

const board132 = createTestTile(8, 6);
board132.grid[1][1].terrain = TERRAIN.OFF_ROAD; // "front" (row1) exclu du tout-Route
board132.grid[2][1].terrain = TERRAIN.OFF_ROAD; // "front-right" (row2) exclu aussi
// seule "front-left" (row0, bord latéral) reste en Route pure
const car132 = createCar("IA", CAR_SIZE.MEDIUM, 0, 1);
const path132 = chooseAiMoveTrajectory(board132, car132, 1, [car132]);
console.log("Chemin trouvé malgré l'arrivée au bord (attendu ['front-left']) :", path132.join(","));

section("Test 133 — Paliers 1-2 refusés (hazard caché sur la seule route disponible), Palier 3 accepté");

const board133 = createTestTile(8, 6);
board133.grid[3][1].hazard = HAZARD_TYPES.MINE; // "front" reste Route mais a un hazard caché
board133.grid[2][1].terrain = TERRAIN.OFF_ROAD; // "front-right" exclu du tout-Route
board133.grid[4][1].terrain = TERRAIN.OFF_ROAD; // "front-left" exclu aussi
const car133 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const path133 = chooseAiMoveTrajectory(board133, car133, 1, [car133]);
console.log("Chemin trouvé malgré le hazard cité (attendu ['front']) :", path133.join(","));

section("Test 134 — Paliers 1-3 refusés (aucune route disponible), Palier 4 accepté (Route+Hors-piste)");

const board134 = createTestTile(8, 6);
board134.grid[2][1].terrain = TERRAIN.OFF_ROAD;
board134.grid[3][1].terrain = TERRAIN.OFF_ROAD;
board134.grid[4][1].terrain = TERRAIN.OFF_ROAD;
const car134 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const path134 = chooseAiMoveTrajectory(board134, car134, 1, [car134]);
console.log("Chemin trouvé en hors-piste (attendu 1 direction) :", path134.length);

section("Test 135 — Paliers 1-5 refusés (aucune route/hors-piste), Palier 6 accepté (+Boue), coût de boue respecté");

const board135 = createTestTile(8, 6);
board135.grid[2][1].terrain = TERRAIN.MUD;
board135.grid[3][1].terrain = TERRAIN.MUD;
board135.grid[4][1].terrain = TERRAIN.MUD;
const car135 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const path135 = chooseAiMoveTrajectory(board135, car135, 2, [car135]); // 2 points = coûte exactement 1 case de boue
console.log("Chemin trouvé via la boue (attendu 1 direction, coûte 2) :", path135.length);
console.log("computeAiStepCost boue avec 2 restants (attendu 2) :", computeAiStepCost(TERRAIN.MUD, 2));

section("Test 136 — Exception boue au dernier point (p.7) : coûte 1 au lieu de 2 si un seul point restant");

console.log("computeAiStepCost boue avec 1 seul restant (attendu 1, exception) :", computeAiStepCost(TERRAIN.MUD, 1));
const board136 = createTestTile(8, 6);
board136.grid[3][1].terrain = TERRAIN.MUD; // "front" (row reste 3)
board136.grid[2][1].terrain = TERRAIN.IMPASSABLE; // "front-left" (row2) exclu de tous les paliers, jamais choisi
board136.grid[4][1].terrain = TERRAIN.IMPASSABLE; // "front-right" (row4) exclu aussi
const car136 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const path136 = chooseAiMoveTrajectory(board136, car136, 1, [car136]); // 1 seul point : la boue ne serait normalement pas abordable
console.log("Chemin trouvé malgré 1 seul point (exception boue, attendu ['front']) :", path136.join(","));

section("Test 137 — Aucun palier sûr : repli (Palier 8), avance le plus loin possible puis accepte le SLAM");

const board137 = createTestTile(8, 1); // 1 seule rangée : front-left/front-right toujours hors tuile, aucune esquive possible
const blockerCar137 = createCar("Adversaire", CAR_SIZE.SMALL, 2, 0);
const car137 = createCar("IA", CAR_SIZE.MEDIUM, 0, 0);
const allCars137 = [car137, blockerCar137];
const path137 = chooseAiMoveTrajectory(board137, car137, 4, allCars137);
console.log("Chemin de repli trouvé (attendu ['front','front'], avance jusqu'au blocage) :", path137.join(","));
const moveCheck137 = moveCar(board137, car137, 4, path137, allCars137);
console.log("Le chemin de repli déclenche bien un SLAM à l'exécution (attendu présence de slam) :", !!moveCheck137.slam);

section("Test 138 — Le repli ne choisit jamais une case Impassable, même bloqué de partout ailleurs");

const board138 = createTestTile(8, 6);
board138.grid[3][1].terrain = TERRAIN.IMPASSABLE; // "front" (row reste 3) — dangereux, jamais choisi
const blockerA138 = createCar("A", CAR_SIZE.SMALL, 1, 2); // "front-left" (row2) occupé
const blockerB138 = createCar("B", CAR_SIZE.SMALL, 1, 4); // "front-right" (row4) occupé
const car138 = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const allCars138 = [car138, blockerA138, blockerB138];
const path138 = chooseAiMoveTrajectory(board138, car138, 3, allCars138);
console.log("Chemin de repli choisi (attendu ['front-left'], jamais 'front' Impassable) :", path138.join(","));
console.log("N'a jamais choisi 'front' (Impassable) (attendu true) :", !path138.includes("front"));

section("Test 138bis — Entre plusieurs trajectoires valides à distance égale, préférence à celle permettant de tirer sur un adversaire (précision ajoutée par Mayrik)");

const { DIRECTIONS, getFrontArc } = require("./engine.js");

const board138bis = createTestTile(8, 6);
const car138bis = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const enemy138bis = createCar("Adversaire", CAR_SIZE.SMALL, 2, 1); // corrigé pour la géométrie chevron réelle : dans l'arc avant d'une arrivée en (2,2) seulement (rangée paire → diagonales à colonne identique) — PAS en (2,3), la 1ère trajectoire explorée par la recherche brute ("front,front")
const allCars138bis = [car138bis, enemy138bis];
const path138bis = chooseAiMoveTrajectory(board138bis, car138bis, 2, allCars138bis);

let finalCol = car138bis.col, finalRow = car138bis.row;
for (const dir of path138bis) {
  finalCol += DIRECTIONS[dir].dCol;
  finalRow += DIRECTIONS[dir].dRow;
}
const finalArc = getFrontArc({ col: finalCol, row: finalRow });
const enemyInArc = finalArc.some((a) => a.col === enemy138bis.col && a.row === enemy138bis.row);
console.log("Chemin choisi (attendu de finir en position permettant le tir) :", path138bis.join(","), "-> arrivée (", finalCol, finalRow, ")");
console.log("L'adversaire est bien dans l'arc avant d'arrivée (attendu true) :", enemyInArc);

section("Test 138ter — Sans option de tir, préférence à une trajectoire qui déclenche un SLAM sur un adversaire (précision ajoutée par Mayrik)");

const board138ter = createTestTile(8, 6);
const car138ter = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const enemy138ter = createCar("Adversaire", CAR_SIZE.SMALL, 1, 1); // corrigé pour la géométrie chevron réelle : atteignable uniquement via SLAM (front-left,front-left) ; aucune case d'arrivée alternative à distance égale ne le rend tirable, ce qui isole vraiment la préférence SLAM
const allCars138ter = [car138ter, enemy138ter];
const path138ter = chooseAiMoveTrajectory(board138ter, car138ter, 2, allCars138ter);
console.log("Chemin choisi (attendu ['front-left','front-left'], fonce sur l'adversaire) :", path138ter.join(","));
const moveCheck138ter = moveCar(board138ter, car138ter, 2, path138ter, allCars138ter);
console.log("Un SLAM se déclenche bien à l'exécution (attendu présence de slam) :", !!moveCheck138ter.slam);

section("Test 138quater — Slam jamais choisi contre sa PROPRE équipe (uniquement un adversaire)");

const board138quater = createTestTile(8, 6);
const car138quater = createCar("IA", CAR_SIZE.MEDIUM, 0, 3);
const ally138quater = createCar("IA", CAR_SIZE.SMALL, 2, 3); // même propriétaire, à la même distance
const allCars138quater = [car138quater, ally138quater];
const path138quater = chooseAiMoveTrajectory(board138quater, car138quater, 2, allCars138quater);
console.log("Chemin choisi SANS foncer sur sa propre voiture (attendu PAS ['front','front']) :", path138quater.join(","), "!==", "front,front");
console.log("N'est pas égal à front,front (attendu true) :", path138quater.join(",") !== "front,front");

// -----------------------------------------------------------------
// TESTS 139-145 : IA — SHOOT (chooseAiShootTarget), traduction
// fidèle de la logique de ciblage du document "TRV initiative IA".
// -----------------------------------------------------------------
const { chooseAiShootTarget } = require("./engine.js");

section("Test 139 — Aucun adversaire dans l'arc avant : pas de cible");

const shooter139 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const ally139 = createCar("IA", CAR_SIZE.SMALL, 4, 3); // même camp, dans l'arc mais jamais candidat
const target139 = chooseAiShootTarget(shooter139, [shooter139, ally139]);
console.log("Aucune cible retenue (attendu null) :", target139);

section("Test 140 — Un seul adversaire dans l'arc : ciblé directement");

const shooter140 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const enemy140 = createCar("Adversaire", CAR_SIZE.SMALL, 4, 3); // "front"
const target140 = chooseAiShootTarget(shooter140, [shooter140, enemy140]);
console.log("Cible unique choisie (attendu enemy140) :", target140 === enemy140);

section("Test 141 — Plusieurs adversaires, tailles différentes : le plus gros l'emporte (L>M>S)");

const shooter141 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const small141 = createCar("Adversaire", CAR_SIZE.SMALL, 4, 2); // front-left
const large141 = createCar("Adversaire", CAR_SIZE.LARGE, 4, 3); // front
const medium141 = createCar("Adversaire", CAR_SIZE.MEDIUM, 4, 4); // front-right
const target141 = chooseAiShootTarget(shooter141, [shooter141, small141, large141, medium141]);
console.log("Le plus gros véhicule est choisi (attendu large141) :", target141 === large141);

section("Test 142 — Même taille, joueurs différents : priorité au joueur ayant le plus de véhicules en jeu");

const shooter142 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const enemyA142 = createCar("A", CAR_SIZE.SMALL, 4, 2); // A n'a qu'1 véhicule
const enemyB142 = createCar("B", CAR_SIZE.SMALL, 4, 4); // B en a 2
const otherB142 = createCar("B", CAR_SIZE.SMALL, 0, 0); // 2e véhicule de B, ailleurs sur le plateau
const target142 = chooseAiShootTarget(shooter142, [shooter142, enemyA142, enemyB142, otherB142]);
console.log("Le véhicule du joueur B (plus de véhicules en jeu) est choisi (attendu enemyB142) :", target142 === enemyB142);

section("Test 143 — Même taille, mêmes effectifs : départage par le véhicule le plus en avant de chaque joueur");

const shooter143 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const enemyA143 = createCar("A", CAR_SIZE.SMALL, 4, 2);
const otherA143 = createCar("A", CAR_SIZE.SMALL, 5, 0); // le véhicule le plus en avant de A
const enemyB143 = createCar("B", CAR_SIZE.SMALL, 4, 4);
const otherB143 = createCar("B", CAR_SIZE.SMALL, 2, 0); // moins en avant que celui de A
const target143 = chooseAiShootTarget(shooter143, [shooter143, enemyA143, otherA143, enemyB143, otherB143]);
console.log("Le véhicule du joueur A (le plus en avant) est choisi (attendu enemyA143) :", target143 === enemyA143);

section("Test 144 — Un véhicule éliminé dans l'arc n'est jamais une cible, et ne compte pas dans les effectifs");

const shooter144 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const eliminated144 = createCar("Adversaire", CAR_SIZE.SMALL, 4, 3);
eliminated144.status = CAR_STATUS.ELIMINATED;
const target144 = chooseAiShootTarget(shooter144, [shooter144, eliminated144]);
console.log("Aucune cible (le seul véhicule dans l'arc est éliminé) (attendu null) :", target144);

section("Test 145 — Un chopper dans l'arc n'est jamais une cible (règle p.10 déjà en place)");

const shooter145 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const chopper145 = createChopper("Adversaire");
chopper145.col = 4;
chopper145.row = 3;
chopper145.placed = true;
const enemy145 = createCar("Adversaire", CAR_SIZE.SMALL, 4, 2); // seule vraie cible valide
const target145 = chooseAiShootTarget(shooter145, [shooter145, chopper145, enemy145]);
console.log("Le chopper n'est jamais choisi, seul enemy145 l'est (attendu true) :", target145 === enemy145);

// -----------------------------------------------------------------
// TESTS 146-150 : pool de 4 dés par joueur par round (précision de
// règle obtenue de Mayrik en construisant l'IA — Command). Chaque
// joueur lance ses 4 dés en bloc au début du round, jamais relancés
// individuellement ensuite ; 3 vont normalement aux 3 tours du round,
// le 4e est disponible pour une seule Command.
// -----------------------------------------------------------------
const { rollDicePool, drawHighestDieFromPool, drawSpecificDieFromPool } = require("./engine.js");

section("Test 146 — rollDicePool() : 4 dés par joueur, valeurs forçables en test");

const pool146 = rollDicePool(["Alice", "Bob"], { Alice: [3, 6, 1, 4] });
console.log("Pool forcé d'Alice respecté (attendu 3,6,1,4) :", pool146["Alice"].join(","));
console.log("Pool aléatoire de Bob a bien 4 dés (attendu 4) :", pool146["Bob"].length);
console.log("Toutes les valeurs de Bob sont entre 1 et 6 (attendu true) :", pool146["Bob"].every((v) => v >= 1 && v <= 6));

section("Test 147 — drawHighestDieFromPool() : retire bien le plus fort, laisse les autres");

const pool147 = { Alice: [3, 6, 1, 4] };
const drawn147 = drawHighestDieFromPool(pool147, "Alice");
console.log("Dé le plus fort retiré (attendu 6) :", drawn147);
console.log("Pool restant (attendu 3,1,4) :", pool147["Alice"].join(","));

section("Test 148 — drawSpecificDieFromPool() : retire une valeur précise, ou échoue proprement si absente");

const pool148 = { Alice: [3, 6, 1, 4] };
const drawn148 = drawSpecificDieFromPool(pool148, "Alice", 6);
console.log("Le 6 exact a été retiré (attendu 6) :", drawn148);
console.log("Pool restant (attendu 3,1,4) :", pool148["Alice"].join(","));
const drawnMissing148 = drawSpecificDieFromPool(pool148, "Alice", 6); // déjà retiré
console.log("2e tentative sur une valeur absente (attendu null) :", drawnMissing148);

section("Test 149 — createRoundState() : pool de 4 dés initialisé par joueur, commandUsedThisRound à false");

let roundState149 = createRoundState(["Alice", "Bob"], { Alice: [1, 2, 3, 4], Bob: [5, 5, 6, 6] });
console.log("Pool d'Alice présent (attendu 4 dés) :", roundState149.dicePool["Alice"].length);
console.log("commandUsedThisRound initialisé à false pour les deux (attendu false,false) :", roundState149.commandUsedThisRound["Alice"], roundState149.commandUsedThisRound["Bob"]);

section("Test 150 — advanceTurn() : nouveau pool de 4 dés relancé à chaque nouveau round, commandUsedThisRound remis à zéro");

let roundState150 = createRoundState(["Alice", "Bob"], { Alice: [1, 1, 1, 1], Bob: [2, 2, 2, 2] });
roundState150.commandUsedThisRound["Alice"] = true; // simule une Command utilisée ce round
const carA150 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const carB150 = createCar("Bob", CAR_SIZE.MEDIUM, 0, 4);
const cars150 = [carA150, carB150];
for (let i = 0; i < 6; i++) advanceTurn(roundState150, cars150); // termine le round 1
console.log("Round bien passé à 2 (attendu 2) :", roundState150.roundNumber);
console.log("Nouveau pool présent pour Alice (attendu 4 dés, plus le pool figé [1,1,1,1] initial) :", roundState150.dicePool["Alice"].length, roundState150.dicePool["Alice"].join(",") !== "1,1,1,1");
console.log("commandUsedThisRound remis à false pour le nouveau round (attendu false) :", roundState150.commandUsedThisRound["Alice"]);

// -----------------------------------------------------------------
// TESTS 151-158 : IA — COMMAND (chooseAiCommand), traduction fidèle
// de la cascade de décision du document "TRV initiative IA",
// recoupée avec le rulebook officiel (Command décidée dans le même
// tour que l'Assign normal, jamais pendant un Coast).
// -----------------------------------------------------------------
const { chooseAiCommand, findAiAirstrikePlacement } = require("./engine.js");

function makeRoundStateForCommand(playerNames, dicePool, commandUsed = {}, roundNumber = 2) {
  const rs = createRoundState(playerNames, {});
  rs.dicePool = dicePool;
  rs.commandUsedThisRound = Object.fromEntries(playerNames.map((p) => [p, commandUsed[p] || false]));
  rs.roundNumber = roundNumber; // par défaut round 2 : ces tests portent sur la logique de Command elle-même, pas sur la restriction round 1 (testée séparément, voir Test 153bis)
  return rs;
}

section("Test 151 — Aucune commande si déjà utilisée ce round");

const board151 = createTestTile(8, 6);
const car151 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const rs151 = makeRoundStateForCommand(["Alice"], { Alice: [4, 5, 6] }, { Alice: true });
const cmd151 = chooseAiCommand(board151, car151, [car151], [], rs151.dicePool, "Alice", rs151);
console.log("Aucune commande (attendu null) :", cmd151);

section("Test 152 — Aucune commande possible pendant un Coast");

const board152 = createTestTile(8, 6);
const car152 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
car152.movedThisRound = true; // ce tour serait un Coast
const rs152 = makeRoundStateForCommand(["Alice"], { Alice: [4, 5, 6] });
const cmd152 = chooseAiCommand(board152, car152, [car152], [], rs152.dicePool, "Alice", rs152);
console.log("Aucune commande pendant un Coast (attendu null) :", cmd152);

section("Test 153 — Adversaire proche de sortir : Airstrike avec le dé le plus faible, bonne cible, bon placement");

const board153 = createTestTile(8, 6); // 8 colonnes
const car153 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const enemy153 = createCar("Bob", CAR_SIZE.MEDIUM, 5, 3); // 5 + son dé le plus fort (3) = 8 = board.cols : menace
const rs153 = makeRoundStateForCommand(["Alice", "Bob"], { Alice: [2, 5, 6], Bob: [1, 2, 3] });
const cmd153 = chooseAiCommand(board153, car153, [car153, enemy153], [], rs153.dicePool, "Alice", rs153);
console.log("Type (attendu 'airstrike') :", cmd153.type);
console.log("Dé le plus faible utilisé (attendu 2) :", cmd153.dieValue);
console.log("Cible correcte (attendu enemy153) :", cmd153.target === enemy153);
console.log("Placement trouvé, targetCar dans son arc avant (attendu col5 row2 — corrigé pour la géométrie chevron réelle) :", cmd153.placement.col, cmd153.placement.row);

section("Test 153bis — p.10 : au round 1, JAMAIS d'Airstrike même face à une menace claire — préfère Nitro pour un bon départ (précisé par Mayrik)");

const rs153bis = makeRoundStateForCommand(["Alice", "Bob"], { Alice: [2, 5, 6], Bob: [1, 2, 3] }, {}, 1);
const cmd153bis = chooseAiCommand(board153, car153, [car153, enemy153], [], rs153bis.dicePool, "Alice", rs153bis);
console.log("Type (attendu 'nitro', PAS 'airstrike') :", cmd153bis.type);
console.log("Dé compatible 1-3 (attendu 2) :", cmd153bis.dieValue);

section("Test 154 — Véhicule bloqué de partout (3 cases avant occupées/Impassable) : Drift");

const board154 = createTestTile(8, 6);
board154.grid[2][1].terrain = TERRAIN.IMPASSABLE; // front-left
const blockerA154 = createCar("Bob", CAR_SIZE.SMALL, 1, 3); // front, loin du bord (pas de menace)
const blockerB154 = createCar("Bob", CAR_SIZE.SMALL, 1, 4); // front-right
const car154 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const rs154 = makeRoundStateForCommand(["Alice", "Bob"], { Alice: [4, 6], Bob: [1] }); // Bob loin, aucune menace de sortie
const cmd154 = chooseAiCommand(board154, car154, [car154, blockerA154, blockerB154], [], rs154.dicePool, "Alice", rs154);
console.log("Type (attendu 'drift') :", cmd154.type);
console.log("Dé compatible 3-5 (attendu 4) :", cmd154.dieValue);

section("Test 155 — Pas le dernier véhicule à activer pour la 1ère fois : aucune commande");

const board155 = createTestTile(8, 6);
const car155 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const teammate155 = createCar("Alice", CAR_SIZE.SMALL, 0, 0); // opérable, jamais activée ce round
const rs155 = makeRoundStateForCommand(["Alice"], { Alice: [2, 6] });
const cmd155 = chooseAiCommand(board155, car155, [car155, teammate155], [], rs155.dicePool, "Alice", rs155);
console.log("Aucune commande (attendu null) :", cmd155);

section("Test 156 — Dernier véhicule à activer, dé 1-3 disponible : Nitro");

const board156 = createTestTile(8, 6);
const car156 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const teammateDone156 = createCar("Alice", CAR_SIZE.SMALL, 0, 0);
teammateDone156.movedThisRound = true; // déjà activée ce round : car156 est donc bien la dernière
const rs156 = makeRoundStateForCommand(["Alice"], { Alice: [2, 6] });
const cmd156 = chooseAiCommand(board156, car156, [car156, teammateDone156], [], rs156.dicePool, "Alice", rs156);
console.log("Type (attendu 'nitro') :", cmd156.type);
console.log("Dé compatible 1-3 (attendu 2) :", cmd156.dieValue);

section("Test 157 — Dernier véhicule, aucun dé 1-3 : Airstrike par défaut sur l'adversaire le plus en avant");

const board157 = createTestTile(8, 6);
const car157 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const enemyFar157 = createCar("Bob", CAR_SIZE.SMALL, 2, 3); // loin du bord, aucune menace de sortie
const rs157 = makeRoundStateForCommand(["Alice", "Bob"], { Alice: [4, 6], Bob: [1] }); // pas de dé 1-3 chez Alice
const cmd157 = chooseAiCommand(board157, car157, [car157, enemyFar157], [], rs157.dicePool, "Alice", rs157);
console.log("Type (attendu 'airstrike') :", cmd157.type);
console.log("Dé le plus faible utilisé (attendu 4) :", cmd157.dieValue);
console.log("Cible correcte (attendu enemyFar157) :", cmd157.target === enemyFar157);

section("Test 158 — findAiAirstrikePlacement() : évite les cases occupées, hazard, impassable, autre chopper");

const board158 = createTestTile(8, 6);
board158.grid[2][4].hazard = HAZARD_TYPES.MINE; // 1ère case candidate (col4,row2 — corrigé pour la géométrie chevron réelle) invalidée par un hazard
const target158 = createCar("Bob", CAR_SIZE.MEDIUM, 4, 3);
const occupant158 = createCar("Alice", CAR_SIZE.SMALL, 3, 3); // 2e candidate (col3,row3) occupée
const placement158 = findAiAirstrikePlacement(board158, target158, [target158, occupant158], []);
console.log("Case trouvée = la 3e candidate (attendu col4 row4 — corrigé) :", placement158.col, placement158.row);

// -----------------------------------------------------------------
// TESTS 159-166 : IA — ASSIGN (chooseAiAssign), dernière brique.
// Plateau standard 3 tuiles (8 colonnes chacune, 24 au total) pour
// tous ces tests : rearTile.cols=8 (tuile de queue = colonnes 0-7),
// board.cols=24 (sortie de la tuile de tête).
// -----------------------------------------------------------------
const { chooseAiAssign } = require("./engine.js");

function makeStandardProgState() {
  const rear = createTestTile(8, 6);
  const middle = createTestTile(8, 6);
  const lead = createTestTile(8, 6);
  return createTileProgressionState(rear, middle, lead);
}

section("Test 159 — 0.a : véhicule sur la tuile de queue + adversaire menaçant → priorité absolue");

const prog159 = makeStandardProgState();
const board159 = buildBoardFromProgressionState(prog159);
const carQueue159 = createCar("Alice", CAR_SIZE.SMALL, 2, 3); // tuile de queue (col<8)
const carFront159 = createCar("Alice", CAR_SIZE.LARGE, 20, 3); // pas en danger
const enemy159 = createCar("Bob", CAR_SIZE.MEDIUM, 18, 3); // >= 24-7=17 : menace
const cars159 = [carQueue159, carFront159, enemy159];
const rs159 = makeRoundStateForCommand(["Alice", "Bob"], { Alice: [3, 6], Bob: [4] });
const result159 = chooseAiAssign(board159, prog159, cars159, [], rs159.dicePool, "Alice", rs159);
console.log("Véhicule choisi = celui de la tuile de queue (attendu carQueue159) :", result159.car === carQueue159);
console.log("Dé le plus fort utilisé (attendu 6) :", result159.dieValue);

section("Test 160 — 0.b : Finish Line en place, atteignable avec le plus gros dé");

const prog160 = makeStandardProgState();
prog160.finishLineTile = createFinishLineTile(6);
const board160 = buildBoardFromProgressionState(prog160);
const carNear160 = createCar("Alice", CAR_SIZE.MEDIUM, 22, 3); // 22+2=24 : atteint tout juste
const cars160 = [carNear160];
const rs160 = makeRoundStateForCommand(["Alice"], { Alice: [2, 5] });
const result160 = chooseAiAssign(board160, prog160, cars160, [], rs160.dicePool, "Alice", rs160);
console.log("Véhicule proche de la Finish Line choisi (attendu carNear160) :", result160.car === carNear160);
console.log("Dé le plus fort utilisé (attendu 5) :", result160.dieValue);

section("Test 161 — 0.c : aucun véhicule sur la tuile de queue, un véhicule peut sortir par l'avant");

const prog161 = makeStandardProgState();
const board161 = buildBoardFromProgressionState(prog161);
const carExit161 = createCar("Alice", CAR_SIZE.MEDIUM, 20, 3); // pas dans la tuile de queue, 20+4=24
const cars161 = [carExit161];
const rs161 = makeRoundStateForCommand(["Alice"], { Alice: [4, 1] });
const result161 = chooseAiAssign(board161, prog161, cars161, [], rs161.dicePool, "Alice", rs161);
console.log("Véhicule choisi (attendu carExit161) :", result161.car === carExit161);

section("Test 162 — Repair combo : dé 6 + véhicule inopérable → Repair pré-décidé");

const prog162 = makeStandardProgState();
const board162 = buildBoardFromProgressionState(prog162);
const carOperable162 = createCar("Alice", CAR_SIZE.MEDIUM, 10, 3); // pas en tuile de queue, loin de la sortie
const carInoperable162 = createCar("Alice", CAR_SIZE.SMALL, 3, 3);
carInoperable162.status = CAR_STATUS.INOPERABLE;
const cars162 = [carOperable162, carInoperable162];
const rs162 = makeRoundStateForCommand(["Alice"], { Alice: [6, 3] });
const result162 = chooseAiAssign(board162, prog162, cars162, [], rs162.dicePool, "Alice", rs162);
console.log("Véhicule à déplacer (attendu carOperable162) :", result162.car === carOperable162);
console.log("Dé du véhicule (attendu 3, le 6 étant réservé) :", result162.dieValue);
console.log("Commande pré-décidée = Repair (attendu 'repair') :", result162.command.type);
console.log("Cible du Repair (attendu carInoperable162) :", result162.command.target === carInoperable162);

section("Test 163 — Corrigé : SANS menace adverse, la tuile de queue n'est PLUS protégée inconditionnellement (priorité passe à la rotation S/L/M)");

const prog163 = makeStandardProgState();
const board163 = buildBoardFromProgressionState(prog163);
const carQueueLarge163 = createCar("Alice", CAR_SIZE.LARGE, 3, 3); // sur la tuile de queue
const carFrontSmall163 = createCar("Alice", CAR_SIZE.SMALL, 12, 3); // pas en danger, ailleurs
const cars163 = [carQueueLarge163, carFrontSmall163]; // aucun adversaire du tout
const rs163 = makeRoundStateForCommand(["Alice"], { Alice: [5] });
const result163 = chooseAiAssign(board163, prog163, cars163, [], rs163.dicePool, "Alice", rs163);
console.log("La voiture Small (priorité de rotation) est choisie, PAS la Large de la tuile de queue (attendu carFrontSmall163) :", result163.car === carFrontSmall163);

section("Test 164 — Rotation S → L → M : priorité à S si jamais activée ce round");

const prog164 = makeStandardProgState();
const board164 = buildBoardFromProgressionState(prog164);
const carS164 = createCar("Alice", CAR_SIZE.SMALL, 10, 3);
const carM164 = createCar("Alice", CAR_SIZE.MEDIUM, 10, 4);
const carL164 = createCar("Alice", CAR_SIZE.LARGE, 10, 2);
const cars164 = [carS164, carM164, carL164];
const rs164 = makeRoundStateForCommand(["Alice"], { Alice: [3] });
const result164 = chooseAiAssign(board164, prog164, cars164, [], rs164.dicePool, "Alice", rs164);
console.log("Voiture S choisie en priorité (attendu carS164) :", result164.car === carS164);

section("Test 165 — Rotation : S déjà activée ce round → L choisie ensuite");

const prog165 = makeStandardProgState();
const board165 = buildBoardFromProgressionState(prog165);
const carSdone165 = createCar("Alice", CAR_SIZE.SMALL, 10, 3);
carSdone165.movedThisRound = true;
const carM165 = createCar("Alice", CAR_SIZE.MEDIUM, 10, 4);
const carL165 = createCar("Alice", CAR_SIZE.LARGE, 10, 2);
const cars165 = [carSdone165, carM165, carL165];
const rs165 = makeRoundStateForCommand(["Alice"], { Alice: [3] });
const result165 = chooseAiAssign(board165, prog165, cars165, [], rs165.dicePool, "Alice", rs165);
console.log("Voiture L choisie (S déjà activée, attendu carL165) :", result165.car === carL165);

section("Test 166 — Mode Coast : quand toutes les voitures ont déjà bougé, la Command est impossible et le déplacement effectif compte pour 1");

const prog166 = makeStandardProgState();
const board166 = buildBoardFromProgressionState(prog166);
const carSdone166 = createCar("Alice", CAR_SIZE.SMALL, 10, 3);
carSdone166.movedThisRound = true;
const carMdone166 = createCar("Alice", CAR_SIZE.MEDIUM, 10, 4);
carMdone166.movedThisRound = true;
const carLdone166 = createCar("Alice", CAR_SIZE.LARGE, 10, 2);
carLdone166.movedThisRound = true;
const cars166 = [carSdone166, carMdone166, carLdone166];
const rs166 = makeRoundStateForCommand(["Alice"], { Alice: [4] });
const result166 = chooseAiAssign(board166, prog166, cars166, [], rs166.dicePool, "Alice", rs166);
console.log("Toujours une voiture choisie malgré le Coast (attendu carSdone166, rotation S priorité) :", result166.car === carSdone166);
console.log("Aucune commande jamais attachée en Coast (attendu null) :", result166.command);

section("Test 167 — playOneAiTurn() / simulateAiGame() : orchestrateur complet, une partie entière se joue sans erreur");

const { simulateAiGame } = require("./engine.js");

const prog167 = makeStandardProgState();
const round167 = createRoundState(["Alice", "Bob"], { Alice: [3, 5, 2, 6], Bob: [4, 1, 6, 3] });
const cars167 = [
  createCar("Alice", CAR_SIZE.SMALL, 0, 1), createCar("Alice", CAR_SIZE.MEDIUM, 0, 3), createCar("Alice", CAR_SIZE.LARGE, 0, 5),
  createCar("Bob", CAR_SIZE.SMALL, 0, 0), createCar("Bob", CAR_SIZE.MEDIUM, 0, 2), createCar("Bob", CAR_SIZE.LARGE, 0, 4)
];
const sim167 = simulateAiGame(prog167, round167, cars167, [], ["Alice", "Bob"], { maxTurns: 60 });
console.log("Aucune erreur pendant la simulation (attendu undefined) :", sim167.error);
console.log("Nombre de tours joués sans plantage (informatif) :", sim167.turns);

// -----------------------------------------------------------------
// TESTS 168-171 : BONUS ROAD (p.9) — Mayrik a repéré, en relisant le
// rulebook, que ce bonus n'était jamais réellement appliqué dans le
// vrai flux de tour (applyRoadBonus existait, testée isolément, mais
// jamais câblée). En creusant, 2 bugs distincts trouvés et corrigés :
// 1) moveCarWithProgression perdait l'éligibilité au bonus dès qu'un
//    changement de tuile survenait en cours de mouvement (ne gardait
//    que le dernier segment, pas l'ensemble accumulé) ;
// 2) le premier câblage confondait par erreur `state` (progression
//    des tuiles) et `roundState` (qui porte le vrai dé Road) — corrigé
//    en faisant transiter sa valeur via options.roadDieValue.
// -----------------------------------------------------------------

section("Test 168 — moveCarWithProgression() : l'éligibilité au bonus Road s'accumule sur TOUT le trajet, même à travers un changement de tuile");

const rear168 = createTestTile(8, 6);
const middle168 = createTestTile(8, 6);
const lead168 = createTestTile(8, 6);
lead168.grid[3][6].terrain = TERRAIN.OFF_ROAD; // case de DÉPART de la voiture — casse l'éligibilité dès le 1er segment
const rawNextLead168 = { id: "n168", name: "n", format: "vendetta", extension: "base", cols: 8, rows: 6, grid: [] };
for (let r = 0; r < 6; r++) rawNextLead168.grid.push(Array.from({ length: 8 }, () => ({ terrain: TERRAIN.ROAD, hazardSpace: false })));
const nextLead168 = instantiateTile(rawNextLead168);
const progState168 = createTileProgressionState(rear168, middle168, lead168, [nextLead168]);
const car168 = createCar("Alice", CAR_SIZE.MEDIUM, 22, 3); // sur la case OFF_ROAD posée ci-dessus (board col22 = local col6 de lead168)
const moveResult168 = moveCarWithProgression(progState168, car168, 2, ["front", "front"], [car168], [], ["Alice"]);
console.log("2e segment (après changement de tuile) tout en route — mais 1er segment cassé dès le départ (attendu roadEligible: false) :", moveResult168.roadEligible);

section("Test 169 — playTurnAssignMoveWithProgression() applique réellement le bonus Road quand éligible et fourni");

const rear169 = createTestTile(8, 6);
const middle169 = createTestTile(8, 6);
const lead169 = createTestTile(8, 6);
const progState169 = createTileProgressionState(rear169, middle169, lead169);
const car169 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const otherCar169 = createCar("Bob", CAR_SIZE.SMALL, 0, 5); // 2e joueur, pour éviter une victoire triviale "dernier en jeu"
const result169 = playTurnAssignMoveWithProgression(progState169, car169, 3, ["front", "front", "front"], [car169, otherCar169], [], ["Alice", "Bob"], {
  roundNumber: 2,
  roadDieValue: 4,
  roadBonusPath: ["front", "front", "front", "front"]
});
console.log("Bonus bien appliqué (attendu col final = 3 (mouvement normal) + 4 (bonus) = 7) :", car169.col);
console.log("Log mentionne bien le bonus (attendu true) :", result169.log.some((l) => l.includes("BONUS ROAD")));

section("Test 170 — playTurnAssignMoveWithProgression() n'applique JAMAIS le bonus si la voiture n'est pas restée sur route");

const rear170 = createTestTile(8, 6);
const middle170 = createTestTile(8, 6);
const lead170 = createTestTile(8, 6);
rear170.grid[3][1].terrain = TERRAIN.OFF_ROAD; // 1ère case du trajet, hors route
const progState170 = createTileProgressionState(rear170, middle170, lead170);
const car170 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const otherCar170 = createCar("Bob", CAR_SIZE.SMALL, 0, 5);
const result170 = playTurnAssignMoveWithProgression(progState170, car170, 1, ["front"], [car170, otherCar170], [], ["Alice", "Bob"], {
  roundNumber: 2,
  roadDieValue: 4,
  roadBonusPath: ["front", "front", "front", "front"]
});
console.log("Bonus PAS appliqué (attendu col final = 1, juste le mouvement normal) :", car170.col);
console.log("Log ne mentionne jamais le bonus (attendu true) :", !result170.log.some((l) => l.includes("BONUS ROAD")));

section("Test 171 — playOneAiTurn() : l'IA demande et applique elle-même le bonus Road automatiquement, de bout en bout");

const { playOneAiTurn } = require("./engine.js");

const prog171 = makeStandardProgState();
let round171 = createRoundState(["Alice", "Bob"], { Alice: [3, 4, 2, 6], Bob: [1, 1, 1, 1] });
const carAlice171 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const carBob171 = createCar("Bob", CAR_SIZE.SMALL, 0, 5);
const turn171 = playOneAiTurn(prog171, round171, [carAlice171, carBob171], [], ["Alice", "Bob"]);
console.log("Le bonus Road apparaît bien dans le log (attendu true) :", turn171.log.some((l) => l.includes("BONUS ROAD")));

// -----------------------------------------------------------------
// TESTS 172-179 : moveCarEnteringBoard() — entrée en jeu (p.5-6),
// premier mouvement d'une voiture pas encore sur le plateau.
// -----------------------------------------------------------------
const { createCarOffBoard, moveCarEnteringBoard } = require("./engine.js");

section("Test 172 — createCarOffBoard() : col/row à null, status operable");

const offCar172 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
console.log("col (attendu null) :", offCar172.col);
console.log("row (attendu null) :", offCar172.row);
console.log("status (attendu 'operable') :", offCar172.status);

section("Test 173 — Entrée simple sur route : coût normal, rangée libre");

tile = createTestTile(8, 6); // toutes routes
const carEntry173 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const entryResult173 = moveCarEnteringBoard(tile, carEntry173, 4, 5, [], []);
console.log("ok (attendu true) :", entryResult173.ok);
console.log("Position (attendu col 0, row 5 - rangée choisie librement) :", carEntry173.col, carEntry173.row);
console.log("Déplacement consommé (attendu 1, route = 1) donc restant :", entryResult173.remaining);

section("Test 174 — Entrée sur case Boue : coût 2, pas 1");

tile = createTestTile(8, 6);
tile.grid[2][0].terrain = TERRAIN.MUD;
const carEntry174 = createCarOffBoard("Mayrik", CAR_SIZE.SMALL);
const entryResult174 = moveCarEnteringBoard(tile, carEntry174, 4, 2, [], []);
console.log("Position (attendu col 0, row 2) :", carEntry174.col, carEntry174.row);
console.log("Déplacement restant (attendu 2 = 4 - coût boue 2) :", entryResult174.remaining);

section("Test 175 — Le coût de terrain de l'entrée s'applique, puis le trajet continue normalement");

tile = createTestTile(8, 6);
const carEntry175 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const entryResult175 = moveCarEnteringBoard(tile, carEntry175, 4, 3, ["front", "front", "front"], []);
console.log("ok (attendu true) :", entryResult175.ok);
console.log("Position finale (attendu col 3, row 3 - entrée en col0 + 3 pas avant) :", carEntry175.col, carEntry175.row);
console.log("Déplacement restant (attendu 0) :", entryResult175.remaining);

section("Test 176 — Bonus dé Road : zone de départ comptée comme route, entrée sur route, reste éligible");

tile = createTestTile(8, 6);
const carEntry176 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const entryResult176 = moveCarEnteringBoard(tile, carEntry176, 3, 3, ["front", "front"], []);
console.log("roadEligible (attendu true - entrée sur route puis resté sur route) :", entryResult176.roadEligible);

section("Test 177 — Bonus dé Road : entrée sur Hors-piste casse l'éligibilité (la convention 'route' ne couvre QUE la zone hors plateau)");

tile = createTestTile(8, 6);
tile.grid[2][0].terrain = TERRAIN.OFF_ROAD;
const carEntry177 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const entryResult177 = moveCarEnteringBoard(tile, carEntry177, 3, 2, [], []);
console.log("roadEligible (attendu false - la case d'entrée elle-même n'est pas route) :", entryResult177.roadEligible);

section("Test 178 — Rejet : voiture déjà entrée (col non-null)");

tile = createTestTile(8, 6);
const alreadyOnBoard178 = createCar("Mayrik", CAR_SIZE.MEDIUM, 3, 3);
const entryResult178 = moveCarEnteringBoard(tile, alreadyOnBoard178, 3, 2, [], []);
console.log("ok (attendu false) :", entryResult178.ok);
console.log("reason mentionne 'déjà entrée' (attendu true) :", entryResult178.reason.includes("déjà entrée"));

section("Test 179 — Rejet : rangée d'entrée hors limites");

tile = createTestTile(8, 6);
const carEntry179 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const entryResult179 = moveCarEnteringBoard(tile, carEntry179, 3, 99, [], []);
console.log("ok (attendu false) :", entryResult179.ok);
console.log("reason mentionne 'invalide' (attendu true) :", entryResult179.reason.includes("invalide"));


// -----------------------------------------------------------------
// TESTS 180-186 : intégration de l'entrée en jeu dans l'orchestrateur
// IA — chooseAiEntryRow(), playTurnAssignEnterWithProgression(), et
// playOneAiTurn() bout-en-bout avec des voitures réellement hors
// plateau (createCarOffBoard), comme en tout début de vraie partie.
// -----------------------------------------------------------------
const { chooseAiEntryRow, playTurnAssignEnterWithProgression } = require("./engine.js");

section("Test 180 — chooseAiEntryRow() : préfère la route libre à la boue");

let board180 = createBoard(createTestTile(8, 6), createTestTile(8, 6), createTestTile(8, 6));
board180.grid[2][0].terrain = TERRAIN.MUD; // rangée 2 : boue, à éviter si une route est libre ailleurs
const row180 = chooseAiEntryRow(board180, [], []);
console.log("Rangée choisie ≠ 2 (attendu true, évite la boue) :", row180 !== 2);

section("Test 181 — chooseAiEntryRow() : évite une case déjà occupée");

let board181 = createBoard(createTestTile(8, 6), createTestTile(8, 6), createTestTile(8, 6));
const occupant181 = createCar("Adversaire", CAR_SIZE.SMALL, 0, 0);
const row181 = chooseAiEntryRow(board181, [occupant181], []);
console.log("Rangée choisie ≠ 0 (attendu true, évite la voiture déjà là) :", row181 !== 0);

section("Test 182 — chooseAiEntryRow() : évite un chopper posé sur la colonne 0");

let board182 = createBoard(createTestTile(8, 6), createTestTile(8, 6), createTestTile(8, 6));
const chopper182 = { id: "chopper-x", owner: "Adversaire", col: 0, row: 0, placed: true, isChopper: true };
const row182 = chooseAiEntryRow(board182, [], [chopper182]);
console.log("Rangée choisie ≠ 0 (attendu true, évite le chopper) :", row182 !== 0);

section("Test 183 — playTurnAssignEnterWithProgression() : entrée + continuation du trajet en une seule fois");

const prog183 = makeStandardProgState();
const carEnter183 = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
const result183 = playTurnAssignEnterWithProgression(prog183, carEnter183, 4, 3, ["front", "front"], [carEnter183], [], ["Mayrik"], { roundNumber: 1 });
console.log("ok (attendu true) :", result183.ok);
console.log("Position finale (attendu col 2, row 3 - entrée + 2 pas avant) :", carEnter183.col, carEnter183.row);
console.log("movedThisRound (attendu true) :", carEnter183.movedThisRound);

section("Test 184 — chooseAiAssign() : priorité absolue à une voiture pas encore entrée");

const prog184 = makeStandardProgState();
const board184 = buildBoardFromProgressionState(prog184);
const alreadyOn184 = createCar("Mayrik", CAR_SIZE.LARGE, 5, 3);
alreadyOn184.movedThisRound = false;
const notEntered184 = createCarOffBoard("Mayrik", CAR_SIZE.SMALL);
const pool184 = { Mayrik: [3, 5, 6] };
const decision184 = chooseAiAssign(board184, prog184, [alreadyOn184, notEntered184], [], pool184, "Mayrik", createRoundState(["Mayrik"]));
console.log("Voiture choisie = celle pas encore entrée (attendu true) :", decision184.car === notEntered184);
console.log("isEntry (attendu true) :", decision184.isEntry);
console.log("command (attendu null) :", decision184.command);

section("Test 185 — playOneAiTurn() : une voiture hors plateau entre bien en jeu, de bout en bout");

const prog185 = makeStandardProgState();
const round185 = createRoundState(["Mayrik", "IA"], { Mayrik: [4, 3, 2, 5], IA: [1, 1, 1, 1] });
const carsOff185 = [
  createCarOffBoard("Mayrik", CAR_SIZE.SMALL),
  createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM),
  createCarOffBoard("Mayrik", CAR_SIZE.LARGE),
  createCarOffBoard("IA", CAR_SIZE.SMALL),
  createCarOffBoard("IA", CAR_SIZE.MEDIUM),
  createCarOffBoard("IA", CAR_SIZE.LARGE)
];
const turn185 = playOneAiTurn(prog185, round185, carsOff185, [], ["Mayrik", "IA"]);
console.log("ok (attendu true) :", turn185.ok);
console.log("Une voiture est bien entrée (col non-null, attendu true) :", carsOff185.some((c) => c.col !== null));
console.log("Nombre de voitures encore hors plateau (attendu 5) :", carsOff185.filter((c) => c.col === null).length);

section("Test 186 — simulateAiGame() : partie complète démarrant avec TOUTES les voitures hors plateau, sans erreur ni voiture oubliée hors plateau après le round 1");

const prog186 = makeStandardProgState();
const round186 = createRoundState(["Mayrik", "IA"]);
const carsOff186 = [
  createCarOffBoard("Mayrik", CAR_SIZE.SMALL),
  createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM),
  createCarOffBoard("Mayrik", CAR_SIZE.LARGE),
  createCarOffBoard("IA", CAR_SIZE.SMALL),
  createCarOffBoard("IA", CAR_SIZE.MEDIUM),
  createCarOffBoard("IA", CAR_SIZE.LARGE)
];
const sim186 = simulateAiGame(prog186, round186, carsOff186, [], ["Mayrik", "IA"], { maxTurns: 200 });
console.log("Aucune erreur pendant la simulation (attendu undefined) :", sim186.error);
console.log("Toutes les voitures ont fini par entrer (attendu true) :", carsOff186.every((c) => c.col !== null || c.status === CAR_STATUS.ELIMINATED));
console.log("Partie terminée ou plafond de sécurité atteint (attendu true) :", sim186.completed || sim186.safetyCapHit);

// -----------------------------------------------------------------
// TESTS 187-191 : p.10 — aucun tir au round 1 (voiture NI chopper),
// et l'IA préfère un Nitro à une Airstrike inutile pendant ce round.
// -----------------------------------------------------------------

section("Test 187 — resolveAirstrikeCommand() : chopper placé mais AUCUN tir tenté au round 1, même avec une cible fournie");

tile = createTestTile(8, 6);
const chopper187 = createChopper("Mayrik");
const target187 = createCar("IA", CAR_SIZE.MEDIUM, 4, 3);
const airstrike187 = resolveAirstrikeCommand(tile, [target187], [chopper187], chopper187, 3, 3, {
  roundNumber: 1,
  shootTarget: target187,
  forcedDice: { shootingDie: "medium" }
});
console.log("Chopper bien placé (attendu true) :", chopper187.placed);
console.log("Aucun dégât sur la cible (attendu 0) :", target187.damageTokens.length);
console.log("Log mentionne l'impossibilité de tir (attendu true) :", airstrike187.log.some((l) => l.includes("armes ne sont pas encore actives")));

section("Test 188 — chooseAiCommand() : jamais d'Airstrike au round 1 même si la logique de menace le suggérerait, tombe sur Nitro");

const board188 = createTestTile(8, 6);
const car188 = createCar("Alice", CAR_SIZE.MEDIUM, 0, 3);
const enemy188 = createCar("Bob", CAR_SIZE.MEDIUM, 5, 3);
const rs188 = createRoundState(["Alice", "Bob"], { Alice: [2, 5, 6], Bob: [1, 2, 3] });
rs188.roundNumber = 1;
const cmd188 = chooseAiCommand(board188, car188, [car188, enemy188], [], rs188.dicePool, "Alice", rs188);
console.log("Type (attendu 'nitro', jamais 'airstrike' au round 1) :", cmd188.type);

section("Test 189 — chooseAiCommand() : Drift désactivé proprement pour une voiture pas encore entrée (col === null), pas de plantage");

const board189 = createTestTile(8, 6);
board189.grid[2][0].terrain = TERRAIN.IMPASSABLE; // n'a aucune importance : pas d'arc avant avant l'entrée
const carOff189 = createCarOffBoard("Alice", CAR_SIZE.MEDIUM);
const rs189 = createRoundState(["Alice"], { Alice: [2, 4, 6] });
const cmd189 = chooseAiCommand(board189, carOff189, [carOff189], [], rs189.dicePool, "Alice", rs189);
console.log("Pas de plantage, résultat cohérent (attendu true) :", cmd189 === null || cmd189.type === "nitro");

section("Test 190 — playOneAiTurn() : Nitro utilisable dès le tour d'entrée (round 1) pour booster le premier mouvement");

const prog190 = makeStandardProgState();
const round190 = createRoundState(["Alice"], { Alice: [4, 3, 2, 2] }); // dernière voiture activée -> Nitro éligible (dé 1-3 dispo)
const carA190 = createCar("Alice", CAR_SIZE.SMALL, 5, 3);
carA190.movedThisRound = true; // déjà activée ce round
const carB190 = createCar("Alice", CAR_SIZE.MEDIUM, 5, 4);
carB190.movedThisRound = true;
const carOff190 = createCarOffBoard("Alice", CAR_SIZE.LARGE); // dernière non-activée -> celle qui recevra la Command
const turn190 = playOneAiTurn(prog190, round190, [carA190, carB190, carOff190], [], ["Alice"]);
console.log("ok (attendu true) :", turn190.ok);
console.log("Command Nitro utilisée (attendu true) :", turn190.log.some((l) => l.includes("COMMAND (IA) : nitro")));
console.log("La voiture est bien entrée (col non-null, attendu true) :", carOff190.col !== null);

section("Test 191 — playOneAiTurn() : la voiture continue son trajet après l'entrée si le dé le permet (pas d'arrêt net en colonne 0)");

const prog191 = makeStandardProgState();
const round191 = createRoundState(["Alice"], { Alice: [5, 1, 1, 1] });
const carOff191 = createCarOffBoard("Alice", CAR_SIZE.MEDIUM);
const turn191 = playOneAiTurn(prog191, round191, [carOff191], [], ["Alice"]);
console.log("ok (attendu true) :", turn191.ok);
console.log("Colonne finale > 0 (attendu true, la voiture a continué après l'entrée) :", carOff191.col > 0);

// -----------------------------------------------------------------
// TEST 192 : bug réel trouvé par Mayrik en demandant une validation à
// grande échelle (150+ parties simulées) de l'entrée en jeu — sans
// rapport avec l'entrée elle-même, mais révélé par ce test massif :
// une Mine touchée PENDANT la glissade gratuite d'un Oil Slick (donc
// imbriquée dans forceMoveOneSpace, pas dans le flux normal) perdait
// son signal d'arrêt — le mouvement d'origine continuait alors
// silencieusement après coup, parfois jusqu'à faire sortir du
// plateau une voiture déjà devenue inopérable.
// -----------------------------------------------------------------
section("Test 192 — Mine imbriquée dans une glissade Oil Slick : le mouvement s'arrête bien net (bug trouvé par simulation à grande échelle)");

tile = createTestTile(8, 6);
tile.grid[3][1].hazard = HAZARD_TYPES.OIL_SLICK;
tile.grid[3][2].hazard = HAZARD_TYPES.MINE;
const car192 = createCar("Mayrik", CAR_SIZE.MEDIUM, 0, 3);
car192.damageTokens = ["x"]; // déjà 1 dégât -> la Mine sera le 2e -> inopérable

const result192 = moveCar(tile, car192, 4, ["front", "front"], [car192], {
  forcedDice: {
    oilSlickDirection: "front",
    drawnToken: { type: TOKEN_TYPES.SKID, skidDirection: "front" }
  }
});
result192.log.forEach((l) => console.log("  " + l));
console.log("Statut (attendu 'inoperable') :", car192.status);
console.log("Position finale (attendu col 3, row 3 - PAS col 4 ou 5, mouvement stoppé net) :", car192.col, car192.row);
console.log("remaining renvoyé (attendu 0) :", result192.remaining);

section("Fin des tests");

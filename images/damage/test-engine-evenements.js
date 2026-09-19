/**
 * Test manuel dédié — chantier rythme 4b : ÉVÉNEMENTS DE PRÉSENTATION
 * rendus par le moteur.
 * À lancer avec : node test-engine-evenements.js
 *
 * Avant ce chantier, tous les moments intéressants d'un pas (dés
 * lancés, slam résolu, dégât posé, tir résolu) se passaient à
 * l'intérieur d'un unique {type:"step"}, sans rien à quoi accrocher une
 * pause — d'où le véhicule qui avait déjà bougé pendant que ses dés
 * volaient encore. Ce test vérifie :
 *
 *  1. ORDRE : les dés de slam sont annoncés AVANT tout déplacement
 *     qu'ils provoquent. C'est le point qui justifie tout le chantier.
 *  2. Un tir annonce son dé avant le dégât, et le dégât avant la fin
 *     du tir.
 *  3. Les décisions restent distinctes des événements : un
 *     {type:"slam-reroll"} n'est PAS un événement de présentation et
 *     suspend toujours vraiment le moteur.
 *  4. NON-RÉGRESSION : sans `emitEvents`, le moteur n'émet rien du tout
 *     et les résultats sont identiques, valeur par valeur.
 *  5. Un appelant SYNCHRONE (driveSync) traverse les événements sans
 *     broncher, même si l'option traîne dans ses options — c'est ce qui
 *     rend l'émission sans risque depuis n'importe quel point de la
 *     chaîne.
 */

const {
  createTestTile, createCar, CAR_SIZE, HAZARD_TYPES,
  moveCar, moveCarGen, resolveShoot, resolveShootGen,
  isPresentationEvent, TOKEN_TYPES, getSpace, applyDamageGen
} = require("./engine.js");

function section(title) { console.log("\n=== " + title + " ==="); }

// Consomme un générateur jusqu'au bout en RÉPONDANT aux décisions, et
// renvoie la liste ordonnée des événements traversés.
function collecter(gen, repondre = () => false) {
  const evenements = [];
  let step = gen.next();
  while (!step.done) {
    evenements.push(step.value);
    step = gen.next(isPresentationEvent(step.value) ? undefined : repondre(step.value));
  }
  return { evenements, resultat: step.value };
}

function types(evenements) { return evenements.map((e) => e.type); }

// -----------------------------------------------------------------
section("Test 1 — Slam : les dés sont annoncés AVANT le déplacement qu'ils provoquent");

let tile = createTestTile(8, 6);
let mover = createCar("IA", CAR_SIZE.LARGE, 3, 3);
let occupant = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
let cars = [mover, occupant];

let gen = moveCarGen(tile, mover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front-left" },
  emitEvents: true
});
let { evenements } = collecter(gen);
const suite1 = types(evenements);
console.log("Séquence observée :", suite1.join(" → "));

const iDes = suite1.indexOf("slam-dice");
const iResolu = suite1.indexOf("slam-resolved");
console.log("Les dés de slam sont bien annoncés (attendu true) :", iDes >= 0);
console.log("Le slam résolu est bien annoncé (attendu true) :", iResolu >= 0);
console.log("Les dés viennent AVANT la résolution du slam (attendu true) :", iDes >= 0 && iDes < iResolu);

// Le déplacement induit de la voiture PERCUTÉE passe par
// forceMoveOneSpaceGen, qui émet ses propres "step". C'est le point
// décisif du chantier : aucun de ces pas ne doit précéder l'annonce des
// dés qui les a causés. (Le tout premier "step" de la séquence est
// autre chose : l'arrivée du percuteur sur la case occupée, qui précède
// légitimement le jet de dés.)
const pasDeLaPercutee = evenements
  .map((e, i) => ({ e, i }))
  .filter((x) => x.e.type === "step" && x.e.car === occupant);
console.log("La voiture percutée se déplace bien (attendu true) :", pasDeLaPercutee.length > 0);
console.log("Aucun de ses pas n'a lieu AVANT les dés (attendu true) :",
  pasDeLaPercutee.every((x) => x.i > iDes));
console.log("Le premier pas de la séquence est celui du percuteur, avant les dés (attendu true) :",
  evenements[0].type === "step" && evenements[0].car === mover);

const evtDes = evenements[iDes];
console.log("L'événement porte les deux dés et la voiture déplacée (attendu true) :",
  evtDes.slamRoll === "bottom" && evtDes.directionRoll === "front-left" && !!evtDes.movingCar);

// -----------------------------------------------------------------
section("Test 2 — Tir : dé annoncé, puis dégât posé, puis tir résolu");

tile = createTestTile(8, 6);
const shooter = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const target = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
cars = [shooter, target];

const genTir = resolveShootGen(tile, cars, shooter, target, {
  forcedDice: { shootingDie: "any", drawnToken: HAZARD_TYPES ? undefined : undefined },
  emitEvents: true
});
const tir = collecter(genTir);
const suite2 = types(tir.evenements);
console.log("Séquence observée :", suite2.join(" → "));
console.log("Le tir a bien touché (attendu true) :", tir.resultat.hit === true);
console.log("Le dé de tir est annoncé avant le dégât (attendu true) :",
  suite2.indexOf("shoot-dice") >= 0 && suite2.indexOf("shoot-dice") < suite2.indexOf("damage"));
console.log("Le dégât est annoncé avant la fin du tir (attendu true) :",
  suite2.indexOf("damage") >= 0 && suite2.indexOf("damage") < suite2.indexOf("shoot-resolved"));
const evtDegat = tir.evenements.find((e) => e.type === "damage");
console.log("L'événement dégât nomme la cible et son jeton (attendu true) :",
  !!evtDegat && evtDegat.car === target && typeof evtDegat.tokenType === "string" && evtDegat.tokenCount === 1);

// -----------------------------------------------------------------
section("Test 3 — Une décision n'est pas un événement de présentation");

console.log("'step' est un événement de présentation (attendu true) :", isPresentationEvent({ type: "step" }) === true);
console.log("'slam-dice' aussi (attendu true) :", isPresentationEvent({ type: "slam-dice" }) === true);
console.log("'slam-reroll' n'en est PAS un (attendu true) :", isPresentationEvent({ type: "slam-reroll" }) === false);
console.log("Une valeur vide n'en est pas un (attendu true) :", isPresentationEvent(undefined) === false);

tile = createTestTile(8, 6);
mover = createCar("IA", CAR_SIZE.SMALL, 3, 3);
occupant = createCar("Vous", CAR_SIZE.LARGE, 4, 3);
cars = [mover, occupant];
gen = moveCarGen(tile, mover, 1, ["front"], cars, {
  forcedDice: { slam: "bottom", direction: "front-left" },
  isHumanOwner: (owner) => owner === "Vous",
  emitEvents: true
});
let decisions = 0;
const melange = collecter(gen, (v) => { if (v.type === "slam-reroll") decisions++; return false; });
console.log("La décision de relance a bien suspendu le moteur (attendu true) :", decisions === 1);
console.log("Elle cohabite avec les événements de présentation (attendu true) :",
  types(melange.evenements).includes("slam-dice") && types(melange.evenements).includes("slam-reroll"));

// -----------------------------------------------------------------
section("Test 4 — Non-régression : sans emitEvents, aucun événement et résultat identique");

function jouerSlam(options) {
  const t = createTestTile(8, 6);
  const m = createCar("IA", CAR_SIZE.LARGE, 3, 3);
  const o = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
  // Jeton forcé : sans ça le tirage est aléatoire et la comparaison des
  // journaux ne voudrait plus rien dire.
  const g = moveCarGen(t, m, 1, ["front"], [m, o], {
    forcedDice: { slam: "bottom", direction: "front-left", drawnToken: TOKEN_TYPES.DENT },
    ...options
  });
  const { evenements, resultat } = collecter(g);
  // Les identifiants de voiture sont attribués par un compteur global :
  // ils diffèrent d'un montage à l'autre. On les neutralise pour pouvoir
  // comparer les DEUX journaux ligne pour ligne.
  const journal = resultat.log.map((l) => l.split(m.id).join("[percuteur]").split(o.id).join("[percutée]"));
  return { evenements, resultat, journal, m, o };
}

const sans = jouerSlam({});
const avec = jouerSlam({ emitEvents: true });
console.log("Sans l'option, le moteur n'émet RIEN (attendu true) :", sans.evenements.length === 0);
console.log("Avec l'option, il émet quelque chose (attendu true) :", avec.evenements.length > 0);
console.log("Les positions finales sont identiques dans les deux cas (attendu true) :",
  sans.m.col === avec.m.col && sans.m.row === avec.m.row &&
  sans.o.col === avec.o.col && sans.o.row === avec.o.row);
console.log("Les journaux sont identiques, ligne pour ligne (attendu true) :",
  sans.journal.length > 0 && JSON.stringify(sans.journal) === JSON.stringify(avec.journal));

// -----------------------------------------------------------------
section("Test 5 — Un appelant synchrone traverse les événements sans broncher");

// L'API synchrone (driveSync) lève une erreur sur une vraie décision en
// attente. Elle doit en revanche ignorer paisiblement les événements de
// présentation, même si l'option traîne dans les options transmises —
// c'est ce qui rend l'émission sans risque partout dans la chaîne.
tile = createTestTile(8, 6);
mover = createCar("IA", CAR_SIZE.LARGE, 3, 3);
occupant = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
cars = [mover, occupant];
let erreurSync = null;
let resultatSync = null;
try {
  resultatSync = moveCar(tile, mover, 1, ["front"], cars, {
    forcedDice: { slam: "bottom", direction: "front-left" },
    emitEvents: true
  });
} catch (e) {
  erreurSync = e;
}
console.log("Aucune erreur levée (attendu true) :", erreurSync === null);
console.log("Le mouvement a bien été joué jusqu'au bout (attendu true) :",
  !!resultatSync && Array.isArray(resultatSync.log) && resultatSync.log.length > 0);

tile = createTestTile(8, 6);
const tireur = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const cible = createCar("Vous", CAR_SIZE.SMALL, 4, 3);
let erreurTir = null;
let resTir = null;
try {
  resTir = resolveShoot(tile, [tireur, cible], tireur, cible, {
    forcedDice: { shootingDie: "any" },
    emitEvents: true
  });
} catch (e) {
  erreurTir = e;
}
console.log("Même chose pour un tir synchrone (attendu true) :", erreurTir === null && !!resTir && resTir.hit === true);


// -----------------------------------------------------------------
section("Test 6 — Épave : le véhicule qui arrive est TOUJOURS le TOP du dé de slam");

// Règle p.7, citée par Mayrik : « Place the moving road vehicle on top
// of the wreck and resolve the slam. » Deux chemins de code distincts
// mènent là, et les deux doivent donner le même ordre :
//   a) une épave qui APPARAÎT sous le véhicule (jeton Wreck révélé) —
//      cas explicite de resolveHazardGen ;
//   b) une épave DÉJÀ PRÉSENTE depuis un tour précédent, qui n'est
//      qu'un occupant ordinaire trouvé par getCarAt.

// (a) jeton Wreck révélé à l'arrivée
tile = createTestTile(8, 6);
const rouleur = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
cars = [rouleur];
getSpace(tile, 4, 3).hazard = HAZARD_TYPES.WRECK;

const genWreck = moveCarGen(tile, rouleur, 1, ["front"], cars, {
  forcedDice: { slam: "top", direction: "front-left" },
  emitEvents: true
});
const wreck = collecter(genWreck);
const evtDesWreck = wreck.evenements.find((e) => e.type === "slam-dice");
const epaveCreee = cars.find((c) => c.isWreck);
console.log("Une épave a bien été créée (attendu true) :", !!epaveCreee);
console.log("Le véhicule qui arrive est le TOP (attendu true) :", !!evtDesWreck && evtDesWreck.topCar === rouleur);
console.log("L'épave est le BOTTOM (attendu true) :", !!evtDesWreck && evtDesWreck.bottomCar === epaveCreee);
console.log("Un dé 'top' déplace donc bien le véhicule, pas l'épave (attendu true) :",
  !!evtDesWreck && evtDesWreck.movingCar === rouleur);

// (b) épave déjà là, rencontrée comme occupant ordinaire
tile = createTestTile(8, 6);
const rouleur2 = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const epaveExistante = createCar(null, CAR_SIZE.SMALL, 4, 3);
epaveExistante.isWreck = true;
cars = [rouleur2, epaveExistante];

const genExistante = moveCarGen(tile, rouleur2, 1, ["front"], cars, {
  forcedDice: { slam: "top", direction: "front-left" },
  emitEvents: true
});
const existante = collecter(genExistante);
const evtDes2 = existante.evenements.find((e) => e.type === "slam-dice");
console.log("Une épave déjà présente déclenche bien un slam (attendu true) :", !!evtDes2);
console.log("Le véhicule qui arrive est le TOP, là aussi (attendu true) :", !!evtDes2 && evtDes2.topCar === rouleur2);
console.log("L'épave est le BOTTOM, là aussi (attendu true) :", !!evtDes2 && evtDes2.bottomCar === epaveExistante);

// Éligibilité à la relance : l'épave compte comme une petite voiture.
console.log("Medium contre épave Small : relance possible, au plus grand (attendu true) :",
  !!evtDes2 && evtDes2.largerCar === rouleur2 && evtDes2.smallerCar === epaveExistante);

const tile3 = createTestTile(8, 6);
const petit = createCar("IA", CAR_SIZE.SMALL, 3, 3);
const epave3 = createCar(null, CAR_SIZE.SMALL, 4, 3);
epave3.isWreck = true;
const gen3 = moveCarGen(tile3, petit, 1, ["front"], [petit, epave3], {
  forcedDice: { slam: "top", direction: "front-left" },
  emitEvents: true
});
const petitContreEpave = collecter(gen3);
const evtDes3 = petitContreEpave.evenements.find((e) => e.type === "slam-dice");
console.log("Small contre épave Small : aucune relance possible (attendu true) :",
  !!evtDes3 && evtDes3.largerCar === null && evtDes3.smallerCar === null);


// -----------------------------------------------------------------
section("Test 7 — Jeton de dégât : direction du Skid conservée, et fin de résolution annoncée");

// Chantier 4c. Deux besoins de l'interface, tous deux invisibles ici :
//   - les six jetons Skid ont chacun une direction fixe imprimée (p.12)
//     et donc six images distinctes : la direction doit survivre dans
//     le jeton, pas seulement servir au calcul du déplacement ;
//   - le jeton reste face visible tant que SES effets s'appliquent, il
//     faut donc savoir quand ils sont finis.

tile = createTestTile(8, 6);
const skide = createCar("Vous", CAR_SIZE.MEDIUM, 3, 3);
cars = [skide];
const genSkid = applyDamageGen(skide, {
  tile, allCars: cars,
  tokenType: TOKEN_TYPES.SKID,
  skidDirection: "rear-left",
  emitEvents: true
});
const skid = collecter(genSkid);
const suite7 = types(skid.evenements);
console.log("Séquence observée :", suite7.join(" → "));

const evtSkid = skid.evenements.find((e) => e.type === "damage");
console.log("La direction du Skid est portée par l'événement (attendu true) :", !!evtSkid && evtSkid.skidDirection === "rear-left");
console.log("...et conservée dans le jeton lui-même (attendu true) :",
  skide.damageTokens.length === 1 && skide.damageTokens[0].skidDirection === "rear-left");
console.log("Un jeton sans direction n'en invente pas (attendu true) :", (() => {
  const t = createTestTile(8, 6);
  const c = createCar("Vous", CAR_SIZE.MEDIUM, 3, 3);
  const g = applyDamageGen(c, { tile: t, allCars: [c], tokenType: TOKEN_TYPES.DENT, emitEvents: true });
  collecter(g);
  return c.damageTokens[0].skidDirection === undefined;
})());

console.log("La fin de résolution est annoncée (attendu true) :", suite7.includes("damage-resolved"));
console.log("...APRÈS les déplacements provoqués par le jeton (attendu true) :",
  suite7.lastIndexOf("step") >= 0 && suite7.indexOf("damage-resolved") > suite7.lastIndexOf("step"));
console.log("...et une seule fois (attendu true) :", suite7.filter((t) => t === "damage-resolved").length === 1);

// Cascade : un Shrapnel touche une autre voiture, qui prend un DENT.
// Le jeton déclenché doit se retourner AVANT celui qui l'a déclenché.
tile = createTestTile(8, 6);
const source = createCar("IA", CAR_SIZE.MEDIUM, 3, 3);
const touchee = createCar("Vous", CAR_SIZE.SMALL, 5, 3);
cars = [source, touchee];
const genCascade = applyDamageGen(source, {
  tile, allCars: cars,
  tokenType: TOKEN_TYPES.SHRAPNEL,
  forcedDice: { shrapnelDirection: "front" },
  emitEvents: true
});
const cascade = collecter(genCascade);
const suite8 = types(cascade.evenements);
console.log("\nSéquence de cascade :", suite8.join(" → "));
console.log("Deux jetons posés, deux fins de résolution (attendu true) :",
  suite8.filter((t) => t === "damage").length === 2 && suite8.filter((t) => t === "damage-resolved").length === 2);
console.log("Le jeton déclenché se retourne AVANT celui qui l'a déclenché (attendu true) :",
  suite8.indexOf("damage-resolved") < suite8.lastIndexOf("damage-resolved") &&
  suite8.lastIndexOf("damage") < suite8.indexOf("damage-resolved"));

console.log("\n=== Fin des tests dédiés (événements de présentation, 4b et 4c) ===");

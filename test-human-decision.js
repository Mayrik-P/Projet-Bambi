/**
 * test-human-decision.js — Tests unitaires de la couche de décision
 * JOUEUR HUMAIN (voir human-decision.js). Contrairement à
 * test-ai-decision.js, ces tests vérifient une ABSENCE de politique
 * stratégique (le joueur doit rester libre) autant que la présence
 * des bonnes contraintes mécaniques (le livret doit être respecté).
 */

"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const engine = require("./engine.js");
const human = require("./human-decision.js");
const { checkDecisionLegality, executeDecision } = require("./turn-executor.js");

const {
  TERRAIN, CAR_SIZE, CAR_STATUS,
  createTestTile, createBoard, createCar, createCarOffBoard, createChopper,
  createRoundState, createTileProgressionState, setupTileProgressionFromRawData,
  buildBoardFromProgressionState
} = engine;

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) passed++;
  else { failed++; console.log(`ÉCHEC : ${label}`); }
}

function emptyBoard(cols = 24, rows = 6, terrain = TERRAIN.ROAD) {
  const tile = createTestTile(cols, rows);
  const board = createBoard(tile);
  board.grid.forEach((row) => row.forEach((cell) => { cell.terrain = terrain; }));
  return board;
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

function freshProgressionSetup(playerNames, dicePool) {
  const rawTiles = loadRealTiles();
  const setup = setupTileProgressionFromRawData(rawTiles, { playerCount: playerNames.length });
  const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: playerNames.length });
  const allCars = [];
  const allChoppers = [];
  for (const name of playerNames) {
    allChoppers.push(createChopper(name));
    allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
    allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
    allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
  }
  const roundState = createRoundState(playerNames, dicePool);
  return { progressionState, allCars, allChoppers, roundState };
}

// -----------------------------------------------------------------
// SECTION 1 — getTurnContext
// -----------------------------------------------------------------
{
  // Mode "assign" : au moins une voiture opérable pas encore activée.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["A", "B"], { A: [4, 2, 6, 1], B: [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "A", roundState);
  assert(ctx.canPlay === true, "getTurnContext : peut jouer quand le pool n'est pas vide");
  assert(ctx.mode === "assign", "getTurnContext : mode 'assign' quand une voiture opérable reste à activer");
  assert(ctx.activatableCars.length === 3, "getTurnContext : les 3 voitures opérables non encore activées sont listées");
  assert(ctx.commandAvailable === true, "getTurnContext : Command disponible si pas encore jouée ce round");
  assert(JSON.stringify(ctx.pool.slice().sort()) === JSON.stringify([1, 2, 4, 6]), "getTurnContext : le pool renvoyé correspond exactement au pool réel du joueur");
}
{
  // Mode "assign", Command déjà jouée -> commandAvailable false.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["A", "B"], { A: [4, 2, 6, 1], B: [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  roundState.commandUsedThisRound.A = true;
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "A", roundState);
  assert(ctx.commandAvailable === false, "getTurnContext : Command indisponible si déjà jouée ce round");
}
{
  // Mode "coast" : toutes les voitures opérables déjà activées ce round.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["A", "B"], { A: [4], B: [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  for (const c of allCars.filter((c) => c.owner === "A")) { c.col = 0; c.row = 0; c.movedThisRound = true; }
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "A", roundState);
  assert(ctx.mode === "coast", "getTurnContext : mode 'coast' quand toutes les voitures opérables sont déjà activées");
  assert(ctx.coastableCars.length === 3, "getTurnContext : les 3 voitures (coastCount < 2) sont proposées pour le Coast");
  assert(ctx.commandAvailable === undefined, "getTurnContext : pas de notion de Command en mode Coast (jamais permise, p.8)");
}
{
  // canPlay false : pool vide.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["A", "B"], { A: [], B: [1, 1, 1, 1] });
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "A", roundState);
  assert(ctx.canPlay === false, "getTurnContext : canPlay=false si le pool est vide");
}
{
  // canPlay false : plus aucun Coast possible (coastCount déjà à 2 partout).
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["A", "B"], { A: [4], B: [1, 1, 1, 1] });
  for (const c of allCars.filter((c) => c.owner === "A")) { c.col = 0; c.row = 0; c.movedThisRound = true; c.coastCount = 2; }
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "A", roundState);
  assert(ctx.canPlay === false, "getTurnContext : canPlay=false si plus aucune voiture ne peut coaster (max 2 atteint partout)");
}

// -----------------------------------------------------------------
// SECTION 2 — getReachableOptions (délègue fidèlement à
// computeReachableDestinations / computeReachableEntryDestinations,
// AUCUNE présélection stratégique)
// -----------------------------------------------------------------
{
  const board = emptyBoard();
  const carOnBoard = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const optionsOnBoard = human.getReachableOptions(board, carOnBoard, 3, [carOnBoard], []);
  assert(optionsOnBoard.length > 1, "getReachableOptions : plusieurs cases atteignables sur plateau ouvert (pas UNE seule présélectionnée)");
  assert(optionsOnBoard.every((o) => typeof o.terminalReason === "string"), "getReachableOptions : chaque option porte ses métadonnées (terminalReason...)");

  const carOffBoard = createCarOffBoard("A", CAR_SIZE.SMALL);
  const optionsEntry = human.getReachableOptions(board, carOffBoard, 3, [carOffBoard], []);
  assert(optionsEntry.every((o) => "entryRow" in o), "getReachableOptions : les options d'entrée portent bien entryRow");
}

// -----------------------------------------------------------------
// SECTION 3 — getAvailableCommands (règles du livret UNIQUEMENT —
// AUCUNE condition de position façon IA : tuile Rear, adversaire à
// telle distance... n'existent pas ici)
// -----------------------------------------------------------------
{
  const r = human.getAvailableCommands([2, 4, 6], []);
  assert(r.some((c) => c.type === "nitro" && JSON.stringify(c.eligibleDice) === JSON.stringify([2])), "getAvailableCommands : Nitro listé avec les dés 1-3 réellement disponibles (ici juste 2)");
  assert(r.some((c) => c.type === "drift" && JSON.stringify(c.eligibleDice) === JSON.stringify([4])), "getAvailableCommands : Drift listé avec les dés 3-5 réellement disponibles (ici juste 4)");
  assert(!r.some((c) => c.type === "repair"), "getAvailableCommands : pas de Repair proposé sans voiture inopérable, même avec un 6 disponible");
  assert(r.some((c) => c.type === "airstrike" && JSON.stringify(c.eligibleDice) === JSON.stringify([2, 4, 6])), "getAvailableCommands : Airstrike accepte N'IMPORTE QUEL dé (p.8), tous listés");
}
{
  // Repair proposé dès qu'un 6 est là ET qu'une voiture inopérable
  // existe — n'importe laquelle, pas "celle en tête" comme l'IA.
  const inoperable1 = createCar("A", CAR_SIZE.SMALL, 3, 2);
  inoperable1.status = CAR_STATUS.INOPERABLE;
  const inoperable2 = createCar("A", CAR_SIZE.LARGE, 15, 2); // "en tête" -> l'IA la choisirait d'office, ici les DEUX doivent être proposées
  inoperable2.status = CAR_STATUS.INOPERABLE;
  const r = human.getAvailableCommands([6], [inoperable1, inoperable2]);
  const repairCmd = r.find((c) => c.type === "repair");
  assert(!!repairCmd, "getAvailableCommands : Repair proposé avec un 6 et au moins une voiture inopérable");
  assert(repairCmd.eligibleTargets.length === 2, "getAvailableCommands : TOUTES les voitures inopérables sont des cibles valides, pas une seule présélectionnée");
}
{
  // Une voiture inopérable mais ÉLIMINÉE ne doit jamais être une cible.
  const eliminated = createCar("A", CAR_SIZE.SMALL, 3, 2);
  eliminated.status = CAR_STATUS.ELIMINATED;
  const r = human.getAvailableCommands([6], [eliminated]);
  assert(!r.some((c) => c.type === "repair"), "getAvailableCommands : pas de Repair si le seul 'inopérable' est en fait éliminé");
}
{
  // Aucun dé éligible du tout -> liste vide (mais Airstrike dès qu'il reste au moins un dé, quel qu'il soit).
  const r = human.getAvailableCommands([], []);
  assert(r.length === 0, "getAvailableCommands : aucune Command si plus aucun dé disponible");
}

// -----------------------------------------------------------------
// SECTION 4 — placements Airstrike valides (case vide, p.8)
// -----------------------------------------------------------------
{
  const board = emptyBoard(6, 3);
  const chopper = { owner: "A", placed: false, col: null, row: null };
  const car = createCar("A", CAR_SIZE.MEDIUM, 2, 1);
  board.grid[1][3].terrain = TERRAIN.IMPASSABLE;
  board.grid[0][4].hazard = "hidden";
  const allCars = [car];
  const allChoppers = [chopper];

  assert(human.isValidAirstrikePlacement(board, allCars, allChoppers, chopper, 2, 1) === false, "isValidAirstrikePlacement : refusé si occupé par un véhicule");
  assert(human.isValidAirstrikePlacement(board, allCars, allChoppers, chopper, 3, 1) === false, "isValidAirstrikePlacement : refusé si case impassable");
  assert(human.isValidAirstrikePlacement(board, allCars, allChoppers, chopper, 4, 0) === false, "isValidAirstrikePlacement : refusé si hazard présent");
  assert(human.isValidAirstrikePlacement(board, allCars, allChoppers, chopper, 0, 0) === true, "isValidAirstrikePlacement : accepté sur une case vide sans obstacle");
  assert(human.isValidAirstrikePlacement(board, allCars, allChoppers, chopper, 99, 99) === false, "isValidAirstrikePlacement : refusé hors plateau");

  const placements = human.listValidAirstrikePlacements(board, allCars, allChoppers, chopper);
  assert(placements.length === 6 * 3 - 3, "listValidAirstrikePlacements : exactement les cases valides du plateau (18 - 1 véhicule - 1 impassable - 1 hazard = 15)");

  // Ne mute JAMAIS le chopper (contrairement à engine.placeChopperAirstrike).
  assert(chopper.placed === false && chopper.col === null, "isValidAirstrikePlacement/listValidAirstrikePlacements : ne mutent jamais le chopper (simple consultation)");
}

// -----------------------------------------------------------------
// SECTION 5 — buildHumanDecision (même forme que ai.decideAssignAndCommand)
// -----------------------------------------------------------------
{
  const car = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const destination = { col: 8, row: 2, terminalReason: "normal", path: ["front", "front", "front"] };
  const d = human.buildHumanDecision({ car, dieValue: 3, command: null, destination });
  assert(d.car === car && d.dieValue === 3 && d.command === null, "buildHumanDecision : champs de base correctement reportés");
  assert(d.isEntry === false && d.isCoast === false, "buildHumanDecision : voiture déjà sur le plateau -> ni entrée ni Coast");
  assert(d.slam === false, "buildHumanDecision : slam=false pour une destination 'normal'");

  const carOffBoard = createCarOffBoard("A", CAR_SIZE.SMALL);
  const dEntry = human.buildHumanDecision({ car: carOffBoard, dieValue: 4, command: null, destination: { col: 2, row: 3, terminalReason: "normal", entryRow: 3, path: [] } });
  assert(dEntry.isEntry === true, "buildHumanDecision : voiture hors plateau -> isEntry=true");

  const dSlam = human.buildHumanDecision({ car, dieValue: 2, command: null, destination: { col: 6, row: 2, terminalReason: "slam", slamTarget: {}, path: ["front"] } });
  assert(dSlam.slam === true, "buildHumanDecision : slam=true si terminalReason='slam'");

  const dCoast = human.buildHumanDecision({ car, dieValue: 1, command: null, destination: { col: 6, row: 2, terminalReason: "normal", path: ["front"] }, isCoast: true });
  assert(dCoast.isCoast === true && dCoast.isEntry === false, "buildHumanDecision : isCoast respecté, jamais isEntry en même temps");
}

// -----------------------------------------------------------------
// SECTION 6 — Intégration bout en bout : une décision humaine
// s'exécute via le MÊME moteur que l'IA (turn-executor.js), sans
// AUCUNE branche spécifique "humain" côté engine.js.
// -----------------------------------------------------------------
{
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  roundState.roadDie = 1;
  const board = buildBoardFromProgressionState(progressionState);

  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
  const car = ctx.activatableCars.find((c) => c.size === "small");
  const dieValue = 4;
  const options = human.getReachableOptions(board, car, dieValue, allCars, allChoppers);
  const destination = options.find((o) => o.terminalReason === "normal") || options[0];
  const decision = human.buildHumanDecision({ car, dieValue, command: null, destination });

  const legality = checkDecisionLegality(decision, roundState.dicePool.Mayrik, "Mayrik");
  assert(legality.allOk === true, "Intégration : une décision humaine correctement construite est jugée légale");

  const result = executeDecision(progressionState, roundState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], "Mayrik", decision);
  assert(result.ok === true, "Intégration : executeDecision exécute avec succès une décision humaine");
  assert(car.col === destination.col && car.row === destination.row, "Intégration : la voiture atterrit bien là où le joueur l'a choisi");
  assert(!roundState.dicePool.Mayrik.includes(4) || roundState.dicePool.Mayrik.filter((v) => v === 4).length < 1, "Intégration : le dé utilisé est bien retiré du pool");
}
{
  // Repair : cible choisie LIBREMENT par le joueur (pas la logique de
  // ciblage stratégique de l'IA), exécutée via le même moteur.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [6, 3, 2, 4], "IA-Adverse": [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  roundState.roadDie = 1;
  const board = buildBoardFromProgressionState(progressionState);

  const myLarge = allCars.find((c) => c.owner === "Mayrik" && c.size === "large");
  myLarge.col = 5; myLarge.row = 2; myLarge.status = CAR_STATUS.INOPERABLE; myLarge.damageTokens = ["skid"]; myLarge.movedThisRound = true;
  const myMedium = allCars.find((c) => c.owner === "Mayrik" && c.size === "medium");
  myMedium.col = 15; myMedium.row = 2; myMedium.status = CAR_STATUS.INOPERABLE; myMedium.damageTokens = ["skid"]; myMedium.movedThisRound = true;

  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
  const car = ctx.activatableCars[0]; // la seule voiture encore opérable et pas activée (small)
  const dieValue = 4;
  const remaining = ctx.pool.filter((v) => v !== dieValue);
  const myInoperable = allCars.filter((c) => c.owner === "Mayrik" && c.status === CAR_STATUS.INOPERABLE);
  const commands = human.getAvailableCommands(remaining, myInoperable);
  const repairCmd = commands.find((c) => c.type === "repair");
  assert(repairCmd.eligibleTargets.length === 2, "Intégration Repair : les deux voitures inopérables sont proposées comme cibles");

  // Le joueur choisit délibérément celle qui est LA PLUS EN ARRIÈRE
  // (myLarge, col 5) — l'inverse de ce que l'IA choisirait dans le
  // même contexte (l'IA préfère celle en tête, myMedium, col 15).
  const chosenTarget = repairCmd.eligibleTargets.find((c) => c === myLarge);
  const options = human.getReachableOptions(board, car, dieValue, allCars, allChoppers);
  const destination = options.find((o) => o.terminalReason === "normal") || options[0];
  const decision = human.buildHumanDecision({ car, dieValue, command: { type: "repair", dieValue: 6, target: chosenTarget }, destination });

  const legality = checkDecisionLegality(decision, roundState.dicePool.Mayrik, "Mayrik");
  assert(legality.allOk === true, "Intégration Repair : décision légale (dé 6 bien dans le pool, distinct du dé de mouvement)");

  const result = executeDecision(progressionState, roundState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], "Mayrik", decision);
  assert(result.ok === true, "Intégration Repair : exécution réussie");
  assert(myLarge.status === CAR_STATUS.OPERABLE, "Intégration Repair : la voiture choisie par le joueur (et PAS celle que l'IA aurait choisie) est bien réparée");
  assert(myMedium.status === CAR_STATUS.INOPERABLE, "Intégration Repair : l'autre voiture inopérable reste inchangée");
  assert(roundState.commandUsedThisRound.Mayrik === true, "Intégration Repair : la Command du round est bien marquée comme utilisée");
}
{
  // Une décision illégale (dé pas dans le pool) doit être détectée
  // AVANT exécution — c'est tout l'intérêt de checkDecisionLegality
  // pour un client humain (contrairement au harnais self-play qui
  // logue et exécute quand même pour détecter les bugs de l'IA).
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
  const car = ctx.activatableCars[0];
  const options = human.getReachableOptions(board, car, 5, allCars, allChoppers); // 5 n'est PAS dans le pool [4,2,6,1]
  const destination = options[0];
  const decision = human.buildHumanDecision({ car, dieValue: 5, command: null, destination });
  const legality = checkDecisionLegality(decision, roundState.dicePool.Mayrik, "Mayrik");
  assert(legality.allOk === false && legality.dieInPool === false, "checkDecisionLegality : détecte un dé de mouvement qui n'est pas dans le pool, avant toute exécution");
}
{
  // Command avec le MÊME dé physique que le mouvement, alors qu'un
  // seul exemplaire de cette valeur existe dans le pool -> illégal.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  const board = buildBoardFromProgressionState(progressionState);
  const ctx = human.getTurnContext(progressionState, board, allCars, allChoppers, roundState.dicePool, "Mayrik", roundState);
  const car = ctx.activatableCars[0];
  const options = human.getReachableOptions(board, car, 2, allCars, allChoppers);
  const destination = options[0];
  const decision = human.buildHumanDecision({ car, dieValue: 2, command: { type: "nitro", dieValue: 2 }, destination });
  const legality = checkDecisionLegality(decision, roundState.dicePool.Mayrik, "Mayrik");
  assert(legality.allOk === false && legality.commandDieDistinct === false, "checkDecisionLegality : refuse d'utiliser deux fois le même dé physique (une seule occurrence de 2 dans le pool)");
}

console.log(`\n${passed} test(s) passé(s), ${failed} échec(s).`);

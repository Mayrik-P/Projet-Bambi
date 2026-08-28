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
const {
  checkDecisionLegality, executeDecision,
  executeAssignAndCommand, executeEntryStep, executeMoveStep, executeShoot, executeEndOfTurn
} = require("./turn-executor.js");

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
// SECTION 2bis — bonus Road (CORRECTIF : totalement absent de la
// première version — jamais proposé au joueur humain)
// -----------------------------------------------------------------
{
  const board = emptyBoard(); // tout ROAD par défaut
  const car = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const destAllRoad = { col: 8, row: 2, terminalReason: "normal", allRoad: true, dangerousCellsCrossed: 0, path: ["front", "front", "front"] };

  assert(human.isRoadBonusEligible(destAllRoad, 3) === true, "isRoadBonusEligible : éligible si trajet 100% route, sans case dangereuse, et dé Road > 0");
  assert(human.isRoadBonusEligible(destAllRoad, 0) === false, "isRoadBonusEligible : jamais éligible si aucun dé Road n'a été tiré ce round (roadDieValue=0)");

  const destWithDanger = { ...destAllRoad, dangerousCellsCrossed: 1 };
  assert(human.isRoadBonusEligible(destWithDanger, 3) === false, "isRoadBonusEligible : inéligible si une case dangereuse a été traversée");

  const destOffRoad = { ...destAllRoad, allRoad: false };
  assert(human.isRoadBonusEligible(destOffRoad, 3) === false, "isRoadBonusEligible : inéligible si le trajet n'est pas resté 100% sur route");

  const destSlam = { ...destAllRoad, terminalReason: "slam" };
  assert(human.isRoadBonusEligible(destSlam, 3) === false, "isRoadBonusEligible : inéligible si le mouvement de base s'est terminé par un Slam");

  const options = human.getRoadBonusOptions(board, car, destAllRoad, 3, [car], []);
  assert(options.length > 0, "getRoadBonusOptions : propose des destinations quand éligible");
  assert(options.every((o) => o.stepsUsed === 3), "getRoadBonusOptions : l'extension avance bien d'exactement le dé Road (\"must use the full amount\", p.7) — jamais moins");

  const noOptions = human.getRoadBonusOptions(board, car, destOffRoad, 3, [car], []);
  assert(noOptions.length === 0, "getRoadBonusOptions : liste vide si non éligible (pas d'exception, pas de crash)");

  // L'extension "n'a pas besoin d'être sur route" (p.7) — un terrain
  // varié après la destination de base reste valide.
  const boardMixed = emptyBoard();
  boardMixed.grid[2][8].terrain = TERRAIN.MUD;
  boardMixed.grid[2][9].terrain = TERRAIN.OFF_ROAD;
  const mixedOptions = human.getRoadBonusOptions(boardMixed, car, destAllRoad, 3, [car], []);
  assert(mixedOptions.length > 0, "getRoadBonusOptions : l'extension n'est PAS tenue de rester sur route elle-même");
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
  inoperable1.damageTokens = ["dent", "dent"]; // état réaliste : inopérable = 2 jetons (p.6)
  const inoperable2 = createCar("A", CAR_SIZE.LARGE, 15, 2); // "en tête" -> l'IA la choisirait d'office, ici les DEUX doivent être proposées
  inoperable2.status = CAR_STATUS.INOPERABLE;
  inoperable2.damageTokens = ["dent", "dent"];
  const r = human.getAvailableCommands([6], [inoperable1, inoperable2]);
  const repairCmd = r.find((c) => c.type === "repair");
  assert(!!repairCmd, "getAvailableCommands : Repair proposé avec un 6 et au moins une voiture inopérable");
  assert(repairCmd.eligibleTargets.length === 2, "getAvailableCommands : TOUTES les voitures inopérables sont des cibles valides, pas une seule présélectionnée");
}
{
  // CORRECTIF (retour de Mayrik, 28/08, cf. livret p.8 : "Remove one
  // damage token from ANY of your cars [...] That car becomes
  // operable if it was inoperable") — une voiture encore OPÉRABLE
  // mais portant 1 seul jeton de dégât est une cible Repair tout
  // aussi légale qu'une voiture inopérable : la règle ne restreint
  // JAMAIS la cible aux seules voitures inopérables, contrairement à
  // ce que l'ancienne implémentation supposait.
  const lightlyDamaged = createCar("A", CAR_SIZE.MEDIUM, 5, 1);
  lightlyDamaged.status = CAR_STATUS.OPERABLE;
  lightlyDamaged.damageTokens = ["dent"]; // 1 seul jeton, toujours opérable
  const r = human.getAvailableCommands([6], [lightlyDamaged]);
  const repairCmd = r.find((c) => c.type === "repair");
  assert(!!repairCmd, "getAvailableCommands : Repair proposé pour une voiture ENCORE OPÉRABLE avec seulement 1 dégât (pas besoin d'être inopérable)");
  assert(repairCmd && repairCmd.eligibleTargets[0] === lightlyDamaged, "getAvailableCommands : la voiture légèrement endommagée est bien une cible valide");
}
{
  // Non-régression : une voiture SANS AUCUN dégât n'est jamais une
  // cible Repair valide (rien à retirer).
  const undamaged = createCar("A", CAR_SIZE.SMALL, 2, 0);
  const r = human.getAvailableCommands([6], [undamaged]);
  assert(!r.some((c) => c.type === "repair"), "getAvailableCommands : pas de Repair pour une voiture sans aucun dégât");
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
  // Intégration Nitro + bonus Road ensemble (les deux corrections
  // trouvées par Mayrik en testant le prototype réel) : dé mouvement
  // 5 + Nitro 3 = 8 cases obligatoires, PUIS bonus Road (+2, trajet
  // resté 100% route) proposé et pris.
  const progressionState = createTileProgressionState(createTestTile(24, 6), createTestTile(24, 6), createTestTile(24, 6));
  const board = buildBoardFromProgressionState(progressionState);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  // Un second joueur (même hors-jeu du point de vue de ce test) est
  // nécessaire : sinon "dernier joueur encore en jeu" se déclenche à
  // tort dès ce tour et coupe l'exécution avant le bonus Road.
  const dummyOpponent = createCar("IA-Adverse", CAR_SIZE.SMALL, 0, 0);
  const allCars = [car, dummyOpponent];
  const allChoppers = [];
  const roundState = createRoundState(["Mayrik", "IA-Adverse"], { Mayrik: [5, 3, 2, 1], "IA-Adverse": [1, 1, 1, 1] });
  roundState.roundNumber = 2;
  roundState.roadDie = 2;

  const dieValue = 5, nitroValue = 3;
  const withNitro = human.getReachableOptions(board, car, dieValue + nitroValue, allCars, allChoppers);
  assert(withNitro.some((o) => o.stepsUsed === 8), "Intégration Nitro : les options atteignables reflètent bien dé+Nitro cumulés (8 cases), pas le dé seul");
  const destination = withNitro.find((o) => o.terminalReason === "normal" && o.allRoad === true && o.dangerousCellsCrossed === 0);

  assert(human.isRoadBonusEligible(destination, roundState.roadDie) === true, "Intégration Road : la destination Nitro (100% route) reste éligible au bonus Road");
  const bonusOptions = human.getRoadBonusOptions(board, car, destination, roundState.roadDie, allCars, allChoppers);
  const bonusChoice = bonusOptions[0];

  const decision = human.buildHumanDecision({ car, dieValue, command: { type: "nitro", dieValue: nitroValue }, destination, roadBonusPath: bonusChoice.path });
  const legality = checkDecisionLegality(decision, roundState.dicePool.Mayrik, "Mayrik");
  assert(legality.allOk === true, "Intégration Nitro+Road : décision légale");

  const result = executeDecision(progressionState, roundState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], "Mayrik", decision);
  assert(result.ok === true, "Intégration Nitro+Road : exécution réussie");
  assert(car.col === bonusChoice.col && car.row === bonusChoice.row, "Intégration Nitro+Road : la voiture atterrit bien sur la case d'arrivée du bonus Road (au-delà des 8 cases du mouvement Nitro)");
  assert(car.col > destination.col, "Intégration Nitro+Road : la voiture a bien progressé AU-DELÀ de la destination Nitro grâce au bonus Road");
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

// ===================================================================
// SECTION 6 — MOUVEMENT CASE PAR CASE (Point 3, retour de Mayrik)
// ===================================================================
{
  // Cas de base : les 3 cases de l'arc avant, toutes route, assez de
  // mouvement restant -> les 3 sont proposées, coût 1, outcome normal.
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const options = human.getMovementStepOptions(board, car, 3, [car]);
  assert(options.length === 3, "getMovementStepOptions : les 3 cases de l'arc avant sont proposées sur route dégagée");
  assert(options.every((o) => o.terrain === TERRAIN.ROAD && o.cost === 1 && o.outcome === "normal"), "getMovementStepOptions : coût 1 et outcome 'normal' sur route dégagée");
}
{
  // Case Impassable dans l'arc avant : jamais une entrée volontaire ->
  // exclue de la liste (pas juste déconseillée).
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const frontArc = engine.getFrontArc(car);
  const frontCell = frontArc.find((a) => a.name === "front");
  board.grid[frontCell.row][frontCell.col].terrain = TERRAIN.IMPASSABLE;
  const options = human.getMovementStepOptions(board, car, 3, [car]);
  assert(options.length === 2, "getMovementStepOptions : une case Impassable est exclue (jamais une entrée volontaire)");
  assert(!options.some((o) => o.direction === "front"), "getMovementStepOptions : la direction menant à l'Impassable n'apparaît pas du tout");
}
{
  // Boue (coût 2) avec 1 seul point restant -> exception p.7 : la case
  // reste proposée, au coût réduit au restant (1).
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const frontArc = engine.getFrontArc(car);
  const frontCell = frontArc.find((a) => a.name === "front");
  board.grid[frontCell.row][frontCell.col].terrain = TERRAIN.MUD;
  const optionsWith1 = human.getMovementStepOptions(board, car, 1, [car]);
  const optionsWith2 = human.getMovementStepOptions(board, car, 2, [car]);
  assert(optionsWith1.some((o) => o.direction === "front" && o.cost === 1), "getMovementStepOptions : exception Boue à 1 point restant — case proposée à coût 1");
  assert(optionsWith2.some((o) => o.direction === "front" && o.cost === 2), "getMovementStepOptions : Boue à coût normal (2) quand plus d'un point restant");
}
{
  // Coût de terrain > mouvement restant (hors exception Boue) -> case exclue.
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const frontArc = engine.getFrontArc(car);
  const frontCell = frontArc.find((a) => a.name === "front");
  board.grid[frontCell.row][frontCell.col].terrain = TERRAIN.MUD;
  const options = human.getMovementStepOptions(board, car, 1, [car]);
  const remaining0 = options.find((o) => o.direction === "front");
  assert(remaining0.cost === 1, "getMovementStepOptions : Boue avec 1 point restant reste proposée (exception)");
  const optionsNoBudget = human.getMovementStepOptions(board, { ...car }, 0, [car]);
  assert(optionsNoBudget.length === 0, "getMovementStepOptions : aucun mouvement restant -> aucune case proposée");
}
{
  // Case occupée par une voiture adverse dans l'arc avant -> outcome 'slam', jamais caché.
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const frontArc = engine.getFrontArc(car);
  const frontCell = frontArc.find((a) => a.name === "front");
  const occupant = createCar("IA-Adverse", CAR_SIZE.SMALL, frontCell.col, frontCell.row);
  const options = human.getMovementStepOptions(board, car, 3, [car, occupant]);
  const frontOption = options.find((o) => o.direction === "front");
  assert(frontOption.outcome === "slam", "getMovementStepOptions : une case occupée reste un choix légal, signalé comme 'slam'");
}
{
  // Sortie latérale (bord haut/bas du plateau) -> outcome 'eliminated-edge', reste un choix légal.
  const board = emptyBoard(24, 3, TERRAIN.ROAD); // 3 rangées : row 0 est au bord haut
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 0);
  const options = human.getMovementStepOptions(board, car, 3, [car]);
  const frontLeft = options.find((o) => o.direction === "front-left");
  assert(frontLeft.outcome === "eliminated-edge", "getMovementStepOptions : sortie latérale en bord de plateau proposée avec outcome 'eliminated-edge'");
}
{
  // Sortie AVANT (bord de la tuile de tête) -> outcome 'exits-front', jamais une élimination.
  const board = emptyBoard(6, 6, TERRAIN.ROAD);
  const car = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2); // col 5 = dernière colonne (0..5)
  const options = human.getMovementStepOptions(board, car, 3, [car]);
  const front = options.find((o) => o.direction === "front");
  assert(front.outcome === "exits-front", "getMovementStepOptions : sortie par l'avant signalée comme 'exits-front', pas une élimination");
}

// ===================================================================
// SECTION 7 — ENTRÉE EN JEU CASE PAR CASE (colonne 0 entière)
// ===================================================================
{
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const options = human.getEntryRowOptions(board, 3, []);
  assert(options.length === 6, "getEntryRowOptions : toutes les rangées de la colonne 0 sont proposées (plateau tout en route)");
  assert(options.every((o) => o.cost === 1 && o.outcome === "normal"), "getEntryRowOptions : coût 1 et 'normal' sur route dégagée");
}
{
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  board.grid[2][0].terrain = TERRAIN.IMPASSABLE;
  const options = human.getEntryRowOptions(board, 3, []);
  assert(!options.some((o) => o.entryRow === 2), "getEntryRowOptions : une case Impassable en colonne 0 est exclue");
  assert(options.length === 5, "getEntryRowOptions : les 5 autres rangées restent proposées");
}
{
  const board = emptyBoard(24, 6, TERRAIN.ROAD);
  const occupant = createCar("IA-Adverse", CAR_SIZE.SMALL, 0, 1);
  const options = human.getEntryRowOptions(board, 3, [occupant]);
  const row1 = options.find((o) => o.entryRow === 1);
  assert(row1.outcome === "slam", "getEntryRowOptions : une rangée d'entrée occupée reste proposée, signalée 'slam'");
}

// ===================================================================
// SECTION 8 — CIBLE DE TIR LIBRE
// ===================================================================
{
  const shooter = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const frontArc = engine.getFrontArc(shooter);
  const frontCell = frontArc.find((a) => a.name === "front");
  const enemyInArc = createCar("IA-Adverse", CAR_SIZE.SMALL, frontCell.col, frontCell.row);
  const enemyOutOfArc = createCar("IA-Adverse", CAR_SIZE.SMALL, 10, 5);
  const ownCarInArc = createCar("Mayrik", CAR_SIZE.LARGE, frontArc.find((a) => a.name === "front-left").col, frontArc.find((a) => a.name === "front-left").row);
  const eliminatedInArc = createCar("IA-Adverse", CAR_SIZE.SMALL, frontArc.find((a) => a.name === "front-right").col, frontArc.find((a) => a.name === "front-right").row);
  eliminatedInArc.status = CAR_STATUS.ELIMINATED;
  const chopper = createChopper("IA-Adverse");
  chopper.col = frontCell.col; chopper.row = frontCell.row; chopper.placed = true;

  const targets = human.getShootTargetOptions(shooter, [shooter, enemyInArc, enemyOutOfArc, ownCarInArc, eliminatedInArc]);
  assert(targets.length === 1 && targets[0] === enemyInArc, "getShootTargetOptions : seule la voiture adverse opérable dans l'arc avant est proposée (jamais sa propre voiture, une voiture hors arc, ou une voiture déjà éliminée)");
}
{
  const shooter = createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2);
  const targets = human.getShootTargetOptions(shooter, [shooter]);
  assert(targets.length === 0, "getShootTargetOptions : liste vide si aucune cible -> à l'appelant de proposer 'ne pas tirer'");
}

// ===================================================================
// SECTION 9 — EXÉCUTION PAS À PAS (turn-executor.js)
// ===================================================================
{
  // ASSIGN + COMMAND Nitro : le dé de mouvement ET le dé de Command
  // sont bien retirés du pool, effectiveDieValue inclut le bonus.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  const car = allCars.find((c) => c.owner === "Mayrik" && c.size === CAR_SIZE.MEDIUM);
  const result = executeAssignAndCommand(roundState, allCars, allChoppers, progressionState, "Mayrik", { car, dieValue: 4, command: { type: "nitro", dieValue: 2 }, isCoast: false });
  assert(result.effectiveDieValue === 4 + 2, "executeAssignAndCommand : Nitro (dé 2) ajoute bien le bonus attendu au dé de mouvement");
  assert(!roundState.dicePool.Mayrik.includes(4) && !roundState.dicePool.Mayrik.includes(2), "executeAssignAndCommand : les deux dés (mouvement + Command) sont retirés du pool");
  assert(roundState.commandUsedThisRound.Mayrik === true, "executeAssignAndCommand : la Command du round est marquée comme utilisée");
}
{
  // Entrée en jeu case par case : consomme le coût de la case
  // d'entrée, rend le reste du mouvement. Tuiles de TEST (sans hazard
  // caché) pour un résultat déterministe.
  const rear = createTestTile(24, 6), middle = createTestTile(24, 6), lead = createTestTile(24, 6);
  const progressionState = createTileProgressionState(rear, middle, lead);
  const car = createCarOffBoard("Mayrik", CAR_SIZE.MEDIUM);
  const allCars = [car];
  const board = buildBoardFromProgressionState(progressionState);
  const entryOptions = human.getEntryRowOptions(board, 4, allCars);
  const chosen = entryOptions[0];
  const result = executeEntryStep(progressionState, allCars, car, 4, chosen.entryRow, {});
  assert(result.ok === true, "executeEntryStep : entrée réussie");
  assert(car.col === 0 && car.row === chosen.entryRow, "executeEntryStep : la voiture est bien positionnée sur la rangée d'entrée choisie");
  assert(result.remaining === 4 - chosen.cost, "executeEntryStep : le mouvement restant reflète le coût de la case d'entrée");
}
{
  // Un pas de mouvement normal : le mouvement restant diminue
  // exactement du coût de ce pas, sans jamais imposer le reste du
  // trajet. Tuiles de TEST (sans hazard caché) pour un résultat
  // déterministe — contrairement aux tuiles réelles, dont le hasard
  // des hazards est justement testé plus loin par ailleurs.
  const rear = createTestTile(24, 6), middle = createTestTile(24, 6), lead = createTestTile(24, 6);
  const progressionState = createTileProgressionState(rear, middle, lead);
  const allCars = [createCar("Mayrik", CAR_SIZE.MEDIUM, 5, 2)];
  const allChoppers = [];
  const car = allCars[0];
  const board = buildBoardFromProgressionState(progressionState);
  const step1Options = human.getMovementStepOptions(board, car, 3, allCars);
  const step1 = step1Options.find((o) => o.outcome === "normal");
  const result1 = executeMoveStep(progressionState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], car, 3, step1.direction, {});
  assert(result1.ok === true, "executeMoveStep : un pas normal s'exécute normalement");
  assert(result1.moveResult.remaining === 3 - step1.cost, "executeMoveStep : le mouvement restant après un seul pas correspond exactement au coût de ce pas");
  assert(human.computePointsLost(3, step1, result1.moveResult.remaining) === 0, "computePointsLost : aucune perte sur un pas normal");
}
{
  // Un pas qui percute une voiture adverse (Slam) doit forcer l'arrêt
  // du mouvement (tous les points restants perdus) — détecté par
  // computePointsLost, jamais par le statut de la voiture.
  const rear = createTestTile(24, 6), middle = createTestTile(24, 6), lead = createTestTile(24, 6);
  const progressionState = createTileProgressionState(rear, middle, lead);
  const car = createCar("Mayrik", CAR_SIZE.LARGE, 5, 2);
  const opponent = createCar("IA-Adverse", CAR_SIZE.SMALL, 0, 0);
  const allCars = [car, opponent];
  const allChoppers = [];
  const board = buildBoardFromProgressionState(progressionState);
  const frontArc = engine.getFrontArc(car);
  const frontCell = frontArc.find((a) => a.name === "front");
  opponent.col = frontCell.col; opponent.row = frontCell.row;
  const options = human.getMovementStepOptions(board, car, 4, allCars);
  const slamOption = options.find((o) => o.outcome === "slam");
  const result = executeMoveStep(progressionState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], car, 4, slamOption.direction, { forcedDice: { slam: "top", direction: "front" } });
  assert(result.moveResult.remaining === 0, "executeMoveStep : plus aucun point de mouvement restant après un Slam");
  const lost = human.computePointsLost(4, slamOption, result.moveResult.remaining);
  assert(lost === 4 - slamOption.cost, "computePointsLost : détecte correctement les points perdus à cause du Slam (coût de la case payé, le reste forcé à 0)");
}
{
  // computePointsLost : devenir inopérable NE compte PAS comme une
  // perte si le mouvement a normalement continué (aucune règle ne dit
  // que les dégâts arrêtent le mouvement) — seul un écart RÉEL entre
  // le coût normal et le remaining obtenu doit compter.
  const optionNormal = { outcome: "normal", cost: 1 };
  assert(human.computePointsLost(3, optionNormal, 2) === 0, "computePointsLost : pas de perte si le remaining correspond exactement au coût normal, quel que soit le statut de la voiture par ailleurs");
}
{
  // Sortie latérale : toute la réserve restante est perdue.
  const optionEdge = { outcome: "eliminated-edge", cost: null };
  assert(human.computePointsLost(3, optionEdge, 0) === 3, "computePointsLost : sortie latérale/arrière -> tout le reste est perdu");
}
{
  // Sortie par l'avant : jamais une perte (décalage de tuile transparent).
  const optionFront = { outcome: "exits-front", cost: null };
  assert(human.computePointsLost(3, optionFront, 3) === 0, "computePointsLost : sortie par l'avant -> jamais une perte");
}
{
  // Tir : cible choisie -> résolu ; cible null -> aucun tir ; round 1
  // -> toujours refusé, même avec une cible valide.
  const { progressionState, allCars, allChoppers } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  const car = allCars.find((c) => c.owner === "Mayrik" && c.size === CAR_SIZE.MEDIUM);
  car.col = 5; car.row = 2;
  const opponent = allCars.find((c) => c.owner === "IA-Adverse" && c.size === CAR_SIZE.SMALL);
  const frontArc = engine.getFrontArc(car);
  opponent.col = frontArc[1].col; opponent.row = frontArc[1].row;

  const noShot = executeShoot(progressionState, allCars, allChoppers, car, null, 2);
  assert(noShot.shootResult === null, "executeShoot : cible null -> aucun tir résolu (le joueur choisit de ne pas tirer)");

  const round1Shot = executeShoot(progressionState, allCars, allChoppers, car, opponent, 1);
  assert(round1Shot.shootResult === null, "executeShoot : tir toujours refusé au round 1, même avec une cible valide");

  const realShot = executeShoot(progressionState, allCars, allChoppers, car, opponent, 2, { forcedDice: { shootingDie: "any" } });
  assert(realShot.shootResult.hit === true, "executeShoot : cible choisie librement par le joueur, tir résolu normalement");
}
{
  // Fin de tour : marque la voiture comme activée, avance le tour.
  const { progressionState, allCars, allChoppers, roundState } = freshProgressionSetup(["Mayrik", "IA-Adverse"], { Mayrik: [4, 2, 6, 1], "IA-Adverse": [1, 1, 1, 1] });
  const car = allCars.find((c) => c.owner === "Mayrik" && c.size === CAR_SIZE.MEDIUM);
  car.col = 5; car.row = 2;
  const before = roundState.currentPlayerIndex;
  const result = executeEndOfTurn(progressionState, roundState, allCars, allChoppers, ["Mayrik", "IA-Adverse"], car);
  assert(car.movedThisRound === true, "executeEndOfTurn : la voiture est bien marquée comme activée ce round");
  assert(result.gameOver === false, "executeEndOfTurn : pas de fin de partie dans ce scénario simple");
}

console.log(`\n${passed} test(s) passé(s), ${failed} échec(s).`);

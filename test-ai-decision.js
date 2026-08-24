/**
 * test-ai-decision.js — Tests unitaires du nouveau système de
 * décision IA (voir ai-decision.js pour l'architecture générale).
 */

"use strict";

const engine = require("./engine.js");
const ai = require("./ai-decision.js");

const { TERRAIN, CAR_SIZE, CAR_STATUS, createTestTile, createBoard, createCar, createCarOffBoard, createRoundState, createChopper } = engine;

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

// -----------------------------------------------------------------
// SECTION 1 — computeReachableDestinations
// -----------------------------------------------------------------

// 1. Plateau vide, dé=3 : doit atteindre exactement les cases à
// distance 3 (chevron), incluant les diagonales de bord (row -1/6).
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 4, 2);
  const dests = ai.computeReachableDestinations(board, car, 3, [car], []);
  const normal = dests.filter((d) => d.terminalReason === "normal");
  assert(normal.length > 0, "reachability : au moins une destination normale sur plateau vide");
  assert(normal.every((d) => d.stepsUsed === 3), "reachability : toute destination normale consomme exactement le dé (Road partout, coût 1)");
  assert(dests.some((d) => d.col === 7 && d.row === 2), "reachability : ligne droite (front×3) bien présente");
}

// 2. Un adversaire pile dans l'arc avant à distance 2 : doit
// apparaître comme candidat Slam, mouvement stoppé net.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 6, 2);
  const dests = ai.computeReachableDestinations(board, car, 5, [car, enemy], []);
  const slam = dests.find((d) => d.col === 6 && d.row === 2);
  assert(!!slam, "reachability : la case occupée par l'adversaire est bien un candidat");
  assert(slam.terminalReason === "slam", "reachability : terminalReason='slam' sur case occupée");
  assert(slam.slamTarget && slam.slamTarget.owner === "B", "reachability : slamTarget pointe vers la bonne voiture");
  assert(slam.stepsUsed === 2, "reachability : le Slam arrête le mouvement net (2 pas, pas 5)");
}

// 3. Case Impassable dans l'arc avant : candidat marqué éliminé, pas
// exclu de la liste (la couche reachability n'exclut jamais, elle
// étiquette seulement).
{
  const board = emptyBoard();
  board.grid[2][5].terrain = TERRAIN.IMPASSABLE;
  const car = createCar("A", CAR_SIZE.SMALL, 4, 2);
  const dests = ai.computeReachableDestinations(board, car, 3, [car], []);
  const imp = dests.find((d) => d.col === 5 && d.row === 2);
  assert(!!imp, "reachability : la case Impassable apparaît bien comme candidat");
  assert(imp.terminalReason === "eliminated-impassable", "reachability : terminalReason correct pour une case Impassable");
}

// 4. Boue : coût 2, sauf exception "dernier point de mouvement".
{
  const board = emptyBoard();
  board.grid[2][5].terrain = TERRAIN.MUD;
  const car = createCar("A", CAR_SIZE.SMALL, 4, 2);
  // Avec exactement 1 point restant en arrivant sur la boue (dé=1
  // depuis une case adjacente simulée ici directement) : exception
  // "vous pouvez entrer avec 1 seul point restant" (p.7).
  const carAdjacent = createCar("A", CAR_SIZE.SMALL, 4, 2);
  const dests1 = ai.computeReachableDestinations(board, carAdjacent, 1, [carAdjacent], []);
  const mudWith1 = dests1.find((d) => d.col === 5 && d.row === 2);
  assert(!!mudWith1 && mudWith1.terminalReason === "normal", "reachability : entrée en boue autorisée avec exactement 1 point restant (exception p.7)");
}

// 5. Hazard caché : compté dans dangerousCellsCrossed, jamais
// bloquant.
{
  const board = emptyBoard();
  board.grid[2][5].hazard = "wreck"; // jeton face cachée
  const car = createCar("A", CAR_SIZE.SMALL, 4, 2);
  const dests = ai.computeReachableDestinations(board, car, 3, [car], []);
  const throughHazard = dests.find((d) => d.col === 7 && d.row === 2);
  assert(!!throughHazard, "reachability : le passage à travers un hazard caché n'est jamais bloqué");
  assert(throughHazard.dangerousCellsCrossed === 1, "reachability : le hazard caché traversé est bien compté");
}

// 6. Bord latéral (row hors plateau) : élimination.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 4, 0); // déjà sur la rangée du haut
  const dests = ai.computeReachableDestinations(board, car, 2, [car], []);
  const edgeOut = dests.find((d) => d.row < 0);
  assert(!!edgeOut && edgeOut.terminalReason === "eliminated-edge", "reachability : sortie par le bord latéral = élimination");
}

// 7. Chopper : traversable en cours de route, éliminatoire seulement
// si c'est la case d'arrêt finale.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 4, 2);
  const chopper = { owner: "A", col: 5, row: 2, placed: true };
  const destsPassThrough = ai.computeReachableDestinations(board, car, 3, [car], [chopper]);
  const beyond = destsPassThrough.find((d) => d.col === 7 && d.row === 2);
  assert(!!beyond && beyond.terminalReason === "normal", "reachability : un chopper n'arrête pas le passage en cours de route");
  const destsStopOnChopper = ai.computeReachableDestinations(board, car, 1, [car], [chopper]);
  const onChopper = destsStopOnChopper.find((d) => d.col === 5 && d.row === 2);
  assert(!!onChopper && onChopper.terminalReason === "eliminated-chopper", "reachability : terminer SUR un chopper élimine");
}

// -----------------------------------------------------------------
// SECTION 2 — Slam statique
// -----------------------------------------------------------------

{
  const board = emptyBoard();
  const small = createCar("B", CAR_SIZE.SMALL, 6, 2);
  const medium = createCar("C", CAR_SIZE.MEDIUM, 6, 2);
  const large = createCar("D", CAR_SIZE.LARGE, 6, 2);
  const baseCand = (target) => ({ col: 6, row: 2, stepsUsed: 2, terminalReason: "slam", slamTarget: target });

  assert(ai.evaluateSlamCandidate(baseCand(small), 2, CAR_SIZE.LARGE, board).accept === true,
    "Slam : cible strictement plus petite → toujours accepté");
  assert(ai.evaluateSlamCandidate(baseCand(large), 2, CAR_SIZE.SMALL, board).accept === false,
    "Slam : cible strictement plus grosse → toujours refusé");

  // Égalité de taille : dépend du nombre de cases dangereuses adjacentes.
  const boardSafe = emptyBoard(); // aucune case Impassable adjacente
  const boardRisky = emptyBoard();
  boardRisky.grid[1][6].terrain = TERRAIN.IMPASSABLE;
  boardRisky.grid[3][6].terrain = TERRAIN.IMPASSABLE;
  assert(ai.evaluateSlamCandidate(baseCand(medium), 2, CAR_SIZE.MEDIUM, boardSafe).accept === true,
    "Slam : égalité de taille, 0 case dangereuse adjacente → accepté");
  assert(ai.evaluateSlamCandidate(baseCand(medium), 2, CAR_SIZE.MEDIUM, boardRisky).accept === false,
    "Slam : égalité de taille, 2 cases dangereuses adjacentes (>1) → refusé");

  // Slam prématuré par rapport au dé assigné : toujours refusé,
  // indépendamment du matchup de taille.
  const earlyCand = { col: 6, row: 2, stepsUsed: 2, terminalReason: "slam", slamTarget: small };
  const evalEarly = ai.evaluateSlamCandidate(earlyCand, 6, CAR_SIZE.LARGE, board);
  assert(evalEarly.accept === false && evalEarly.tooEarly === true,
    "Slam : refusé si trop prématuré par rapport au dé assigné (perte de progression), même contre une cible plus petite");

  // Avant-dernier point de mouvement : accepté (bord inclus de la règle).
  const almostLastCand = { col: 6, row: 2, stepsUsed: 4, terminalReason: "slam", slamTarget: small };
  assert(ai.evaluateSlamCandidate(almostLastCand, 5, CAR_SIZE.LARGE, board).accept === true,
    "Slam : accepté sur l'AVANT-dernier point de mouvement (stepsUsed = dieValue-1)");
}

// -----------------------------------------------------------------
// SECTION 3 — partitionIntoBalancedLots
// -----------------------------------------------------------------
{
  const lots = ai.partitionIntoBalancedLots([6, 5, 3, 4], 3);
  assert(lots.length === 3, "lots : nombre de lots correct");
  assert(lots.every((l) => l.length > 0), "lots : chaque lot reçoit au moins 1 dé");
  const sums = lots.map((l) => l.reduce((s, v) => s + v, 0));
  assert(Math.max(...sums) - Math.min(...sums) <= 2, "lots : partition équilibrée (écart minimal)");
  assert(lots.flat().sort().join(",") === [3, 4, 5, 6].join(","), "lots : tous les dés du pool sont utilisés, aucun perdu/dupliqué");
}
{
  const lots = ai.partitionIntoBalancedLots([4], 1);
  assert(lots.length === 1 && lots[0].join(",") === "4", "lots : cas trivial à 1 lot");
}

// -----------------------------------------------------------------
// SECTION 4 — decideCommandForActivatedCar
// -----------------------------------------------------------------
{
  const board = emptyBoard();
  const progressionState = { rearTile: { cols: 8 } };
  const car = createCar("A", CAR_SIZE.MEDIUM, 10, 2);
  const inoperable = createCar("A", CAR_SIZE.SMALL, 3, 2);
  inoperable.status = "inoperable";
  const r1 = ai.decideCommandForActivatedCar(car, progressionState, [inoperable], [car], [6, 4], [car, inoperable], "A");
  assert(r1 && r1.type === "repair" && r1.dieValue === 6 && r1.target === inoperable,
    "Command : Repair choisi quand un inopérable existe et un 6 est disponible");

  const carOnRear = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const r2 = ai.decideCommandForActivatedCar(carOnRear, progressionState, [], [carOnRear], [2, 5], [carOnRear], "A");
  assert(r2 && r2.type === "nitro" && r2.dieValue === 2,
    "Command : Nitro choisi (dé le plus gros ≤3) quand la voiture est sur la tuile Rear");

  const carFront = createCar("A", CAR_SIZE.MEDIUM, 15, 2);
  const carEvenMoreFront = createCar("A", CAR_SIZE.LARGE, 20, 2);
  const r3 = ai.decideCommandForActivatedCar(carFront, progressionState, [], [carFront, carEvenMoreFront], [5, 6], [carFront, carEvenMoreFront], "A");
  assert(r3 === null, "Command : aucune Command si ni Rear/arrière ni dé 1-3 pertinent");
}

// -----------------------------------------------------------------
// SECTION 5 — chooseLotRecipient
// -----------------------------------------------------------------
{
  const progressionState = { rearTile: { cols: 8 } };
  const rearCar = createCar("A", CAR_SIZE.SMALL, 3, 2);
  const midCar = createCar("A", CAR_SIZE.MEDIUM, 12, 2);
  const r1 = ai.chooseLotRecipient([rearCar, midCar], [rearCar, midCar], progressionState);
  assert(r1 === rearCar, "lotRecipient : voiture la plus arrière sur la tuile Rear reçoit le lot");

  const leaderCar = createCar("A", CAR_SIZE.LARGE, 20, 2);
  const rearCar2 = createCar("A", CAR_SIZE.SMALL, 12, 2);
  const closeEnemy = createCar("B", CAR_SIZE.MEDIUM, 17, 2);
  const r2 = ai.chooseLotRecipient([leaderCar, rearCar2], [leaderCar, rearCar2, closeEnemy], progressionState);
  assert(r2 === leaderCar, "lotRecipient : en tête + adversaire proche (<6) -> le leader reçoit le lot");

  const farEnemy = createCar("B", CAR_SIZE.MEDIUM, 5, 2);
  const r3 = ai.chooseLotRecipient([leaderCar, rearCar2], [leaderCar, rearCar2, farEnemy], progressionState);
  assert(r3 === rearCar2, "lotRecipient : en tête + adversaire loin -> le plus en arrière reçoit le lot");
}

// -----------------------------------------------------------------
// SECTION 6 — decideNoFinishLine (orchestrateur, branche générale)
// -----------------------------------------------------------------
{
  const board = emptyBoard();
  const progressionState = { rearTile: { cols: 8 } };
  const small = createCar("A", CAR_SIZE.SMALL, 4, 1);
  const medium = createCar("A", CAR_SIZE.MEDIUM, 6, 2);
  const large = createCar("A", CAR_SIZE.LARGE, 5, 3);
  const allCars = [small, medium, large];
  const dicePool = { A: [6, 5, 3, 4] };
  const roundState = { commandUsedThisRound: { A: false } };
  const d = ai.decideNoFinishLine(progressionState, board, allCars, [], dicePool, "A", roundState);
  assert(!!d && !!d.car, "decideNoFinishLine : retourne une décision complète (3 véhicules)");
  assert(d.car.owner === "A", "decideNoFinishLine : la voiture choisie appartient bien au joueur");
  assert(!d.isCoast, "decideNoFinishLine : pas un Coast quand des voitures restent éligibles");

  // Round Coast : aucune voiture éligible restante (toutes déjà bougées).
  small.movedThisRound = true; medium.movedThisRound = true; large.movedThisRound = true;
  const dCoast = ai.decideNoFinishLine(progressionState, board, allCars, [], { A: [3] }, "A", roundState);
  assert(dCoast && dCoast.isCoast === true, "decideNoFinishLine : Coast déclenché quand 0 véhicule éligible restant");
  assert(dCoast.dieValue === 3, "decideNoFinishLine : Coast utilise bien le dé assigné (valeur faciale non pertinente pour la distance)");
}

// -----------------------------------------------------------------
// SECTION 7 — decideFinishLineRush + decideAssignAndCommand (dispatch)
// -----------------------------------------------------------------
{
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const carNearFinish = createCar("A", CAR_SIZE.SMALL, 20, 2);
  const carMid = createCar("A", CAR_SIZE.MEDIUM, 10, 2);
  const carRear = createCar("A", CAR_SIZE.LARGE, 4, 2);
  const allCars2 = [carNearFinish, carMid, carRear];
  const dicePool2 = { A: [6, 5, 4, 3] };
  const roundState2 = { commandUsedThisRound: { A: false } };
  const d2 = ai.decideAssignAndCommand(progressionStateFL, board, allCars2, [], dicePool2, "A", roundState2);
  assert(d2.car === carNearFinish, "FinishLineRush : la voiture la plus avancée est activée en priorité");
  assert(d2.destination.col >= 24, "FinishLineRush : la ligne d'arrivée est bien atteinte directement (dé suffisant seul)");
  assert(d2.command === null, "FinishLineRush : pas de Command nécessaire quand le dé de base suffit déjà");
}
{
  // Ligne d'arrivée atteignable seulement AVEC Nitro.
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const carNeedsNitro = createCar("A", CAR_SIZE.SMALL, 20, 2); // besoin de 4, dé max dispo = 3 seul
  const allCars3 = [carNeedsNitro];
  const dicePool3 = { A: [3, 2, 1] }; // aucun dé seul >= 4, mais 3+1=4 -> Nitro possible
  const roundState3 = { commandUsedThisRound: { A: false } };
  const d3 = ai.decideAssignAndCommand(progressionStateFL, board, allCars3, [], dicePool3, "A", roundState3);
  assert(d3.destination.col >= 24, "FinishLineRush : ligne d'arrivée atteinte grâce au Nitro quand le dé seul ne suffit pas");
  assert(d3.command && d3.command.type === "nitro", "FinishLineRush : Command Nitro bien programmée pour atteindre l'arrivée");
}
{
  // Ligne d'arrivée atteignable seulement AVEC Drift (adversaires
  // bloquant TOUTES les directions viables du départ — Nitro ne
  // résout rien puisque le blocage est POSITIONNEL, pas une question
  // de budget, et aucune route de contournement n'existe ici).
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const carBlocked = createCar("A", CAR_SIZE.SMALL, 20, 0);
  const blocker1 = createCar("B", CAR_SIZE.SMALL, 21, 0); // front
  const blocker2 = createCar("B", CAR_SIZE.MEDIUM, 20, 1); // front-right (front-left hors plateau depuis row=0)
  const allCars4 = [carBlocked, blocker1, blocker2];
  const dicePool4 = { A: [5, 4, 2] };
  const roundState4 = { commandUsedThisRound: { A: false } };
  const d4 = ai.decideAssignAndCommand(progressionStateFL, board, allCars4, [], dicePool4, "A", roundState4);
  assert(d4.destination.col >= 24, "FinishLineRush : ligne d'arrivée atteinte grâce au Drift quand toutes les directions de départ sont bloquées");
  assert(d4.command && d4.command.type === "drift", "FinishLineRush : Command Drift bien programmée (Nitro ne peut rien résoudre ici, blocage positionnel)");
}
{
  // CORRECTIF (relecture complète de l'arbre avec Mayrik) : la Finish
  // Line, une fois en place, reste en place pour le reste de la
  // partie — decideFinishLineRush ne doit JAMAIS rebasculer vers
  // decideNoFinishLine, y compris quand toutes les voitures opérables
  // ont déjà été activées ce round (ex-garde-fou "pool > véhicules
  // restants", supprimé car il provoquait cette bascule à tort). Dans
  // ce cas, on réactive en Coast la voiture opérable la plus EN AVANT
  // vers l'arrivée — jamais de Command sur un tour de Coast.
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const carFront = createCar("A", CAR_SIZE.SMALL, 20, 2);
  const carRear = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  carFront.movedThisRound = true;
  carRear.movedThisRound = true; // aucune voiture opérable "pas encore activée" ce round
  const allCars5 = [carFront, carRear];
  const dicePool5 = { A: [2, 2] }; // pool == nombre de véhicules (ex-garde-fou aurait basculé à tort)
  const roundState5 = { commandUsedThisRound: { A: false } };
  const d5 = ai.decideAssignAndCommand(progressionStateFL, board, allCars5, [], dicePool5, "A", roundState5);
  assert(d5.isCoast === true, "FinishLineRush/Coast : toutes voitures déjà activées -> réactivation en Coast, pas de bascule vers decideNoFinishLine");
  assert(d5.car === carFront, "FinishLineRush/Coast : c'est la voiture la plus EN AVANT qui est réactivée (objectif ligne d'arrivée), pas la plus en arrière");
  assert(d5.command === null, "FinishLineRush/Coast : aucune Command possible sur un tour de Coast");
  assert(d5.destination.stepsUsed === 1, "FinishLineRush/Coast : distance fixe de 1 case, quelle que soit la face du dé assigné");
}
{
  // MISE À JOUR DE L'ARBRE (nouveau PDF fourni par Mayrik) : le Coast
  // de la branche Finish Line recherche maintenant explicitement "la
  // case d'arrivée la moins dangereuse" parmi les destinations à 1
  // pas — pas juste la première trouvée. On place un hazard face
  // caché sur la case front-left pour vérifier que le Coast l'évite
  // au profit d'une case front/front-right sans hazard.
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const carFront = createCar("A", CAR_SIZE.SMALL, 20, 2);
  carFront.movedThisRound = true; // aucune voiture opérable "pas encore activée" ce round -> Coast
  const engineFrontArc = engine.getFrontArc({ col: carFront.col, row: carFront.row });
  const dangerousCell = engineFrontArc[0]; // front-left
  board.grid[dangerousCell.row][dangerousCell.col].hazard = "unknown"; // jeton face caché
  const allCars6 = [carFront];
  const dicePool6 = { A: [4] };
  const roundState6 = { commandUsedThisRound: { A: false } };
  const d6 = ai.decideAssignAndCommand(progressionStateFL, board, allCars6, [], dicePool6, "A", roundState6);
  assert(d6.isCoast === true, "FinishLineRush/Coast+hazard : toujours un Coast");
  assert(!(d6.destination.col === dangerousCell.col && d6.destination.row === dangerousCell.row), "FinishLineRush/Coast : la case la moins dangereuse est retenue, la case avec hazard face caché est évitée");
  assert(d6.destination.dangerousCellsCrossed === 0, "FinishLineRush/Coast : la destination retenue ne traverse aucune case dangereuse quand une alternative saine existe");
}


// -----------------------------------------------------------------
// SECTION 8 — RÉGRESSION : cohérence dieValue / destination.path
// -----------------------------------------------------------------
// Bug trouvé via le harnais de robustesse à grande échelle (vraies
// parties simulées) : dans decideFinishLineRush, quand un dé plus
// petit que celui initialement assigné permettait AUSSI d'atteindre
// une case de tir valide, le code changeait `dieValue` pour ce dé
// plus petit mais réutilisait la DESTINATION (et donc le chemin)
// calculée pour l'ancien dé plus gros — incohérence qui corrompait
// l'exécution réelle (voiture retrouvée hors des bornes du plateau
// après plusieurs tours). Ce test vérifie qu'à chaque fois que
// `dieValue` change, `destination.stepsUsed` correspond bien à CE
// dé précis, jamais à un autre.
{
  const board = emptyBoard();
  const progressionStateFL = { rearTile: { cols: 8 }, middleTile: { cols: 8 }, leadTile: { cols: 8 }, finishLineTile: {} };
  const car = createCar("A", CAR_SIZE.SMALL, 10, 2);
  const enemyNearFinish = createCar("B", CAR_SIZE.MEDIUM, 22, 2); // à moins de 10 cases de l'arrivée (24)
  const allCars = [car, enemyNearFinish];
  const dicePool = { A: [6, 3, 2] };
  const roundState = { commandUsedThisRound: { A: false } };
  const d = ai.decideAssignAndCommand(progressionStateFL, board, allCars, [], dicePool, "A", roundState);

  assert(!!d && !!d.destination, "régression dé/destination : une décision complète est bien retournée");
  if (d.destination && d.destination.terminalReason === "normal") {
    // Seul Nitro ajoute son dé au budget de MOUVEMENT — Airstrike et
    // Repair utilisent un dé séparé pour une action distincte, sans
    // rapport avec la distance parcourue par CETTE voiture.
    const totalBudget = d.dieValue + (d.command && d.command.type === "nitro" ? d.command.dieValue : 0);
    assert(d.destination.stepsUsed === totalBudget,
      `régression dé/destination : stepsUsed (${d.destination.stepsUsed}) doit correspondre exactement au budget de MOUVEMENT annoncé (dé ${d.dieValue}${d.command && d.command.type === "nitro" ? "+Nitro " + d.command.dieValue : ""} = ${totalBudget})`);
  }
}

// -----------------------------------------------------------------
// SECTION 9 — DRIFT (mise à jour de l'arbre, confirmée par Mayrik)
// -----------------------------------------------------------------
{
  // isFrontArcFullyBlocked : 3 cases occupées -> bloqué.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const blockers = [
    createCar("B", CAR_SIZE.SMALL, 5, 1),
    createCar("B", CAR_SIZE.SMALL, 6, 2),
    createCar("B", CAR_SIZE.SMALL, 5, 3)
  ];
  assert(ai.isFrontArcFullyBlocked(car, board, [car, ...blockers]) === true,
    "isFrontArcFullyBlocked : bloqué quand les 3 cases de l'arc avant sont occupées");
  assert(ai.isFrontArcFullyBlocked(car, board, [car, blockers[0], blockers[1]]) === false,
    "isFrontArcFullyBlocked : pas bloqué s'il reste au moins 1 case libre (front-right)");
}
{
  // decideDriftForLot : deuxième dé ≠ 1 -> Drift + mouvement avec l'autre dé.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 5, 2);
  const blockers = [
    createCar("B", CAR_SIZE.SMALL, 5, 1),
    createCar("B", CAR_SIZE.SMALL, 6, 2),
    createCar("B", CAR_SIZE.SMALL, 5, 3)
  ];
  const allCars = [car, ...blockers];
  const r1 = ai.decideDriftForLot(car, board, allCars, [4, 5], false);
  assert(r1 && r1.command && r1.command.type === "drift" && r1.command.dieValue === 4,
    "decideDriftForLot : Drift avec le plus PETIT dé valide (3/4/5) du lot");
  assert(r1.movementDie === 5, "decideDriftForLot : mouvement avec l'AUTRE dé du lot");

  // Deuxième dé == 1, PAS le dernier tour -> pas de Command, petit
  // dé (1) au mouvement, gros dé réservé (non consommé).
  const r2 = ai.decideDriftForLot(car, board, allCars, [4, 1], false);
  assert(r2 && r2.command === null, "decideDriftForLot : pas de Command si 2e dé=1 et pas dernier tour (Slam accepté)");
  assert(r2.movementDie === 1, "decideDriftForLot : mouvement avec le petit dé (1) dans ce cas");
  assert(r2.reserveDie === 4, "decideDriftForLot : le gros dé est bien signalé comme réservé pour plus tard");

  // Deuxième dé == 1, DERNIER tour -> Airstrike (petit dé) + mouvement (gros dé).
  const r3 = ai.decideDriftForLot(car, board, allCars, [4, 1], true);
  assert(r3 && r3.command && r3.command.type === "airstrike-pending" && r3.command.dieValue === 1,
    "decideDriftForLot : Airstrike (petit dé) au dernier tour du round, Drift inutile");
  assert(r3.movementDie === 4, "decideDriftForLot : mouvement avec le gros dé au dernier tour");

  // Pas bloqué -> null (retombe sur le flux normal).
  const openCar = createCar("A", CAR_SIZE.MEDIUM, 15, 2);
  const r4 = ai.decideDriftForLot(openCar, board, [openCar], [4, 5], false);
  assert(r4 === null, "decideDriftForLot : null quand l'arc avant n'est pas bloqué");

  // Bloqué mais aucun dé 3/4/5 dans le lot -> null (retombe sur Repair/Nitro habituel).
  const r5 = ai.decideDriftForLot(car, board, allCars, [6, 2], false);
  assert(r5 === null, "decideDriftForLot : null quand aucun dé 3/4/5 n'est disponible dans le lot");
}
{
  // computeReachableDestinations avec driftAvailable=true : le premier
  // véhicule rencontré peut être traversé sans y mettre fin au mouvement.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.SMALL, 0, 2);
  const blocker = createCar("B", CAR_SIZE.SMALL, 1, 2); // pile sur le 1er pas "front"
  const allCars = [car, blocker];

  const withoutDrift = ai.computeReachableDestinations(board, car, 3, allCars, [], false);
  const beyondBlocker = withoutDrift.find((d) => d.col === 3 && d.row === 2 && d.terminalReason === "normal");
  assert(!beyondBlocker, "computeReachableDestinations : sans Drift, impossible de dépasser le 1er véhicule");

  const withDrift = ai.computeReachableDestinations(board, car, 3, allCars, [], true);
  const beyondBlockerDrift = withDrift.find((d) => d.col === 3 && d.row === 2 && d.terminalReason === "normal");
  assert(!!beyondBlockerDrift, "computeReachableDestinations : avec Drift, on peut dépasser le 1er véhicule et continuer");
  const stillSlamOption = withDrift.find((d) => d.col === 1 && d.row === 2 && d.terminalReason === "slam");
  assert(!!stillSlamOption, "computeReachableDestinations : le Slam sur ce 1er véhicule reste une option valide si on choisit de s'arrêter là");
}

// -----------------------------------------------------------------
// SECTION 10 — chooseGeneralTrajectory : nouvelle cascade (2e arbre
// de Mayrik, clarifiée et validée cas par cas avec un viewer visuel
// avant implémentation — voir tools/analyze-new-trajectory.js et
// tools/trajectory-comparison.html pour la démarche de validation)
// -----------------------------------------------------------------
function getTerrainAt(board, dest) {
  const space = engine.getSpace(board, dest.col, dest.row);
  return space ? space.terrain : null;
}
{
  // Palier 1 (bonus Road) : une destination atteignable UNIQUEMENT en
  // acceptant le bonus Road (roadDieValue) doit être préférée à une
  // destination plus proche mais SANS bonus, tant que le trajet total
  // (base + extension) reste propre et sur route. Cf. Cas 2/3 validés
  // avec Mayrik : le bonus Road était systématiquement ignoré par
  // l'ancienne heuristique.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
  const allCars = [car];
  const withoutBonus = ai.chooseGeneralTrajectory(board, car, 2, allCars, [], false, 0);
  const withBonus = ai.chooseGeneralTrajectory(board, car, 2, allCars, [], false, 2);
  assert(withoutBonus.destination.col === 2, "chooseGeneralTrajectory : sans dé Road fourni, pas de bonus, arrêt normal au bout du dé assigné");
  assert(withBonus.destination.col === 4, "chooseGeneralTrajectory : bonus Road exploité quand tout le trajet (base+extension) reste sur route et propre");
  assert(!!withBonus.roadBonusPath && withBonus.roadBonusPath.length === 2, "chooseGeneralTrajectory : le chemin d'extension du bonus est bien renvoyé séparément (nécessaire à l'exécution réelle)");
}
{
  // Préférence de terrain PARMI les candidats bonus : Route > Off-Road > Mud,
  // un palier ne cédant au suivant que si celui-ci permet une progression
  // strictement meilleure (cf. arbre : cascade droite). Le blocage du
  // "front" direct force plusieurs candidats bonus à colonne égale,
  // certains sur Route, un sur Mud : la Route doit gagner.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
  const frontCell = engine.getFrontArc({ col: 0, row: 2 }).find((a) => a.name === "front");
  board.grid[frontCell.row][frontCell.col].terrain = TERRAIN.IMPASSABLE;
  board.grid[1][3].terrain = TERRAIN.MUD; // (3,1) devient Mud ; (3,0) reste Route, même colonne
  const result = ai.chooseGeneralTrajectory(board, car, 2, [car], [], false, 2);
  assert(getTerrainAt(board, result.destination) === TERRAIN.ROAD, "chooseGeneralTrajectory : une case Route à distance équivalente est préférée à une case Mud parmi les candidats bonus");
}
{
  // Palier 2 (sans bonus, départage par danger d'arrivée GRADUÉ) :
  // entre deux destinations propres à la même colonne, celle dont le
  // voisinage (arc avant+arrière) est moins dangereux doit gagner —
  // même si aucune des deux ne traverse de hazard sur son propre
  // chemin (dangerousCellsCrossed=0 pour les deux).
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.LARGE, 5, 2);
  const frontCell = engine.getFrontArc({ col: 5, row: 2 }).find((a) => a.name === "front");
  board.grid[frontCell.row][frontCell.col].terrain = TERRAIN.IMPASSABLE;
  const enemy = createCar("B", CAR_SIZE.MEDIUM, 6, 4); // en arc arrière d'un seul des candidats à égalité
  const allCars = [car, enemy];
  const result = ai.chooseGeneralTrajectory(board, car, 3, allCars, [], false, 0);
  const rearOfChosen = engine.getRearArc({ col: result.destination.col, row: result.destination.row });
  const enemyBehindChosen = rearOfChosen.some((r) => r.col === enemy.col && r.row === enemy.row);
  assert(!enemyBehindChosen, "chooseGeneralTrajectory : parmi des destinations à égalité de progression, celle avec le voisinage le moins dangereux (pas d'adversaire en arc arrière) est préférée");
}
{
  // Palier 3 (chemin forcé) : priorité à un Slam contre un adversaire
  // STRICTEMENT plus petit quand plusieurs candidats forcés sont à
  // égalité de danger de chemin — choix délibéré plutôt que subi (cf.
  // Cas 5 : lacune repérée par Mayrik, corrigée ici).
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.LARGE, 0, 2);
  const smallEnemy = createCar("B", CAR_SIZE.SMALL, 1, 2); // Slam accessible en 1 pas, strictement plus petit
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 6; r++) {
      if (!(c === 1 && r === 2)) board.grid[r][c].terrain = TERRAIN.IMPASSABLE;
    }
  }
  const allCars = [car, smallEnemy];
  const result = ai.chooseGeneralTrajectory(board, car, 2, allCars, [], false, 0);
  assert(result.destination.terminalReason === "slam" && result.slam, "chooseGeneralTrajectory : Slam contre un adversaire plus petit choisi comme destination quand c'est la seule voie forcée disponible");
  assert(result.destination.slamTarget.id === smallEnemy.id, "chooseGeneralTrajectory : la cible du Slam est bien le plus petit adversaire disponible");
}
{
  // Reciblage Slam sur l'arc arrière (mécanisme PRÉEXISTANT, non
  // modifié) : toujours actif quand aucun bonus Road n'a été utilisé.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
  const smallEnemy = createCar("B", CAR_SIZE.SMALL, 1, 3); // rear-right de la destination naturelle (2,2), plus petit
  const allCars = [car, smallEnemy];
  const result = ai.chooseGeneralTrajectory(board, car, 2, allCars, [], false, 0);
  assert(result.slam === true && result.destination.col === 1 && result.destination.row === 3, "chooseGeneralTrajectory : reciblage sur l'arc arrière toujours actif sans bonus Road (mécanisme préexistant préservé)");
}
{
  // LIMITE CONNUE ET DOCUMENTÉE : le reciblage sur l'arc arrière ne
  // s'applique PAS quand un bonus Road a été utilisé (l'arc arrière
  // du point d'arrêt de base n'a plus de sens une fois prolongé par
  // le bonus). Test de RÉGRESSION pour cette limite assumée.
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 0, 2);
  const smallEnemy = createCar("B", CAR_SIZE.SMALL, 1, 3); // serait en arc arrière du point de base (2,2)
  const allCars = [car, smallEnemy];
  const result = ai.chooseGeneralTrajectory(board, car, 2, allCars, [], false, 2); // bonus actif
  assert(result.destination.terminalReason === "normal" && !result.slam, "chooseGeneralTrajectory : le reciblage arc arrière est bien ignoré (limite documentée) quand un bonus Road est utilisé");
}

// -----------------------------------------------------------------
// SECTION 8 — ENTRÉE EN JEU (p.9) : computeReachableEntryDestinations
// et chooseEntryTrajectory
// -----------------------------------------------------------------
// CORRECTIF SESSION (bug signalé par Mayrik) : l'entrée était codée
// en dur sur la seule case d'entrée (stepsUsed:0, aucune suite de
// trajectoire), perdant tout le mouvement restant à chaque entrée —
// contraire à p.9 : "Each car's initial move is onto one of the
// spaces on the back edge of the rear tile" (l'entrée coûte le
// premier point de mouvement comme une case normale, PUIS le trajet
// continue avec les points restants).

// 1. Régression directe du bug signalé : sur route partout, un dé
// de 4 doit amener la voiture BIEN AU-DELÀ de la colonne 0 (avant :
// bloquée sur col 0 quel que soit le dé).
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const dests = ai.computeReachableEntryDestinations(board, 4, [car], []);
  const normal = dests.filter((d) => d.terminalReason === "normal");
  assert(normal.length > 0, "computeReachableEntryDestinations : au moins une destination normale");
  assert(normal.some((d) => d.col > 0), "computeReachableEntryDestinations : RÉGRESSION DU BUG — le mouvement continue bien au-delà de la colonne 0 (avant : toujours bloqué à col 0)");
  assert(normal.every((d) => d.stepsUsed === 4), "computeReachableEntryDestinations : le budget entier du dé est consommé (entrée + continuation), pas seulement 1 pas");
  assert(dests.some((d) => d.entryRow !== undefined), "computeReachableEntryDestinations : chaque candidat porte bien sa rangée d'entrée (entryRow)");
}

// 2. Coût de terrain à l'entrée : case de colonne 0 en boue (coût 2)
// avec un dé de 2 → doit s'arrêter PILE à l'entrée (budget épuisé par
// le coût de terrain, pas par une continuation).
{
  const board = emptyBoard();
  for (let r = 0; r < board.rows; r++) board.grid[r][0].terrain = TERRAIN.MUD;
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const dests = ai.computeReachableEntryDestinations(board, 2, [car], []);
  const atCol0 = dests.filter((d) => d.col === 0 && d.terminalReason === "normal");
  assert(atCol0.length > 0, "computeReachableEntryDestinations : entrée en boue avec dé=2 reste candidate");
  assert(atCol0.every((d) => d.stepsUsed === 1), "computeReachableEntryDestinations : le coût de terrain (boue=2) de l'entrée absorbe tout le dé en 1 seul pas");
}

// 3. Exception boue à 1 point restant (p.7) : dé=1 sur case de boue
// doit quand même permettre d'entrer (coût réduit à 1 par l'exception).
{
  const board = emptyBoard();
  for (let r = 0; r < board.rows; r++) board.grid[r][0].terrain = TERRAIN.MUD;
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const dests = ai.computeReachableEntryDestinations(board, 1, [car], []);
  assert(dests.some((d) => d.col === 0 && d.terminalReason === "normal"), "computeReachableEntryDestinations : exception boue p.7 — entrer avec dé=1 reste possible malgré le coût normal de 2");
}

// 4. Case de colonne 0 déjà occupée : doit apparaître comme candidat
// de Slam (comme n'importe quelle case occupée), pas être filtrée.
{
  const board = emptyBoard();
  const occupant = createCar("B", CAR_SIZE.SMALL, 0, 2);
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const dests = ai.computeReachableEntryDestinations(board, 3, [car, occupant], []);
  const slam = dests.find((d) => d.col === 0 && d.row === 2 && d.terminalReason === "slam");
  assert(!!slam, "computeReachableEntryDestinations : entrer sur une case occupée est un candidat de Slam valide");
  assert(slam.slamTarget && slam.slamTarget.owner === "B", "computeReachableEntryDestinations : le slamTarget pointe vers le bon véhicule");
  assert(slam.stepsUsed === 1, "computeReachableEntryDestinations : le Slam à l'entrée arrête net (1 pas, pas le dé entier)");
}

// 5. chooseEntryTrajectory bout-en-bout : sur route partout, la
// destination finale doit refléter une vraie progression (col > 0),
// pas un arrêt artificiel à l'entrée.
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const traj = ai.chooseEntryTrajectory(board, car, 4, [car], [], false, 0);
  assert(traj.destination.col > 0, "chooseEntryTrajectory : la destination choisie progresse bien au-delà de la colonne 0");
  assert(traj.destination.terminalReason === "normal", "chooseEntryTrajectory : arrêt normal (budget épuisé), pas un Slam ou une élimination sur ce plateau vide");
  assert(traj.shotTarget === null, "chooseEntryTrajectory : jamais de tir sur un tour d'entrée (round 1)");
}

// 6. Bonus Road à l'entrée : entrée sur route + dé Road disponible →
// la trajectoire doit se prolonger au-delà de ce que le seul dé
// assigné permettrait (mécanisme déjà supporté côté moteur, jamais
// branché côté décision avant ce correctif).
{
  const board = emptyBoard(); // route partout
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const withoutBonus = ai.chooseEntryTrajectory(board, car, 2, [car], [], false, 0);
  const withBonus = ai.chooseEntryTrajectory(board, car, 2, [car], [], false, 5);
  assert(withBonus.roadBonusPath !== null, "chooseEntryTrajectory : bonus Road bien détecté et appliqué à une entrée 100% route");
  assert(withBonus.destination.col > withoutBonus.destination.col, "chooseEntryTrajectory : le bonus Road prolonge bien la progression au-delà du dé assigné seul");
}

// 7. Intégration complète via decideNoFinishLine : une voiture pas
// encore entrée (col === null) doit recevoir isEntry:true ET une
// destination qui progresse réellement (pas juste la case d'entrée).
{
  const board = emptyBoard();
  const progressionState = { rearTile: { cols: 8 } };
  const entering = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const already = createCar("A", CAR_SIZE.SMALL, 4, 1);
  already.movedThisRound = true; // seule 'entering' reste éligible ce tour
  const allCars = [entering, already];
  const dicePool = { A: [5, 3, 2, 1] };
  const roundState = { commandUsedThisRound: { A: false }, turnsThisRound: { A: 0 } };
  const d = ai.decideAssignAndCommand(progressionState, board, allCars, [], dicePool, "A", roundState);
  assert(d.isEntry === true, "decideNoFinishLine (intégration) : isEntry bien signalé pour une voiture hors plateau");
  assert(d.destination.col > 0, "decideNoFinishLine (intégration) : RÉGRESSION DU BUG — la destination d'entrée progresse réellement, ne reste plus bloquée à col 0");
}

// -----------------------------------------------------------------
// SECTION 9 — dangerValueOfCell (étape 0 réécriture v3 : bordures
// différenciées, avant ≠ latéral/arrière — cf. docs/rewrite-plan.md)
// -----------------------------------------------------------------
// Chaque cas traduit directement getSpace()/enterAdjacentSpace() dans
// engine.js : row hors tuile → null (bord latéral, élimination) ;
// col hors tuile → undefined, avec col<0 = arrière (élimination) et
// col>=cols = avant (progression, PAS une élimination).
{
  const board = emptyBoard(); // 24 cols (0..23), 6 rows (0..5), route partout

  // 1. Bord AVANT (col >= cols) : sortie non-éliminatoire, doit valoir
  // 0 — comportement neuf, avant cette correction c'était 10 comme
  // n'importe quelle autre bordure.
  assert(ai.dangerValueOfCell(board, 24, 2, []) === 0, "dangerValueOfCell : bord AVANT (col=cols) = 0");
  assert(ai.dangerValueOfCell(board, 30, 3, []) === 0, "dangerValueOfCell : bord AVANT loin au-delà (col>>cols) = 0");

  // 2. Bord ARRIÈRE (col < 0) : élimination, doit valoir 9 (même
  // niveau qu'Impassable/latéral), pas 0 comme l'avant.
  assert(ai.dangerValueOfCell(board, -1, 2, []) === 9, "dangerValueOfCell : bord ARRIÈRE (col=-1) = 9");
  assert(ai.dangerValueOfCell(board, -5, 3, []) === 9, "dangerValueOfCell : bord ARRIÈRE loin (col<<0) = 9");

  // 3. Bord LATÉRAL haut/bas (row hors tuile) : élimination, = 9.
  assert(ai.dangerValueOfCell(board, 5, -1, []) === 9, "dangerValueOfCell : bord LATÉRAL haut (row=-1) = 9");
  assert(ai.dangerValueOfCell(board, 5, 6, []) === 9, "dangerValueOfCell : bord LATÉRAL bas (row=rows) = 9");

  // 4. Coins : row hors tuile prime sur col (getSpace teste row en
  // premier) → un coin avant+latéral doit rester 9, PAS 0 — la
  // distinction avant/arrière ne s'applique qu'à un col hors tuile
  // avec une row valide.
  assert(ai.dangerValueOfCell(board, 24, -1, []) === 9, "dangerValueOfCell : coin avant+latéral (row hors tuile prioritaire) = 9, pas 0");
  assert(ai.dangerValueOfCell(board, -1, 6, []) === 9, "dangerValueOfCell : coin arrière+latéral = 9");

  // 5. Non-régression : le reste de la table de danger (Impassable,
  // terrains nus) n'est pas affecté par cette correction.
  board.grid[2][5].terrain = TERRAIN.IMPASSABLE;
  assert(ai.dangerValueOfCell(board, 5, 2, []) === 9, "dangerValueOfCell : non-régression — Impassable = 9");
  assert(ai.dangerValueOfCell(board, 5, 3, []) === 0, "dangerValueOfCell : non-régression — Road = 0");
  board.grid[2][6].terrain = TERRAIN.OFF_ROAD;
  assert(ai.dangerValueOfCell(board, 6, 2, []) === 1, "dangerValueOfCell : non-régression — Off-Road = 1");
  board.grid[2][7].terrain = TERRAIN.MUD;
  assert(ai.dangerValueOfCell(board, 7, 2, []) === 2, "dangerValueOfCell : non-régression — Mud = 2");
}

// -----------------------------------------------------------------
// SECTION 10 — chooseBestTrajectory (Section 3C, "Recherche de la
// meilleure trajectoire", cascade unifiée v3 validée avec Mayrik le
// 24/08/2026)
// -----------------------------------------------------------------
// Les tests de cascade (10A) utilisent des candidats SYNTHÉTIQUES
// (pas computeReachableDestinations) : ça isole la logique de
// décision de la géométrie du plateau (les diagonales n'avancent pas
// en colonne selon la parité de ligne — cf. getFrontArc), et c'est
// justement permis par la fonction unifiée qui accepte une liste de
// candidats déjà calculée, peu importe leur origine.
function mkCandidate(col, row, opts = {}) {
  return {
    col, row,
    stepsUsed: opts.stepsUsed ?? 1,
    dangerousCellsCrossed: opts.dangerousCellsCrossed ?? 0,
    allRoad: opts.allRoad ?? false,
    terminalReason: opts.terminalReason ?? "normal",
    slamTarget: opts.slamTarget ?? null,
    path: opts.path ?? []
  };
}

// ---- 10A. Cascade sans bonus (8 paliers) ----

// A1. Palier T1 (100% route) gagne même face à un candidat non-route
// qui progresse strictement plus loin — présence seule, pas de
// comparaison (confirmé : clause de comparaison retirée par Mayrik).
{
  const board = emptyBoard(); // route partout
  board.grid[2][10].terrain = TERRAIN.OFF_ROAD;
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 }),   // T1 : route pure
    mkCandidate(10, 2, { allRoad: false, stepsUsed: 6 })  // Off-road, plus loin
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6, "chooseBestTrajectory T1 : route pure gagne même si off-road progresse plus loin (présence seule)");
}

// A2. T2 (route, chemin mixte) bat T3 (off-road) s'il progresse
// STRICTEMENT plus loin.
{
  const board = emptyBoard();
  board.grid[2][5].terrain = TERRAIN.OFF_ROAD; // T3, plus proche
  // col 6 reste ROAD (T2, plus loin)
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { allRoad: false, stepsUsed: 5 }), // T2 : route, col 6
    mkCandidate(5, 2, { allRoad: false, stepsUsed: 4 })  // T3 : off-road, col 5
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6, "chooseBestTrajectory T2 vs T3 : route gagne si strictement plus loin qu'off-road");
}

// A3. T2 tombe à T3 si off-road progresse plus loin (pas de
// comparaison globale — juste palier suivant).
{
  const board = emptyBoard();
  board.grid[2][5].terrain = TERRAIN.ROAD;      // T2, moins loin
  board.grid[2][8].terrain = TERRAIN.OFF_ROAD;  // T3, plus loin
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(5, 2, { stepsUsed: 4 }), // T2 : route, col 5
    mkCandidate(8, 2, { stepsUsed: 7 })  // T3 : off-road, col 8 (plus loin)
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 8, "chooseBestTrajectory T2 vs T3 : tombe à off-road quand il progresse plus loin");
}

// A4. Égalité stricte T2/T3 : route ne l'emporte QUE si strictement
// meilleure — une égalité fait tomber au palier suivant (off-road).
{
  const board = emptyBoard();
  board.grid[2][6].terrain = TERRAIN.ROAD;      // T2, col 6
  board.grid[3][6].terrain = TERRAIN.OFF_ROAD;  // T3, col 6 aussi (égalité)
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { stepsUsed: 5 }), // T2 : route, col 6
    mkCandidate(6, 3, { stepsUsed: 5 })  // T3 : off-road, col 6 (égalité)
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.row === 3, "chooseBestTrajectory T2 vs T3 : égalité de progression → tombe à off-road (pas 'strictement meilleur')");
}

// A5. T4 (mud) seul présent : gagne par défaut face aux paliers
// suivants vides (présence, transitivement, jusqu'à T5 vide aussi).
{
  const board = emptyBoard();
  board.grid[2][6].terrain = TERRAIN.MUD;
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [mkCandidate(6, 2, { stepsUsed: 5 })];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6 && result.destination.row === 2, "chooseBestTrajectory T4 : mud seul disponible est bien choisi");
}

// A6. T6 (destination Hazard dangereux, CHEMIN propre) : la case
// d'arrivée elle-même ne doit PAS compter dans le calcul de "chemin
// propre" (dangerousCellsCrossed inclut la case finale par
// construction — cf. doc de computeReachableDestinations).
{
  const board = emptyBoard();
  board.grid[2][6].hazard = "wreck"; // case dangereuse (jeton caché)
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { dangerousCellsCrossed: 1, stepsUsed: 5 }) // seule la case finale est dangereuse
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6, "chooseBestTrajectory T6 : destination Hazard dangereux avec chemin par ailleurs propre est acceptée (case finale exclue du calcul)");
}

// A7. T7 (destination Hazard dangereux, MÊME si chemin traverse un
// AUTRE hazard) : rattrape un candidat que T6 aurait rejeté (chemin
// réellement sale, pas juste la case finale).
{
  const board = emptyBoard();
  board.grid[2][6].hazard = "wreck"; // destination dangereuse
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    // dangerousCellsCrossed=2 : la case finale (1) + un AUTRE hazard
    // en route (1) → chemin réellement sale, T6 doit le rejeter.
    mkCandidate(6, 2, { dangerousCellsCrossed: 2, stepsUsed: 6 })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6, "chooseBestTrajectory T7 : rattrape une destination Hazard dangereux au chemin réellement sale (rejetée par T6)");
}

// A8. T8 (n'importe quelle case sauf impassable) : rattrape une
// destination sur terrain normal MAIS au chemin sale (donc rejetée
// par T1-T5, qui exigent tous un chemin propre).
{
  const board = emptyBoard(); // route partout, destination "propre" en terrain
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { dangerousCellsCrossed: 1, stepsUsed: 5 }) // route, mais chemin sale
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 6, "chooseBestTrajectory T8 : rattrape une destination route au chemin sale (rejetée par T1-T5)");
}

// A9. Dernier recours : aucun candidat normal/exits-front → la
// trajectoire la PLUS LONGUE vers une case impassable est choisie.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 2, { terminalReason: "eliminated-impassable", stepsUsed: 3 }),
    mkCandidate(9, 2, { terminalReason: "eliminated-impassable", stepsUsed: 5 })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.col === 9, "chooseBestTrajectory dernier recours : impassable le plus loin (col 9) retenu, pas le plus proche (col 6)");
}

// ---- 10B. Cascade BONUS route ----

// B1. Base gagnée sur T1 (route pure) + dé Road disponible : le
// bonus doit prolonger la trajectoire au-delà du dé de base (calcul
// RÉEL via computeReachableDestinations, pas synthétique — c'est
// justement ce mécanisme qu'on teste ici).
{
  const board = emptyBoard(); // route partout
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = ai.computeReachableDestinations(board, car, 3, [car], []);
  const result = ai.chooseBestTrajectory(board, car, candidates, 5, [car], []);
  assert(result.roadBonusUsed === true, "chooseBestTrajectory bonus : détecté et appliqué depuis une base T1 (route pure)");
  assert(result.destination.col === 12, "chooseBestTrajectory bonus : prolonge bien la trajectoire (3 + 5 = col 12 depuis col 4)");
}

// B2. Refus explicite du bonus si AUCUNE extension n'est possible
// (toutes les directions immédiatement bloquées) : on retombe sur la
// destination de base, sans erreur.
{
  const board = emptyBoard();
  // Bloque les 3 directions de l'arc avant depuis (7,2) (case
  // d'arrivée de la base ci-dessous) : aucune extension possible.
  board.grid[2][8].terrain = TERRAIN.IMPASSABLE; // front
  board.grid[1][7].terrain = TERRAIN.IMPASSABLE; // front-left
  board.grid[3][7].terrain = TERRAIN.IMPASSABLE; // front-right
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = ai.computeReachableDestinations(board, car, 3, [car], []);
  const result = ai.chooseBestTrajectory(board, car, candidates, 5, [car], []);
  assert(result.roadBonusUsed === false, "chooseBestTrajectory bonus : refus explicite bien détecté (aucune extension possible)");
  assert(result.destination.col === 7, "chooseBestTrajectory bonus : retombe sur la destination de base après refus");
}

// B3. Bonus jamais tenté si la base n'a PAS gagné sur route (ex.
// mud) — même avec un dé Road disponible.
{
  const board = emptyBoard(); // route partout au-delà, sauf la destination elle-même
  board.grid[2][6].terrain = TERRAIN.MUD;
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [mkCandidate(6, 2, { stepsUsed: 5 })];
  const result = ai.chooseBestTrajectory(board, car, candidates, 5, [car], []);
  assert(result.roadBonusUsed === false, "chooseBestTrajectory bonus : jamais tenté depuis une base non-route (mud)");
  assert(result.destination.col === 6, "chooseBestTrajectory bonus : destination mud inchangée, dé Road ignoré");
}

// ---- 10C. Départage par danger d'arrivée le plus faible ----

// C1. Deux candidats à égalité de progression (même palier, même
// colonne) : celui avec le danger d'arrivée le plus faible est
// retenu.
{
  const board = emptyBoard();
  board.grid[1][6].terrain = TERRAIN.ROAD; // (6,1) et (6,4) : même colonne
  board.grid[4][6].terrain = TERRAIN.ROAD;
  // Un hazard cache sur un voisin de (6,4) seulement → danger d'arrivée
  // plus élevé là-bas.
  const dangerousNeighbor = engine.getFrontArc({ col: 6, row: 4 })[0]; // front-left de (6,4)
  board.grid[dangerousNeighbor.row][dangerousNeighbor.col].hazard = "wreck";
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [
    mkCandidate(6, 1, { allRoad: true, stepsUsed: 5 }),
    mkCandidate(6, 4, { allRoad: true, stepsUsed: 5 })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.destination.row === 1, "chooseBestTrajectory départage : danger d'arrivée le plus faible retenu entre deux destinations à égalité");
}

// ---- 10D. Slam en arc arrière (recalculé sur la destination FINALE) ----
// CORRECTIF IMPORTANT (signalé par Mayrik) : une voiture ne se
// déplace JAMAIS directement vers une case de son arc arrière — seul
// l'arc AVANT est atteignable par un mouvement réel. Le retargeting
// ne fait donc que PRÉFÉRER un autre candidat déjà présent dans le
// pool passé à chooseBestTrajectory (donc déjà atteignable par un
// vrai chemin avant, terminalReason==='slam'), jamais une case
// inventée sur le plateau brut. Chaque test ci-dessous construit
// explicitement ce candidat "slam" concurrent.

// D1. Adversaire opérable STRICTEMENT plus petit sur un candidat
// "slam" déjà atteignable, positionné dans l'arc arrière de la
// destination par ailleurs préférée → retargeting vers CE candidat.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 5, 2); // "rear" de (6,2)
  const candidates = [
    mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 }),                                   // destination "propre" préférée par la cascade
    mkCandidate(5, 2, { terminalReason: "slam", slamTarget: enemy, stepsUsed: 1, path: ["front-left"] }) // atteignable par un AUTRE chemin avant, tombe dans l'arc arrière de (6,2)
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car, enemy], []);
  assert(result.slamTarget !== null && result.slamTarget.owner === "B", "chooseBestTrajectory Slam arc arrière : candidat slam atteignable détecté et préféré");
  assert(result.destination.col === 5 && result.destination.row === 2, "chooseBestTrajectory Slam arc arrière : destination reciblée sur ce candidat (avec son propre chemin réel)");
  assert(Array.isArray(result.destination.path) && result.destination.path.length === 1, "chooseBestTrajectory Slam arc arrière : le candidat retenu porte bien son propre chemin exécutable");
}

// D1bis. Un adversaire physiquement présent dans l'arc arrière mais
// SANS candidat "slam" correspondant dans le pool (case non
// atteignable par un chemin avant ce tour, ex. budget insuffisant)
// → PAS de retargeting, même si un adversaire plus petit est bien là.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 5, 2); // "rear" de (6,2), mais AUCUN candidat slam ne l'atteint dans le pool
  const candidates = [mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 })];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car, enemy], []);
  assert(result.slamTarget === null, "chooseBestTrajectory Slam arc arrière : adversaire présent mais non atteignable (pas de candidat slam) → aucun retargeting");
  assert(result.destination.col === 6 && result.destination.row === 2, "chooseBestTrajectory Slam arc arrière : destination d'origine conservée si le candidat slam n'existe pas dans le pool");
}

// D2. Aucun adversaire en arc arrière → destination inchangée.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const candidates = [mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 })];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car], []);
  assert(result.slamTarget === null, "chooseBestTrajectory Slam arc arrière : pas d'adversaire → aucun retargeting");
  assert(result.destination.col === 6 && result.destination.row === 2, "chooseBestTrajectory Slam arc arrière : destination d'origine conservée");
}

// D3. Candidat slam atteignable mais adversaire PAS strictement plus
// petit (égal ou plus grand) → pas de retargeting (règle confirmée :
// "plus petit" seul, pas de cas d'égalité ici contrairement à
// evaluateSlamCandidate).
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const equalEnemy = createCar("B", CAR_SIZE.MEDIUM, 5, 2);
  const candidates = [
    mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 }),
    mkCandidate(5, 2, { terminalReason: "slam", slamTarget: equalEnemy, stepsUsed: 1, path: ["front-left"] })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car, equalEnemy], []);
  assert(result.slamTarget === null, "chooseBestTrajectory Slam arc arrière : adversaire de taille égale → pas de retargeting");
  assert(result.destination.col === 6, "chooseBestTrajectory Slam arc arrière : destination d'origine conservée face à un adversaire de taille égale");
}

// D4. Plusieurs candidats slam atteignables dans l'arc arrière,
// adversaires plus petits de propriétaires différents : priorité à
// celui dont le PROPRIÉTAIRE a le moins de véhicules opérables.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemyB = createCar("B", CAR_SIZE.SMALL, 5, 1); // rear-left de (6,2)
  const enemyBExtra = createCar("B", CAR_SIZE.SMALL, 0, 0); // B a 2 véhicules opérables
  const enemyC = createCar("C", CAR_SIZE.SMALL, 5, 3); // rear-right de (6,2), C a 1 seul véhicule
  const candidates = [
    mkCandidate(6, 2, { allRoad: true, stepsUsed: 2 }),
    mkCandidate(5, 1, { terminalReason: "slam", slamTarget: enemyB, stepsUsed: 1, path: ["front-left"] }),
    mkCandidate(5, 3, { terminalReason: "slam", slamTarget: enemyC, stepsUsed: 1, path: ["front-right"] })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car, enemyB, enemyBExtra, enemyC], []);
  assert(result.slamTarget.owner === "C", "chooseBestTrajectory Slam arc arrière : priorité au propriétaire avec le moins de véhicules opérables");
}

// D5. Égalité de nombre de véhicules opérables entre propriétaires :
// départage par le véhicule le plus en avant de la course (colonne
// la plus grande). Destination sur une ligne IMPAIRE : sa case "rear"
// recule d'une colonne par rapport à "rear-left"/"rear-right" (seule
// configuration où les 3 cases de l'arc arrière ne sont pas toutes à
// la même colonne — cf. getRearArc).
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 3);
  const rearArc = engine.getRearArc({ col: 6, row: 3 });
  const spotRear = rearArc.find((s) => s.name === "rear");        // col 5 : en retrait
  const spotRearLeft = rearArc.find((s) => s.name === "rear-left"); // col 6 : plus avancé
  const enemyB = createCar("B", CAR_SIZE.SMALL, spotRear.col, spotRear.row);
  const enemyC = createCar("C", CAR_SIZE.SMALL, spotRearLeft.col, spotRearLeft.row);
  // B et C ont chacun exactement 1 véhicule opérable (égalité) — seule
  // la colonne les différencie.
  const candidates = [
    mkCandidate(6, 3, { allRoad: true, stepsUsed: 2 }),
    mkCandidate(spotRear.col, spotRear.row, { terminalReason: "slam", slamTarget: enemyB, stepsUsed: 1, path: ["rear"] }),
    mkCandidate(spotRearLeft.col, spotRearLeft.row, { terminalReason: "slam", slamTarget: enemyC, stepsUsed: 1, path: ["rear-left"] })
  ];
  const result = ai.chooseBestTrajectory(board, car, candidates, 0, [car, enemyB, enemyC], []);
  assert(result.slamTarget.owner === "C", "chooseBestTrajectory Slam arc arrière : égalité de véhicules opérables → le plus en avant (colonne la plus grande) l'emporte");
}

// D6. Bonus route utilisé + Slam arc arrière trouvé DANS l'extension
// (pas dans la base) : le retargeting doit chercher dans le pool de
// l'EXTENSION, pas celui de la base — et roadBonusPath doit refléter
// le chemin réel vers le candidat slam retenu (pas vers le candidat
// "propre" qu'il remplace). Coordonnées vérifiées empiriquement
// (l'ennemi ne doit pas bloquer le chemin direct de la destination
// "propre" préférée, sinon on ne teste plus la même chose).
{
  const board = emptyBoard(); // route partout
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 11, 1); // rear-left de (12,2), la destination bonus "propre" attendue (3+5 pas depuis col 4)
  const candidates = ai.computeReachableDestinations(board, car, 3, [car, enemy], []); // base : 3 pas, arrive en (7,2)
  const result = ai.chooseBestTrajectory(board, car, candidates, 5, [car, enemy], []); // bonus : 5 pas depuis (7,2)
  assert(result.roadBonusUsed === true, "chooseBestTrajectory Slam arc arrière + bonus : bonus bien appliqué");
  assert(result.slamTarget !== null && result.slamTarget.owner === "B", "chooseBestTrajectory Slam arc arrière + bonus : Slam trouvé dans le pool de l'EXTENSION, pas celui de la base");
  assert(result.destination.col === 11 && result.destination.row === 1, "chooseBestTrajectory Slam arc arrière + bonus : destination finale reciblée sur la case de l'adversaire");
  assert(result.destination.path.length === 3, "chooseBestTrajectory Slam arc arrière + bonus : destination.path reste le chemin de BASE (3 pas), jamais mélangé avec l'extension");
  assert(Array.isArray(result.roadBonusPath) && result.roadBonusPath.length === 5, "chooseBestTrajectory Slam arc arrière + bonus : roadBonusPath porte le chemin RÉEL (5 pas) vers le candidat slam retenu dans l'extension");
}

// -----------------------------------------------------------------
// SECTION 11 — computeShotTargetForDecision (étape 2 : le tir devient
// une étape générique post-mouvement, plus portée par chaque branche
// de décision — cf. docs/rewrite-plan.md)
// -----------------------------------------------------------------

// 1. Décision d'entrée (isEntry:true) : jamais de tir, quelle que
// soit la destination.
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const enemy = createCar("B", CAR_SIZE.SMALL, 5, 2);
  const decision = { car, destination: { col: 4, row: 2 }, isEntry: true };
  const result = ai.computeShotTargetForDecision(decision, [car, enemy]);
  assert(result === null, "computeShotTargetForDecision : jamais de tir sur une décision d'entrée");
}

// 2. Décision sans destination (passe forcée, etc.) : jamais de tir.
{
  const decision = { car: createCar("A", CAR_SIZE.MEDIUM, 4, 2), destination: null, isEntry: false };
  const result = ai.computeShotTargetForDecision(decision, []);
  assert(result === null, "computeShotTargetForDecision : pas de destination → pas de tir");
}

// 3. Décision normale avec un adversaire dans l'arc avant de la
// destination : cible bien trouvée.
{
  const board = emptyBoard();
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const enemy = createCar("B", CAR_SIZE.SMALL, 7, 2); // "front" de (6,2)
  const decision = { car, destination: { col: 6, row: 2 }, isEntry: false };
  const result = ai.computeShotTargetForDecision(decision, [car, enemy]);
  assert(result !== null && result.owner === "B", "computeShotTargetForDecision : adversaire dans l'arc avant de la destination bien trouvé");
}

// 4. Décision normale sans adversaire en vue : null, pas d'erreur.
{
  const car = createCar("A", CAR_SIZE.MEDIUM, 4, 2);
  const decision = { car, destination: { col: 6, row: 2 }, isEntry: false };
  const result = ai.computeShotTargetForDecision(decision, [car]);
  assert(result === null, "computeShotTargetForDecision : aucun adversaire en vue → null");
}

// -----------------------------------------------------------------
// SECTION 12 — decideFirstRound (étape 3 : branche "Premier round",
// validée avec Mayrik le 24/08/2026)
// -----------------------------------------------------------------

// 0. RÉGRESSION (bug trouvé en implémentant cette étape) :
// entryRow doit survivre au chemin bonus route — `chooseBestTrajectory`
// reconstruit `destination` à partir du pool d'EXTENSION (jamais un
// pool d'entrée, donc sans entryRow) quand le bonus est utilisé ; il
// doit le reporter explicitement depuis la destination de base.
{
  const board = emptyBoard(); // route partout : bonus quasi garanti
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const entryCandidates = ai.computeReachableEntryDestinations(board, 3, [car], []);
  const traj = ai.chooseBestTrajectory(board, car, entryCandidates, 5, [car], []);
  assert(traj.roadBonusUsed === true, "chooseBestTrajectory régression entryRow : bonus bien déclenché sur ce plateau (précondition du test)");
  assert(typeof traj.destination.entryRow === "number", "chooseBestTrajectory régression entryRow : entryRow préservé après reconstruction de la destination bonus");
}

// 1. Lot à 1 dé : entrée simple, pas de Command.
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const allCars = [car];
  const dicePool = { A: [4] }; // 1 seul dé dans le pool → lotCount=1 → 1 lot de 1 dé
  const roundState = createRoundState(["A"], { A: [4] });
  const decision = ai.decideFirstRound(null, board, allCars, [], dicePool, "A", roundState);
  assert(decision.command === null, "decideFirstRound : lot à 1 dé → pas de Command");
  assert(decision.dieValue === 4, "decideFirstRound : lot à 1 dé → le seul dé sert au mouvement");
  assert(decision.isEntry === true, "decideFirstRound : isEntry bien signalé");
}

// 2. Lot à 2 dés, au moins un dé 1-2-3 disponible : Nitro avec le
// PLUS GROS des dés éligibles (1-3), l'autre au mouvement.
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const allCars = [car];
  const dicePool = { A: [2, 6] }; // lotCount=1 → un seul lot = tout le pool = [2,6]
  const roundState = createRoundState(["A"], { A: [2, 6] });
  const decision = ai.decideFirstRound(null, board, allCars, [], dicePool, "A", roundState);
  assert(decision.command !== null && decision.command.type === "nitro", "decideFirstRound : lot à 2 dés avec un dé 1-3 → Command Nitro");
  assert(decision.command.dieValue === 2, "decideFirstRound : Nitro reçoit le dé éligible (2, le seul ≤3)");
  assert(decision.dieValue === 6, "decideFirstRound : l'autre dé (6) part au mouvement");
}

// 3. Lot à 2 dés, DEUX dés 1-2-3 disponibles : Nitro avec le PLUS
// GROS des deux (pas le plus petit).
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const allCars = [car];
  const dicePool = { A: [1, 3] };
  const roundState = createRoundState(["A"], { A: [1, 3] });
  const decision = ai.decideFirstRound(null, board, allCars, [], dicePool, "A", roundState);
  assert(decision.command.type === "nitro" && decision.command.dieValue === 3, "decideFirstRound : Nitro reçoit le PLUS GROS des deux dés éligibles (3, pas 1)");
  assert(decision.dieValue === 1, "decideFirstRound : l'autre dé (1) part au mouvement");
}

// 4. Lot à 2 dés, AUCUN dé 1-2-3 disponible : Airstrike avec le PLUS
// PETIT dé du lot, l'autre au mouvement, chopper placé devant
// l'adversaire opérable le plus en avant.
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const enemy = createCar("B", CAR_SIZE.SMALL, 10, 2);
  const allCars = [car, enemy];
  const dicePool = { A: [4, 6] }; // ni 4 ni 6 n'est ≤3
  const roundState = createRoundState(["A", "B"], { A: [4, 6] });
  const decision = ai.decideFirstRound(null, board, allCars, [], dicePool, "A", roundState);
  assert(decision.command !== null && decision.command.type === "airstrike", "decideFirstRound : lot à 2 dés sans dé 1-3 → Command Airstrike");
  assert(decision.command.dieValue === 4, "decideFirstRound : Airstrike reçoit le PLUS PETIT dé du lot (4)");
  assert(decision.dieValue === 6, "decideFirstRound : l'autre dé (6) part au mouvement");
  assert(decision.command.target.owner === "B", "decideFirstRound : Airstrike cible bien l'adversaire opérable le plus en avant");
  assert(decision.command.placement !== null, "decideFirstRound : un placement de chopper valide est bien trouvé");
}

// 5. Véhicule sélectionné = le plus GROS parmi les non-encore-activés
// (pas le premier du tableau, pas un ordre de position).
{
  const board = emptyBoard();
  const small = createCarOffBoard("A", CAR_SIZE.SMALL);
  const large = createCarOffBoard("A", CAR_SIZE.LARGE);
  const medium = createCarOffBoard("A", CAR_SIZE.MEDIUM);
  const allCars = [small, large, medium]; // ordre volontairement différent de la taille
  const dicePool = { A: [3, 3, 3] };
  const roundState = createRoundState(["A"], { A: [3, 3, 3] });
  const decision = ai.decideFirstRound(null, board, allCars, [], dicePool, "A", roundState);
  assert(decision.car.size === CAR_SIZE.LARGE, "decideFirstRound : la voiture la plus GROSSE est sélectionnée, indépendamment de l'ordre du tableau");
}

// 6. decideAssignAndCommand doit router le round 1 vers decideFirstRound,
// jamais vers decideNoFinishLine (bug confirmé : c'était le cas avant
// ce correctif — seul progressionState.finishLineTile était testé).
{
  const board = emptyBoard();
  const car = createCarOffBoard("A", CAR_SIZE.LARGE);
  const allCars = [car];
  const dicePool = { A: [4] };
  const roundState = createRoundState(["A"], { A: [4] });
  const progressionState = { finishLineTile: null };
  const viaDispatcher = ai.decideAssignAndCommand(progressionState, board, allCars, [], dicePool, "A", roundState);
  // Même entrée rejouée directement sur decideFirstRound (fonction
  // pure, déterministe) : doit produire exactement la même décision.
  const dicePool2 = { A: [4] };
  const roundState2 = createRoundState(["A"], { A: [4] });
  const direct = ai.decideFirstRound(progressionState, board, allCars, [], dicePool2, "A", roundState2);
  assert(viaDispatcher.car.id === direct.car.id, "decideAssignAndCommand : round 1 route bien vers decideFirstRound (même voiture retenue)");
  assert(viaDispatcher.dieValue === direct.dieValue, "decideAssignAndCommand : round 1 route bien vers decideFirstRound (même dé retenu)");
  assert(viaDispatcher.destination.col === direct.destination.col && viaDispatcher.destination.row === direct.destination.row, "decideAssignAndCommand : round 1 route bien vers decideFirstRound (même destination)");
}

console.log(`\n${passed} test(s) passé(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

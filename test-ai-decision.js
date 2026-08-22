/**
 * test-ai-decision.js — Tests unitaires du nouveau système de
 * décision IA (voir ai-decision.js pour l'architecture générale).
 */

"use strict";

const engine = require("./engine.js");
const ai = require("./ai-decision.js");

const { TERRAIN, CAR_SIZE, createTestTile, createBoard, createCar } = engine;

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

console.log(`\n${passed} test(s) passé(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

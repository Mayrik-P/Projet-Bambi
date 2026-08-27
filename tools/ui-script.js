"use strict";

// ===================================================================
// Prototype jouable — Phase 2, point 3 (retour d'usage de Mayrik).
// Aucune logique de jeu n'est réimplémentée ici : tout passe par les
// fonctions du bundle moteur (engine.js + ai-decision.js +
// human-decision.js + turn-executor.js, injectées juste au-dessus).
//
// Remplace complètement l'ancien flux (destination choisie d'un coup
// + cible de tir automatique) par un flux CASE PAR CASE :
//   - le joueur choisit chaque case une par une dans l'arc avant
//     COURANT de sa voiture (executeMoveStep/executeEntryStep,
//     appelés une fois par clic — jamais un chemin précalculé) ;
//   - le Bonus Road, une fois accepté, suit exactement la même boucle
//     case par case, avec son propre budget de points ;
//   - si un pas fait perdre des points de mouvement (Slam, Mine,
//     élimination, ou plus aucune case accessible), un message
//     explicite s'affiche avec un bouton "Continuer" — jamais un
//     enchaînement automatique qui masquerait ce qui vient de se
//     passer ;
//   - une fois le mouvement terminé, le joueur choisit librement sa
//     cible de tir (ou aucune) parmi les options légales.
// L'IA, elle, continue de jouer ses tours de façon atomique via
// executeDecision — aucun changement de ce côté.
// ===================================================================

const HUMAN = "Vous";
const OPPONENT = "IA";
const PLAYER_NAMES = [HUMAN, OPPONENT];
const OWNER_COLOR = { [HUMAN]: "#3b82c9", [OPPONENT]: "#c93b3b" };

// --- Géométrie du plateau (reprise à l'identique des viewers de debug) ---
const CELL_W = 34, CELL_H = 40, QUIN = 6, NOTCH = 4;
function cellPoly(col, row) {
  const rowTop = 20 + row * CELL_H;
  const rowBot = rowTop + CELL_H;
  const mid = (rowTop + rowBot) / 2;
  const left = (row % 2 === 0) ? 10 - QUIN : 10 + QUIN;
  const x0 = left + col * CELL_W;
  const rx = x0 + CELL_W + NOTCH;
  return [[x0, rowTop], [x0 + CELL_W, rowTop], [rx, mid], [x0 + CELL_W, rowBot], [x0, rowBot], [x0 + NOTCH, mid]];
}
function pts2s(p) { return p.map((v) => v[0].toFixed(1) + "," + v[1].toFixed(1)).join(" "); }
function cellCenter(col, row) {
  const p = cellPoly(col, row);
  const cx = (p[0][0] + p[1][0] + p[3][0] + p[4][0]) / 4 + NOTCH / 2;
  const cy = (p[0][1] + p[3][1]) / 2;
  return { cx, cy };
}
const TERRAIN_FILL = { road: "#4a4a55", off_road: "#7a5c3a", mud: "#3d2a1a", impassable: "#5c2020" };

// ===================================================================
// ÉTAT DE JEU — initialisation
// ===================================================================
let G = null; // { progressionState, allCars, allChoppers, roundState }
let sel = {}; // sélection/progression en cours de construction pour le tour humain
let fullLog = []; // journal cumulé affiché sous le plateau
let gameOver = false;
let gameOverInfo = null;

function newGame() {
  const rawTiles = loadRealTiles();
  let setup, attempts = 0;
  do { setup = setupTileProgressionFromRawData(rawTiles, { playerCount: 2 }); attempts++; } while (!setup.ok && attempts < 20);
  const progressionState = createTileProgressionState(setup.rearTile, setup.middleTile, setup.leadTile, setup.drawPile, { playerCount: 2 });
  const allCars = [];
  const allChoppers = [];
  for (const name of PLAYER_NAMES) {
    allChoppers.push(createChopper(name));
    allCars.push(createCarOffBoard(name, CAR_SIZE.SMALL));
    allCars.push(createCarOffBoard(name, CAR_SIZE.MEDIUM));
    allCars.push(createCarOffBoard(name, CAR_SIZE.LARGE));
  }
  const roundState = createRoundState(PLAYER_NAMES);
  G = { progressionState, allCars, allChoppers, roundState };
  sel = {};
  fullLog = [];
  gameOver = false;
  gameOverInfo = null;
}

function board() { return buildBoardFromProgressionState(G.progressionState); }

function pushLogLines(lines, turnLabel) {
  if (turnLabel) fullLog.push({ sep: turnLabel });
  for (const l of lines) fullLog.push({ line: l });
}

// Une seule séparation de tour affichée, même si le tour humain
// pousse maintenant son log en plusieurs fois (Assign+Command, chaque
// pas de mouvement, tir, fin de tour) plutôt qu'en un seul bloc comme
// avant.
function logTurn(lines) {
  const label = sel.turnStarted ? undefined : sel.turnLabel;
  pushLogLines(lines, label);
  sel.turnStarted = true;
}

function checkEnd() {
  const end = checkGameEndConditions(G.progressionState, G.allCars, G.allChoppers, PLAYER_NAMES);
  if (end && end.gameOver) {
    gameOver = true;
    gameOverInfo = end;
    pushLogLines(end.log || []);
  }
}

// ===================================================================
// TOUR DE L'IA — automatique, un clic pour déclencher (inchangé)
// ===================================================================
function playAiTurn() {
  ensureRoadDieRolled(G.roundState);
  const cp = getCurrentPlayer(G.roundState);
  if (!cp || cp !== OPPONENT) return;
  const b = board();
  const decision = decideAssignAndCommand(G.progressionState, b, G.allCars, G.allChoppers, G.roundState.dicePool, cp, G.roundState);
  if (!decision) {
    const log = [`${cp} : rien à jouer → passe forcée.`];
    advanceTurn(G.roundState, G.allCars).log.forEach((l) => log.push(l));
    pushLogLines(log, `Round ${G.roundState.roundNumber} — ${cp}`);
  } else {
    const result = executeDecision(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, cp, decision);
    pushLogLines(result.log || [], `Round ${G.roundState.roundNumber} — ${cp}`);
  }
  checkEnd();
  resetSelection();
  render();
}

// ===================================================================
// TOUR HUMAIN — ASSIGN / COMMAND (inchangé dans son principe : ces
// choix restent groupés AVANT tout mouvement, comme au livret p.8)
// ===================================================================
function resetSelection() {
  sel = { step: "die" };
}

function currentTurnContext() {
  ensureRoadDieRolled(G.roundState);
  const b = board();
  return getTurnContext(G.progressionState, b, G.allCars, G.allChoppers, G.roundState.dicePool, HUMAN, G.roundState);
}

function passHumanTurnIfImpossible(ctx) {
  if (ctx.canPlay) return false;
  const log = [`${HUMAN} : ${ctx.reason}`];
  advanceTurn(G.roundState, G.allCars).log.forEach((l) => log.push(l));
  pushLogLines(log, `Round ${G.roundState.roundNumber} — ${HUMAN}`);
  checkEnd();
  resetSelection();
  return true;
}

function pickDie(dieValue) {
  sel.dieValue = dieValue;
  sel.step = "car";
}

function pickCar(car) {
  sel.car = car;
  sel.step = (sel.mode === "assign" && sel.commandAvailable) ? "command" : "commit";
}

function pickCommandChoice(type) {
  if (type === "none") {
    sel.command = null;
    sel.step = "commit";
    return;
  }
  sel.commandType = type;
  sel.step = type === "repair" ? "repair-target" : "command-die";
}

function pickCommandDie(dieValue) {
  sel.commandDieValue = dieValue;
  if (sel.commandType === "airstrike") {
    sel.step = "airstrike-target";
  } else {
    sel.command = { type: sel.commandType, dieValue };
    sel.step = "commit";
  }
}

function pickRepairTarget(target) {
  sel.command = { type: "repair", dieValue: 6, target };
  sel.step = "commit";
}

function pickAirstrikeTarget(target) {
  sel.airstrikeTarget = target; // peut être null ("aucune cible visée")
  sel.step = "airstrike-placement";
}

function pickAirstrikePlacement(col, row) {
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: sel.airstrikeTarget || null, placement: { col, row } };
  sel.step = "commit";
}

// ===================================================================
// COMMIT — ASSIGN + COMMAND exécutés UNE FOIS (dés retirés du pool,
// Command résolue), point de non-retour : au-delà, "Annuler" n'est
// plus proposé (un dé assigné ne se rend pas, comme sur un vrai
// plateau). Démarre ensuite le mouvement interactif : entrée en jeu
// (colonne 0) si la voiture n'est pas encore sur le plateau, sinon
// directement le premier pas de l'arc avant.
// ===================================================================
function commitAssignAndCommand() {
  sel.turnLabel = `Round ${G.roundState.roundNumber} — ${HUMAN}`;
  sel.turnStarted = false;

  const intent = { car: sel.car, dieValue: sel.dieValue, command: sel.command || null, isCoast: sel.mode === "coast" };
  const { log, effectiveDieValue, slamOptions } = executeAssignAndCommand(G.roundState, G.allCars, G.allChoppers, G.progressionState, HUMAN, intent);
  logTurn(log);

  sel.slamOptions = slamOptions;
  sel.remaining = intent.isCoast ? 1 : effectiveDieValue;
  sel.roadEligible = true; // accumulé pas à pas (ET logique) tout au long du mouvement
  sel.hadSlam = false; // un Slam met fin à la phase de mouvement complète (p.9) : plus de bonus Road possible ensuite
  sel.hadDamage = false; // p.9/p.12 : "A car loses its remaining moves when it takes damage" — même effet que le Slam sur le bonus Road, quelle que soit la source du dégât (aujourd'hui, uniquement la Mine)
  sel.roadBonusOffered = false;
  sel.inRoadBonus = false;

  if (sel.car.col === null && !intent.isCoast) {
    sel.step = "entry-row";
  } else {
    sel.step = "move-step";
  }
  checkEnd();
  if (!gameOver) checkStuckAtMovementStart();
}

// Vérifie qu'il existe au moins une case légale pour le tout PREMIER
// pas du mouvement (entrée en jeu ou arc avant initial) — cas limite
// distinct de celui déjà géré dans handleStepResult (qui, lui, vérifie
// APRÈS chaque pas si le suivant reste possible) : ici, aucun pas n'a
// encore été joué, donc rien dans le log ne peut expliquer un blocage.
// Sans ce contrôle, une voiture dont les 3 cases de l'arc avant sont
// Impassable (ou dont toute la colonne d'entrée l'est) affichait
// "Choisissez la prochaine case" SANS AUCUNE case cliquable et SANS
// AUCUN moyen de continuer — trouvé en pilotant réellement le
// prototype (jsdom), jamais en relisant le code.
function checkStuckAtMovementStart() {
  if (sel.step === "entry-row") {
    const options = getEntryRowOptions(board(), sel.remaining, G.allCars);
    if (options.length === 0) {
      sel.step = "movement-stopped";
      sel.stopMessage = buildStopMessage([], sel.remaining, "aucune case de la colonne d'entrée n'est accessible (toutes Impassable ou coût de terrain trop élevé)");
    }
  } else if (sel.step === "move-step") {
    const options = getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars);
    if (options.length === 0) {
      sel.step = "movement-stopped";
      sel.stopMessage = buildStopMessage([], sel.remaining, "aucune case de l'arc avant n'est accessible depuis la position actuelle (toutes Impassable ou coût de terrain trop élevé)");
    }
  }
}

// ===================================================================
// MOUVEMENT CASE PAR CASE (Point 3)
// ===================================================================

// Extrait {remainingAfter, roadEligible} d'un résultat d'entrée
// (forme plate) ou de mouvement (forme imbriquée sous .moveResult) —
// les deux fonctions renvoient des formes légèrement différentes
// (voir turn-executor.js), jamais réconciliées côté moteur pour ne
// pas risquer de régression sur le chemin IA qui les utilise aussi.
function extractStepOutcome(result, isEntryStep) {
  if (isEntryStep) return { remainingAfter: result.remaining, roadEligible: result.roadEligible, slam: result.slam };
  return {
    remainingAfter: result.moveResult ? result.moveResult.remaining : result.remaining,
    roadEligible: result.roadEligible,
    slam: result.moveResult ? result.moveResult.slam : result.slam
  };
}

function buildStopMessage(log, pointsLost, fallbackReason) {
  const tail = log.length > 0 ? log.slice(-3).join(" — ") : fallbackReason;
  const pointsLabel = pointsLost === 1 ? "1 mouvement perdu" : `${pointsLost} mouvements perdus`;
  return `${pointsLabel} — ${tail}`;
}

function buildTileAdvanceMessage(log) {
  // Ne garde que les lignes utiles à l'annonce (décalage, éliminations
  // sur la tuile rear retirée, choppers rendus) — pas le "sortie par
  // l'avant" générique qui précède, déjà implicite dans le titre.
  const relevant = log.filter((l) =>
    l.includes("retirée") || l.includes("Nouvelle tuile") || l.includes("Chopper de") || l.includes("Hazards de la tuile rear"));
  return relevant.length > 0 ? relevant.join(" — ") : "Décalage des tuiles effectué.";
}

// Point d'entrée commun après CHAQUE pas (entrée en jeu, mouvement
// normal, ou pas de Bonus Road — même mécanique dans les 3 cas).
// `remainingBefore`/`option` viennent de l'écran (déjà affichés au
// joueur avant son clic) ; `result`/`isEntryStep` viennent de
// l'exécution réelle du pas.
function handleStepResult(remainingBefore, option, result, isEntryStep) {
  logTurn(result.log || []);
  const { remainingAfter, roadEligible, slam } = extractStepOutcome(result, isEntryStep);
  sel.roadEligible = sel.roadEligible && !!roadEligible;
  sel.hadSlam = sel.hadSlam || !!slam;
  sel.remaining = remainingAfter;

  if (result.gameOver) {
    checkEnd();
    resetSelection();
    return;
  }

  // Sortie par l'avant de la tuile de tête : le décalage de tuile
  // (nouvelle tuile posée, tuile rear retirée avec tout véhicule
  // dessus éliminé, hazards défaussés, choppers rendus) vient de se
  // produire réellement dans le moteur — jamais silencieusement : on
  // l'annonce avant de laisser le joueur choisir sa vraie case sur la
  // nouvelle tuile (exactement comme au livret, p.11).
  if (!isEntryStep && option.outcome === "exits-front") {
    sel.step = "tile-advanced";
    sel.tileMessage = buildTileAdvanceMessage(result.log || []);
    return;
  }

  const car = sel.car;
  const pointsLost = computePointsLost(remainingBefore, option, remainingAfter);

  if (car.status === CAR_STATUS.ELIMINATED || pointsLost > 0) {
    sel.step = "movement-stopped";
    sel.stopMessage = buildStopMessage(result.log || [], pointsLost > 0 ? pointsLost : remainingBefore);
    return;
  }

  if (remainingAfter === 0) {
    proceedAfterMovement();
    return;
  }

  resumeMovementLoopOrStop(remainingAfter);
}

// Reprend la boucle de mouvement (move-step / road-bonus-step) si au
// moins une case reste légalement accessible depuis la position
// actuelle, sinon signale la perte des points restants — factorisé
// pour être appelé aussi bien après un pas normal qu'après l'annonce
// de nouvelle tuile (continueAfterTileAdvance).
function resumeMovementLoopOrStop(remainingAfter) {
  const nextOptions = getMovementStepOptions(board(), sel.car, remainingAfter, G.allCars);
  if (nextOptions.length === 0) {
    sel.step = "movement-stopped";
    sel.stopMessage = buildStopMessage([], remainingAfter, "plus aucune case accessible depuis la position actuelle");
    return;
  }
  sel.step = sel.inRoadBonus ? "road-bonus-step" : "move-step";
}

// Le joueur a pris connaissance de l'annonce de nouvelle tuile —
// reprend le mouvement là où il en était (mêmes points restants,
// jamais une perte : voir computePointsLost, "exits-front" -> 0).
function continueAfterTileAdvance() {
  resumeMovementLoopOrStop(sel.remaining);
}

// ===================================================================
// SLAM — APERÇU ET RELANCE (p.9, retour de Mayrik) — seul le TOUT
// PREMIER Slam d'un pas est proposé de façon interactive au joueur
// humain (voir previewSlam/decideSlamRerollDefault, human-decision.js
// et ai-decision.js) : un Slam en chaîne éventuel (nouvelle paire de
// voitures jamais prévisualisée) retombe automatiquement sur la même
// politique par défaut, faute de pouvoir mettre le moteur en pause une
// seconde fois dans le même appel.
function pickEntryRow(option) {
  if (option.outcome === "slam") { beginSlamSequence("entry", option, 0, option.entryRow); return; }
  executeEntryRowNow(option, sel.slamOptions);
}

function pickMoveStep(option) {
  if (option.outcome === "slam") { beginSlamSequence("move", option, option.col, option.row); return; }
  executeMoveStepNow(option, sel.slamOptions);
}

// Détecte un dégât reçu par la voiture ACTIVE pendant ce pas (p.9/p.12,
// "loses its remaining moves when it takes damage") en comparant le
// nombre de jetons de dégât avant/après — plutôt que de faire remonter
// une information dédiée depuis le moteur à travers plusieurs couches
// (moveCar → resolveHazard → applyDamage) rien que pour ce besoin.
// `sel.car` est le MÊME objet muté en place par le moteur (jamais une
// copie), donc cette comparaison est fiable quelle que soit la source
// du dégât (aujourd'hui, uniquement la Mine — cf. resolveHazard).
function detectDamageTaken(car, damageCountBefore, action) {
  const result = action();
  if (car.damageTokens.length > damageCountBefore) sel.hadDamage = true;
  return result;
}

function executeEntryRowNow(option, slamOptions) {
  const remainingBefore = sel.remaining;
  const damageBefore = sel.car.damageTokens.length;
  const result = detectDamageTaken(sel.car, damageBefore, () =>
    executeEntryStep(G.progressionState, G.allCars, sel.car, remainingBefore, option.entryRow, slamOptions));
  handleStepResult(remainingBefore, option, result, true);
}

function executeMoveStepNow(option, slamOptions) {
  const remainingBefore = sel.remaining;
  const damageBefore = sel.car.damageTokens.length;
  const result = detectDamageTaken(sel.car, damageBefore, () =>
    executeMoveStep(G.progressionState, G.allCars, G.allChoppers, PLAYER_NAMES, sel.car, remainingBefore, option.direction, slamOptions));
  handleStepResult(remainingBefore, option, result, false);
}

// Prévisualise le Slam à venir (aucun effet de bord, voir previewSlam)
// et décide s'il faut interrompre pour demander au joueur humain, ou
// appliquer directement la politique par défaut (tailles égales, ou
// voiture plus grande appartenant à l'IA).
function beginSlamSequence(kind, option, col, row) {
  const occupant = getCarAt(G.allCars, col, row, sel.car);
  const preview = previewSlam(sel.car, occupant);
  sel.pendingSlamStep = { kind, option };
  sel.slamPreview = preview;

  if (preview.rerollEligible && preview.largerCar.owner === HUMAN) {
    sel.step = "slam-reroll-choice";
    return;
  }
  resolveSlamSequence(decideSlamRerollDefault(preview));
}

// Le joueur a répondu (ou aucune décision n'était nécessaire) : on
// rejoue EXACTEMENT le même lancer initial déjà prévisualisé
// (forcedDice), avec sa réponse pour CE Slam précis — tout Slam en
// chaîne consécutif (paire de voitures différente) retombe sur la
// politique par défaut, jamais reposé au joueur une seconde fois.
function resolveSlamSequence(wantsReroll) {
  const { kind, option } = sel.pendingSlamStep;
  const preview = sel.slamPreview;
  const slamOptions = {
    ...sel.slamOptions,
    forcedDice: { slam: preview.slamRoll, direction: preview.directionRoll },
    decideReroll: (ctx) => (ctx.topCar === preview.topCar && ctx.bottomCar === preview.bottomCar) ? wantsReroll : decideSlamRerollDefault(ctx)
  };
  sel.pendingSlamStep = null;
  sel.slamPreview = null;
  if (kind === "entry") executeEntryRowNow(option, slamOptions);
  else executeMoveStepNow(option, slamOptions);
}

function pickSlamRerollChoice(wantsReroll) {
  resolveSlamSequence(wantsReroll);
}

// Le joueur a pris connaissance du message "mouvements perdus" —
// jamais d'enchaînement automatique avant ce clic explicite (demande
// de Mayrik).
function continueAfterStop() {
  if (sel.inRoadBonus) {
    proceedToShootPhase();
  } else {
    proceedAfterMovement();
  }
}

// ===================================================================
// APRÈS LE MOUVEMENT (principal OU Bonus Road) : Bonus Road d'abord
// (si éligible, jamais offert 2 fois), puis le tir.
// ===================================================================
function proceedAfterMovement() {
  const car = sel.car;
  if (!sel.roadBonusOffered && !sel.inRoadBonus && !sel.hadSlam && !sel.hadDamage && car.status === CAR_STATUS.OPERABLE && sel.roadEligible && G.roundState.roadDie) {
    sel.roadBonusOffered = true;
    sel.step = "road-bonus-choice";
    return;
  }
  proceedToShootPhase();
}

function acceptRoadBonus() {
  sel.inRoadBonus = true;
  sel.remaining = G.roundState.roadDie;
  const options = getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars);
  if (options.length === 0) {
    logTurn([`Bonus Road non appliqué : aucune case accessible pour les ${sel.remaining} case(s) imposées.`]);
    proceedToShootPhase();
    return;
  }
  sel.step = "road-bonus-step";
}

function declineRoadBonus() {
  proceedToShootPhase();
}

// ===================================================================
// TIR — cible librement choisie (ou aucune), jamais automatique.
// ===================================================================
function proceedToShootPhase() {
  const car = sel.car;
  if (G.roundState.roundNumber === 1) {
    logTurn([`Tir impossible : les armes ne sont pas encore actives au 1er round (p.10).`]);
    finishHumanTurn();
    return;
  }
  if (car.status !== CAR_STATUS.OPERABLE) {
    logTurn([`${car.id} n'est plus opérable → tir impossible.`]);
    finishHumanTurn();
    return;
  }
  sel.shootTargets = getShootTargetOptions(car, G.allCars);
  if (sel.shootTargets.length === 0) {
    logTurn([`Aucune cible à portée pour ${car.id} → tir automatiquement passé.`]);
    finishHumanTurn();
    return;
  }
  sel.step = "shoot";
}

function pickShootTarget(target) {
  const result = executeShoot(G.progressionState, G.allCars, G.allChoppers, sel.car, target, G.roundState.roundNumber);
  logTurn(result.log || []);
  finishHumanTurn();
}

function finishHumanTurn() {
  const result = executeEndOfTurn(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, sel.car);
  logTurn(result.log || []);
  if (result.gameOver) {
    gameOver = true;
    gameOverInfo = result;
  }
  resetSelection();
}

function cancelSelection() {
  resetSelection();
  render();
}

// ===================================================================
// RENDU
// ===================================================================
function isOnBoard(b, col, row) {
  return col >= 0 && col < b.cols && row >= 0 && row < b.rows;
}

// Sépare les options d'un pas en deux groupes : celles qui tombent sur
// une vraie case du plateau affiché (cliquables directement dessus),
// et celles qui tombent HORS de la grille rendue (sortie latérale/
// arrière -> élimination, ou sortie par l'avant de la tuile de tête)
// — ces dernières n'ont AUCUN polygone dessiné à cet endroit (le rendu
// ne dessine que les cases 0..cols-1 / 0..rows-1), donc jamais
// cliquables sur le plateau : elles restent néanmoins des choix
// légaux (jamais masqués, voir human.getMovementStepOptions) et sont
// proposées comme boutons distincts dans le panneau.
function splitOnAndOffBoardOptions(b, options) {
  const onBoard = [], offBoard = [];
  for (const o of options) {
    const col = o.col !== undefined ? o.col : 0;
    const row = o.entryRow !== undefined ? o.entryRow : o.row;
    (isOnBoard(b, col, row) ? onBoard : offBoard).push(o);
  }
  return { onBoard, offBoard };
}

function offBoardOptionLabel(option) {
  if (option.outcome === "exits-front") return `Continuer vers la tuile suivante (${option.direction})`;
  return `Sortir du plateau — ÉLIMINATION (${option.direction})`;
}

function highlightedCells() {
  if (!sel.step) return [];
  const b = board();
  if (sel.step === "entry-row") {
    const options = getEntryRowOptions(b, sel.remaining, G.allCars);
    const { onBoard } = splitOnAndOffBoardOptions(b, options);
    return onBoard.map((o) => ({ col: 0, row: o.entryRow, onClick: () => { pickEntryRow(o); render(); } }));
  }
  if (sel.step === "move-step" || sel.step === "road-bonus-step") {
    const options = getMovementStepOptions(b, sel.car, sel.remaining, G.allCars);
    const { onBoard } = splitOnAndOffBoardOptions(b, options);
    return onBoard.map((o) => ({ col: o.col, row: o.row, onClick: () => { pickMoveStep(o); render(); } }));
  }
  if (sel.step === "airstrike-placement") {
    const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
    const placements = listValidAirstrikePlacements(b, G.allCars, G.allChoppers, chopper);
    return placements.map((p) => ({ col: p.col, row: p.row, onClick: () => { pickAirstrikePlacement(p.col, p.row); render(); } }));
  }
  return [];
}

function renderBoard() {
  const b = board();
  const svg = document.getElementById("board");
  const w = 10 + b.cols * CELL_W + 20;
  const h = 20 + b.rows * CELL_H + 10;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = "";

  const highlights = highlightedCells();
  const highlightMap = new Map(highlights.map((h) => [h.col + "," + h.row, h]));

  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      const cell = b.grid[row][col];
      const poly = cellPoly(col, row);
      const fill = TERRAIN_FILL[cell.terrain] || "#444";
      const key = col + "," + row;
      const hl = highlightMap.get(key);
      const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polyEl.setAttribute("points", pts2s(poly));
      polyEl.setAttribute("fill", hl ? "#ffd166" : fill);
      polyEl.setAttribute("stroke", "#111");
      polyEl.setAttribute("stroke-width", "0.6");
      if (hl) {
        polyEl.classList.add("clickable");
        polyEl.addEventListener("click", hl.onClick);
      }
      svg.appendChild(polyEl);
      if (cell.terrain === "impassable") {
        const { cx, cy } = cellCenter(col, row);
        svg.insertAdjacentHTML("beforeend", `<line x1="${cx - 10}" y1="${cy - 10}" x2="${cx + 10}" y2="${cy + 10}" stroke="#ff6666" stroke-width="1.5"/><line x1="${cx - 10}" y1="${cy + 10}" x2="${cx + 10}" y2="${cy - 10}" stroke="#ff6666" stroke-width="1.5"/>`);
      }
      if (cell.hazard === "hidden") {
        const { cx, cy } = cellCenter(col, row);
        svg.insertAdjacentHTML("beforeend", `<polygon points="${cx},${cy - 6} ${cx - 6},${cy + 5} ${cx + 6},${cy + 5}" fill="#222" stroke="#888" stroke-width="0.7"/>`);
      }
    }
  }

  G.allCars.forEach((car) => {
    if (car.col === null || car.status === "eliminated") return;
    const { cx, cy } = cellCenter(car.col, car.row);
    const isActive = sel.car === car;
    const color = OWNER_COLOR[car.owner];
    let extra = "";
    if (isActive) extra += `<circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="#ffd166" stroke-width="2.5"/>`;
    svg.insertAdjacentHTML("beforeend", `<g>
      ${extra}
      <rect x="${cx - 12}" y="${cy - 10}" width="24" height="20" rx="4" fill="${color}" stroke="#000" stroke-width="1" ${car.status === "inoperable" ? 'opacity="0.5"' : ""}/>
      <text x="${cx}" y="${cy + 4}" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">${car.size[0].toUpperCase()}</text>
      ${car.status === "inoperable" ? `<line x1="${cx - 12}" y1="${cy - 10}" x2="${cx + 12}" y2="${cy + 10}" stroke="#fff" stroke-width="1.5"/>` : ""}
      ${car.damageTokens.length > 0 ? `<circle cx="${cx + 10}" cy="${cy - 8}" r="5" fill="#ffb347"/><text x="${cx + 10}" y="${cy - 5}" font-size="7" text-anchor="middle" fill="#111">${car.damageTokens.length}</text>` : ""}
    </g>`);
  });

  G.allChoppers.forEach((ch) => {
    if (!ch.placed || ch.col === null) return;
    const { cx, cy } = cellCenter(ch.col, ch.row);
    const color = OWNER_COLOR[ch.owner];
    svg.insertAdjacentHTML("beforeend", `<polygon points="${cx},${cy - 9} ${cx - 9},${cy + 7} ${cx + 9},${cy + 7}" fill="#111" stroke="${color}" stroke-width="2"/>`);
  });
}

function choiceButton(label, onClick, selected) {
  const btn = document.createElement("button");
  btn.className = "choice" + (selected ? " selected" : "");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

// Étapes AVANT commitAssignAndCommand() : "Annuler" reste possible,
// aucun dé n'a encore quitté le pool. Au-delà (mouvement, tir), plus
// de retour en arrière — un dé assigné ne se rend pas.
const PRE_COMMIT_STEPS = new Set(["car", "die", "command", "command-die", "repair-target", "airstrike-target", "airstrike-placement", "commit"]);

function renderPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";

  if (gameOver) return;

  ensureRoadDieRolled(G.roundState);
  const cp = getCurrentPlayer(G.roundState);
  if (!cp) return;

  if (cp === OPPONENT) {
    const h2 = document.createElement("h2");
    h2.textContent = `Au tour de ${OPPONENT}`;
    panel.appendChild(h2);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Jouer le tour de l'IA ▶";
    btn.addEventListener("click", playAiTurn);
    panel.appendChild(btn);
    return;
  }

  // --- Tour humain ---
  const ctx = currentTurnContext();
  if (PRE_COMMIT_STEPS.has(sel.step || "die")) {
    if (passHumanTurnIfImpossible(ctx)) { render(); return; }
    sel.mode = ctx.mode;
    sel.commandAvailable = ctx.commandAvailable;
  }

  const h2 = document.createElement("h2");
  h2.textContent = ctx.mode === "coast" && PRE_COMMIT_STEPS.has(sel.step || "die") ? "Votre tour — Coast (aucune voiture disponible à activer)" : "Votre tour";
  panel.appendChild(h2);

  const choices = document.createElement("div");
  choices.className = "choices";

  if (!sel.step) sel.step = "die";

  if (sel.step === "die") {
    const p = document.createElement("div");
    p.textContent = ctx.mode === "coast" ? "Choisissez un dé à assigner en Coast (comptera comme 1 quelle que soit sa valeur) :" : "Choisissez un dé pour le mouvement :";
    panel.appendChild(p);
    ctx.pool.forEach((d) => {
      choices.appendChild(choiceButton(String(d), () => { pickDie(d); render(); }));
    });
  } else if (sel.step === "car") {
    const p = document.createElement("div");
    p.textContent = `Dé choisi : ${sel.dieValue}. ` + (ctx.mode === "coast" ? "Choisissez la voiture à faire avancer d'une case (Coast) :" : "Choisissez la voiture à activer :");
    panel.appendChild(p);
    const list = ctx.mode === "coast" ? ctx.coastableCars : ctx.activatableCars;
    list.forEach((car) => {
      choices.appendChild(choiceButton(`${car.size} (${car.col === null ? "hors plateau" : "col " + car.col + ",row " + car.row})`, () => { pickCar(car); render(); }));
    });
  } else if (sel.step === "command") {
    const p = document.createElement("div");
    p.textContent = "Voulez-vous jouer une Command avec un des dés restants ?";
    panel.appendChild(p);
    const remaining = ctx.pool.filter((v, i) => i !== ctx.pool.indexOf(sel.dieValue));
    const myInoperable = G.allCars.filter((c) => c.owner === HUMAN && c.status === "inoperable");
    const commands = getAvailableCommands(remaining, myInoperable);
    choices.appendChild(choiceButton("Aucune Command", () => { pickCommandChoice("none"); render(); }));
    commands.forEach((c) => {
      choices.appendChild(choiceButton(c.type + " (dés : " + c.eligibleDice.join(",") + ")", () => { pickCommandChoice(c.type); render(); }));
    });
  } else if (sel.step === "command-die") {
    const p = document.createElement("div");
    p.textContent = `Command ${sel.commandType} — choisissez le dé à y consacrer :`;
    panel.appendChild(p);
    const remaining = ctx.pool.filter((v, i) => i !== ctx.pool.indexOf(sel.dieValue));
    const myInoperable = G.allCars.filter((c) => c.owner === HUMAN && c.status === "inoperable");
    const commands = getAvailableCommands(remaining, myInoperable);
    const cmd = commands.find((c) => c.type === sel.commandType);
    cmd.eligibleDice.forEach((d) => choices.appendChild(choiceButton(String(d), () => { pickCommandDie(d); render(); })));
  } else if (sel.step === "repair-target") {
    const p = document.createElement("div");
    p.textContent = "Repair — choisissez la voiture à réparer :";
    panel.appendChild(p);
    const myInoperable = G.allCars.filter((c) => c.owner === HUMAN && c.status === "inoperable");
    myInoperable.forEach((c) => choices.appendChild(choiceButton(`${c.size} (col ${c.col},row ${c.row})`, () => { pickRepairTarget(c); render(); })));
  } else if (sel.step === "airstrike-target") {
    const p = document.createElement("div");
    p.textContent = "Airstrike — cible visée (facultatif) :";
    panel.appendChild(p);
    choices.appendChild(choiceButton("Aucune cible", () => { pickAirstrikeTarget(null); render(); }));
    const enemies = G.allCars.filter((c) => c.owner !== HUMAN && c.status === "operable");
    enemies.forEach((c) => choices.appendChild(choiceButton(`${c.owner} ${c.size}`, () => { pickAirstrikeTarget(c); render(); })));
  } else if (sel.step === "airstrike-placement") {
    const p = document.createElement("div");
    p.textContent = "Cliquez une case surlignée pour placer le chopper (Airstrike).";
    panel.appendChild(p);
  } else if (sel.step === "commit") {
    const p = document.createElement("div");
    p.textContent = `Prêt : ${sel.car.size}, dé ${sel.dieValue}${sel.command ? ", Command " + sel.command.type + " (dé " + sel.command.dieValue + ")" : ""}. Le tour va commencer — plus d'annulation possible au-delà.`;
    panel.appendChild(p);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Commencer le mouvement";
    btn.addEventListener("click", () => { commitAssignAndCommand(); render(); });
    panel.appendChild(btn);
  } else if (sel.step === "entry-row") {
    const p = document.createElement("div");
    p.textContent = `Entrée en jeu — cliquez une case surlignée de la colonne d'entrée (${sel.remaining} point(s) de mouvement disponibles).`;
    panel.appendChild(p);
    const { offBoard } = splitOnAndOffBoardOptions(board(), getEntryRowOptions(board(), sel.remaining, G.allCars));
    offBoard.forEach((o) => choices.appendChild(choiceButton(offBoardOptionLabel({ ...o, direction: "rangée " + o.entryRow }), () => { pickEntryRow(o); render(); })));
  } else if (sel.step === "move-step") {
    const p = document.createElement("div");
    p.textContent = `Choisissez la prochaine case (${sel.remaining} point(s) de mouvement restants).`;
    panel.appendChild(p);
    const { offBoard } = splitOnAndOffBoardOptions(board(), getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars));
    offBoard.forEach((o) => choices.appendChild(choiceButton(offBoardOptionLabel(o), () => { pickMoveStep(o); render(); })));
  } else if (sel.step === "road-bonus-step") {
    const p = document.createElement("div");
    p.textContent = `Bonus Road — choisissez la prochaine case (${sel.remaining} point(s) restants, montant fixe : le trajet doit utiliser tout le bonus).`;
    panel.appendChild(p);
    const { offBoard } = splitOnAndOffBoardOptions(board(), getMovementStepOptions(board(), sel.car, sel.remaining, G.allCars));
    offBoard.forEach((o) => choices.appendChild(choiceButton(offBoardOptionLabel(o), () => { pickMoveStep(o); render(); })));
  } else if (sel.step === "tile-advanced") {
    const msg = document.createElement("div");
    msg.className = "tile-message";
    msg.textContent = `🧩 Nouvelle tuile en jeu ! ${sel.tileMessage}`;
    panel.appendChild(msg);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Continuer — choisir ma case sur la nouvelle tuile";
    btn.addEventListener("click", () => { continueAfterTileAdvance(); render(); });
    panel.appendChild(btn);
  } else if (sel.step === "slam-reroll-choice") {
    const p = document.createElement("div");
    p.textContent = `SLAM ! Dé de slam : ${sel.slamPreview.slamRoll} | Dé de direction : ${sel.slamPreview.directionRoll}. Votre voiture (${sel.slamPreview.largerCar.size}) est plus grande — voulez-vous relancer les deux dés (une seule relance possible, p.9) ?`;
    panel.appendChild(p);
    choices.appendChild(choiceButton("Oui, relancer", () => { pickSlamRerollChoice(true); render(); }));
    choices.appendChild(choiceButton("Non, garder ce résultat", () => { pickSlamRerollChoice(false); render(); }));
  } else if (sel.step === "movement-stopped") {
    const msg = document.createElement("div");
    msg.className = "stop-message";
    msg.textContent = sel.stopMessage;
    panel.appendChild(msg);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Continuer";
    btn.addEventListener("click", () => { continueAfterStop(); render(); });
    panel.appendChild(btn);
  } else if (sel.step === "road-bonus-choice") {
    const p = document.createElement("div");
    p.textContent = `Trajet resté 100% sur route ! Voulez-vous utiliser le bonus Road (+${G.roundState.roadDie} cases, montant fixe, non modifiable) ?`;
    panel.appendChild(p);
    choices.appendChild(choiceButton(`Oui, +${G.roundState.roadDie}`, () => { acceptRoadBonus(); render(); }));
    choices.appendChild(choiceButton("Non merci", () => { declineRoadBonus(); render(); }));
  } else if (sel.step === "shoot") {
    const p = document.createElement("div");
    p.textContent = "Mouvement terminé — choisissez une cible pour le tir, ou ne tirez pas :";
    panel.appendChild(p);
    choices.appendChild(choiceButton("Ne pas tirer", () => { pickShootTarget(null); render(); }));
    (sel.shootTargets || []).forEach((t) => {
      choices.appendChild(choiceButton(`Tirer sur ${t.owner} ${t.size}`, () => { pickShootTarget(t); render(); }));
    });
  }

  panel.appendChild(choices);

  if (PRE_COMMIT_STEPS.has(sel.step) && sel.step !== "die" && sel.step !== "commit") {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Annuler / recommencer ce tour";
    cancelBtn.addEventListener("click", cancelSelection);
    panel.appendChild(cancelBtn);
  }
}

function render() {
  ensureRoadDieRolled(G.roundState);
  document.getElementById("roundBadge").textContent = `Round ${G.roundState.roundNumber}`;
  const cp = getCurrentPlayer(G.roundState);
  document.getElementById("playerBadge").textContent = cp ? `${cp} joue` : "Partie terminée";
  document.getElementById("roadDieBadge").textContent = `Dé Road ce round : ${G.roundState.roadDie}`;
  document.getElementById("commandUsedBadge").textContent = cp ? `Command déjà utilisée par ${cp} : ${G.roundState.commandUsedThisRound[cp] ? "oui" : "non"}` : "";
  document.getElementById("dicePool").innerHTML = cp ? (G.roundState.dicePool[cp] || []).map((d) => `<span class="die">${d}</span>`).join("") : "";

  renderBoard();
  renderPanel();

  document.getElementById("damageRow").innerHTML = G.allCars
    .filter((car) => car.status !== "eliminated")
    .map((car) => `<span class="badge">${car.owner} ${car.size} : ${car.damageTokens.length} dégât(s)${car.status === "inoperable" ? " [INOPÉRABLE]" : ""}</span>`)
    .join("");

  const banner = document.getElementById("winnerBanner");
  if (gameOver) {
    banner.style.display = "block";
    banner.textContent = gameOverInfo.winner
      ? `🏁 Partie terminée : victoire de ${gameOverInfo.winner} (${gameOverInfo.reason}).`
      : `Partie terminée sans vainqueur.`;
  } else {
    banner.style.display = "none";
  }

  const logEl = document.getElementById("log");
  logEl.innerHTML = fullLog.slice().reverse().map((e) => e.sep ? `<div class="turn-sep">${e.sep}</div>` : `<div class="line">${e.line}</div>`).join("");
}

// ===================================================================
// DÉMARRAGE
// ===================================================================
newGame();
resetSelection();
render();

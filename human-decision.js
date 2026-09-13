/**
 * human-decision.js — couche de décision pour un JOUEUR HUMAIN.
 * ---------------------------------------------------------------
 * Symétrique de ai-decision.js, mais avec un principe fondamental
 * différent : ai-decision.js encode une POLITIQUE de décision (quelle
 * voiture bouger, quelle Command jouer, avec quelles heuristiques
 * stratégiques — tuile Rear, position de l'adversaire, etc.), pour
 * que l'automate joue seul et de façon déterministe.
 *
 * Un joueur humain n'a besoin d'AUCUNE politique — il a son libre
 * arbitre. Ce module n'implémente donc QUE les CONTRAINTES MÉCANIQUES
 * du livret de règles (p.7-11) : quelles voitures/dés/Commands sont
 * légalement disponibles, quelles cases sont atteignables pour un
 * choix donné, quelles cases sont valides pour un placement Airstrike
 * — jamais lesquelles sont "les meilleures". Vérifié contre le
 * livret (TRV_Base_Game_Rulebook.pdf) le 26/08/2026 : Nitro (1-3),
 * Drift (3-5, utilisable À TOUT MOMENT pour traverser sans Slam — PAS
 * uniquement quand l'arc avant est bloqué, contrairement à
 * l'automate), Repair (6, cible N'IMPORTE LAQUELLE de ses voitures
 * inopérables), Airstrike (n'importe quel dé, case vide au choix) —
 * une seule Command par round, jamais sur un tour de Coast.
 *
 * Le mouvement se joue case par case (voir Section 2ter) — jamais une
 * destination choisie d'un coup — donc ce module ne dépend QUE
 * d'engine.js, jamais d'ai-decision.js (retiré ici lors d'une revue de
 * code : l'ancienne Section 2, qui choisissait une destination
 * complète via computeReachableDestinations/computeReachableEntryDestinations,
 * n'était plus appelée par aucun code réel depuis ce passage au
 * mouvement pas à pas).
 */

"use strict";

const engine = require("./engine.js");

const { CAR_STATUS, TERRAIN, MOVE_COST, getSpace, getCarAt, getFrontArc } = engine;

// ===================================================================
// SECTION 1 — CONTEXTE DE TOUR : que peut faire ce joueur maintenant ?
// ===================================================================
/**
 * Détermine ce qu'un joueur peut légalement faire à son tour, SANS
 * aucune présélection stratégique (contrairement à decideNoFinishLine
 * & co côté IA, qui choisissent déjà UNE voiture/un dé précis).
 *   - mode "coast" : p.8, aucune voiture opérable restant à activer ce
 *     round → assigner un dé quelconque au Coast d'une voiture déjà
 *     activée (max 2 fois par voiture), jamais de Command.
 *   - mode "assign" : au moins une voiture opérable pas encore
 *     activée ce round → le joueur choisit LAQUELLE, avec QUEL dé, et
 *     PEUT (s'il ne l'a pas déjà fait ce round) jouer une Command.
 */
function getTurnContext(progressionState, board, allCars, allChoppers, dicePool, playerName, roundState) {
  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) {
    return { canPlay: false, reason: "Plus aucun dé disponible ce round." };
  }

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const notYetActivated = myOperableCars.filter((c) => !c.movedThisRound);
  const commandUsedThisRound = !!roundState.commandUsedThisRound[playerName];

  if (notYetActivated.length === 0) {
    // p.8 : "If you do not have any available cars, assign an unused
    // movement die to the coast space on one of your operable cars
    // you previously moved. [...] A car may be assigned to coast a
    // maximum of two times." — jamais de Command sur un tour de Coast.
    const eligibleForCoast = myOperableCars.filter((c) => c.coastCount < 2);
    if (eligibleForCoast.length === 0) {
      return { canPlay: false, reason: "Plus aucun tour possible ce round (Coast déjà utilisé 2 fois sur chaque voiture opérable)." };
    }
    return {
      canPlay: true,
      mode: "coast",
      pool: [...myPool],
      coastableCars: eligibleForCoast
    };
  }

  return {
    canPlay: true,
    mode: "assign",
    pool: [...myPool],
    // Au 1er round, toute voiture pas encore sur le plateau (col ===
    // null) s'entre normalement — cette liste peut donc mélanger des
    // voitures déjà en jeu et des voitures qui vont entrer, exactement
    // comme au round 1 côté livret (p.9).
    activatableCars: notYetActivated,
    commandAvailable: !commandUsedThisRound
  };
}

// ===================================================================
// SECTION 2 — MOUVEMENT CASE PAR CASE (retour d'usage de Mayrik,
// Point 3) : la destination n'est jamais choisie d'un coup, le joueur
// avance une case à la fois dans l'arc avant COURANT de sa voiture,
// les effets (hazard, slam, sortie de tuile) s'appliquant réellement
// avant qu'on lui propose la case suivante. Le même principe
// s'applique au Bonus Road (p.7, montant fixe imposé) : à l'appelant
// de reboucler sur cette fonction avec `remaining` = roadDieValue au
// départ de l'extension, exactement comme pour le mouvement
// principal.
// ===================================================================
/**
 * Liste les cases de l'arc avant COURANT que le joueur peut
 * légitimement choisir MAINTENANT comme prochaine case, compte tenu
 * des points de mouvement `remaining` qu'il lui reste. Reproduit
 * EXACTEMENT les mêmes conditions que la boucle interne de
 * engine.moveCar (jamais dupliquées avec une logique différente) :
 *   - jamais une case Impassable : "aucune entrée volontaire sur une
 *     case impassable" (voir engine.js, moveCar) — exclue de la liste,
 *     jamais juste déconseillée.
 *   - jamais si le coût de terrain dépasse `remaining`, SAUF
 *     l'exception Boue à 1 point restant (p.7).
 * Les sorties de plateau restent des choix LÉGAUX (le joueur reste
 * libre, même si l'issue est lourde) : sortie latérale/arrière →
 * élimination (p.6), sortie avant → changement de tuile (géré
 * automatiquement par engine.moveCarWithProgression). `outcome` sur
 * chaque option permet à l'interface d'avertir le joueur AVANT qu'il
 * ne clique, jamais de lui cacher un choix légal.
 * Ne cache jamais un Slam à venir non plus (`outcome: "slam"`) — la
 * case occupée reste un choix légal (p.9), avec ou sans Drift.
 */
function getMovementStepOptions(board, car, remaining, allCars) {
  const arc = getFrontArc(car);
  const options = [];

  for (const step of arc) {
    const space = getSpace(board, step.col, step.row);

    if (space === null || (space === undefined && step.col < 0)) {
      // Bord latéral ou arrière : élimination (p.6) — choix légal,
      // jamais filtré.
      options.push({ direction: step.name, col: step.col, row: step.row, terrain: null, cost: null, outcome: "eliminated-edge" });
      continue;
    }

    if (space === undefined) {
      // Bord AVANT : sortie de la tuile de tête — pas une élimination,
      // gérée automatiquement par moveCarWithProgression.
      options.push({ direction: step.name, col: step.col, row: step.row, terrain: null, cost: null, outcome: "exits-front" });
      continue;
    }

    if (space.terrain === TERRAIN.IMPASSABLE) {
      continue; // jamais une entrée volontaire (voir engine.moveCar)
    }

    const cost = MOVE_COST[space.terrain];
    const mudExceptionApplies = space.terrain === TERRAIN.MUD && remaining === 1;
    if (cost > remaining && !mudExceptionApplies) {
      continue; // pas assez de déplacement restant pour cette case
    }

    const occupant = getCarAt(allCars, step.col, step.row, car);
    options.push({
      direction: step.name,
      col: step.col,
      row: step.row,
      terrain: space.terrain,
      cost: mudExceptionApplies ? remaining : cost,
      outcome: occupant ? "slam" : "normal"
    });
  }

  return options;
}

/**
 * Symétrique de getMovementStepOptions pour le tout premier pas d'une
 * voiture pas encore entrée en jeu (car.col === null) : le "hors
 * plateau" est relié à TOUTE la colonne 0 (p.9), pas à un arc avant à
 * 3 cases — mêmes conditions de légalité sinon (jamais Impassable en
 * entrée volontaire, coût de terrain ≤ dé assigné sauf exception
 * Boue). Une fois cette case d'entrée choisie et jouée (voir
 * turn-executor.executeEntryStep), la suite du trajet redevient un
 * arc avant classique piloté par getMovementStepOptions.
 */
function getEntryRowOptions(board, dieValue, allCars) {
  const options = [];
  for (let row = 0; row < board.rows; row++) {
    const space = getSpace(board, 0, row);
    if (!space || space.terrain === TERRAIN.IMPASSABLE) continue;
    const cost = MOVE_COST[space.terrain];
    const mudExceptionApplies = space.terrain === TERRAIN.MUD && dieValue === 1;
    if (cost > dieValue && !mudExceptionApplies) continue;
    const occupant = getCarAt(allCars, 0, row);
    options.push({
      entryRow: row,
      terrain: space.terrain,
      cost: mudExceptionApplies ? dieValue : cost,
      outcome: occupant ? "slam" : "normal"
    });
  }
  return options;
}

// ===================================================================
// SECTION 2bis — CIBLE DE TIR LIBRE (remplace le choix automatique
// ai.chooseShootTarget pour un joueur humain — Point 3, retour de
// Mayrik : le joueur doit pouvoir choisir sa cible lui-même, et
// choisir de NE PAS tirer).
// ===================================================================
/**
 * Liste toutes les cibles légalement atteignables par un tir (p.10) :
 * voiture adverse, opérationnelle, dans l'arc avant du tireur — jamais
 * un chopper ("You may not shoot choppers"). Reprend exactement le
 * même filtre que engine.chooseAiShootTarget, sans aucune préférence
 * stratégique : au joueur de choisir librement parmi ces options, ou
 * de ne pas tirer du tout (liste vide = pas de cible possible ; une
 * liste non vide n'oblige jamais à tirer).
 */
function getShootTargetOptions(shooter, allCars) {
  const arc = getFrontArc(shooter);
  return allCars.filter(
    (c) =>
      c.owner !== shooter.owner &&
      c.status !== CAR_STATUS.ELIMINATED &&
      !c.isChopper &&
      arc.some((a) => a.col === c.col && a.row === c.row)
  );
}

// ===================================================================
// SECTION 2ter — POINTS DE MOUVEMENT PERDUS (retour de Mayrik,
// Point 3 : "reste des mouvements perdus à cause de [raison]" avec un
// bouton Continuer, plutôt qu'un enchaînement automatique).
// ===================================================================
/**
 * Calcule les points de mouvement RÉELLEMENT perdus après un pas
 * (executeMoveStep/executeEntryStep), en comparant `remainingAfter` à
 * ce que le coût NORMAL de la case aurait dû laisser. Jamais déduit du
 * seul statut de la voiture : devenir inopérable (dégâts) ne coupe PAS
 * forcément le mouvement (aucune règle en ce sens), alors qu'un Slam,
 * une Mine, ou une élimination mettent explicitement `remaining` à 0
 * dans engine.js quel que soit ce qu'il restait — c'est CET écart-là
 * qui signale une perte, jamais un statut lu après coup.
 *   - outcome "eliminated-edge" : tout le reste est perdu par
 *     construction (sortie du plateau, cost=null).
 *   - outcome "exits-front" : jamais une perte, le décalage de tuile
 *     est transparent pour le joueur (remainingAfter le reflète déjà).
 *   - outcome "normal"/"slam" : perte = ce que le coût normal de la
 *     case aurait dû laisser, moins ce qu'il reste réellement.
 */
function computePointsLost(pointsBefore, option, remainingAfter) {
  if (option.outcome === "eliminated-edge") return pointsBefore;
  if (option.outcome === "exits-front") return 0;
  const expectedRemaining = pointsBefore - option.cost;
  return Math.max(0, expectedRemaining - remainingAfter);
}

// ===================================================================
// SECTION 3 — COMMANDS DISPONIBLES (règles du livret UNIQUEMENT, p.8)
// ===================================================================
/**
 * `availableDice` = les dés du pool NON déjà utilisés pour le dé de
 * mouvement de ce tour (le joueur peut choisir d'en réserver un pour
 * une Command AVANT ou APRÈS avoir choisi son dé de mouvement — cette
 * fonction ne présume de rien, elle liste juste ce qui est
 * mécaniquement possible avec les dés qu'il reste).
 * Ne renvoie RIEN si une Command a déjà été jouée ce round (une seule
 * par round, p.8) ou si c'est un tour de Coast (jamais de Command,
 * p.8) — à l'appelant de ne pas invoquer cette fonction dans ces cas
 * (voir commandAvailable dans getTurnContext).
 */
function getAvailableCommands(availableDice, myRepairableCars) {
  const commands = [];

  const nitroDice = availableDice.filter((v) => v >= 1 && v <= 3);
  if (nitroDice.length > 0) {
    commands.push({ type: "nitro", eligibleDice: nitroDice });
  }

  const driftDice = availableDice.filter((v) => v >= 3 && v <= 5);
  if (driftDice.length > 0) {
    commands.push({ type: "drift", eligibleDice: driftDice });
  }

  // p.8 : "Remove one damage token from ANY of your cars [...] That
  // car becomes operable if it was inoperable" — la cible n'a PAS
  // besoin d'être inopérable, seulement d'avoir au moins un jeton de
  // dégât à retirer (une voiture à 1 dégât, encore opérable, est une
  // cible tout aussi légale — corrigé le 28/08, retour de Mayrik :
  // l'ancienne condition ne proposait Repair que pour une voiture déjà
  // inopérable, alors que la règle autorise n'importe quelle voiture
  // endommagée).
  const repairable = myRepairableCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED && c.damageTokens.length > 0);
  if (availableDice.includes(6) && repairable.length > 0) {
    commands.push({ type: "repair", eligibleDice: [6], eligibleTargets: repairable });
  }

  if (availableDice.length > 0) {
    // p.8 : "AIRSTRIKE (ANY DIE)" — aucune contrainte de valeur.
    commands.push({ type: "airstrike", eligibleDice: [...availableDice] });
  }

  return commands;
}

// ===================================================================
// SECTION 4 — PLACEMENTS AIRSTRIKE VALIDES (case vide, p.8)
// ===================================================================
/**
 * "Place your chopper on any empty space on the board (a space with
 * no obstacles)." — reproduit exactement les conditions déjà
 * appliquées par engine.placeChopperAirstrike, mais SANS muter quoi
 * que ce soit (placeChopperAirstrike positionne réellement le chopper
 * dès qu'il valide un placement — inutilisable pour une simple
 * consultation des options par l'interface).
 */
function isValidAirstrikePlacement(board, allCars, allChoppers, chopper, col, row) {
  const space = getSpace(board, col, row);
  if (!space) return false;
  if (space.terrain === TERRAIN.IMPASSABLE) return false;
  // Toute case portant un objet physique est inéligible, peu importe
  // sa nature : jeton hazard face cachée (space.hazard) OU face
  // visible/persistant (space.revealedHazard — Blank/Dirt/Oil Slick
  // déjà résolus, qui restent sur la case, voir HAZARD_BEHAVIOR
  // "persist"). Bug trouvé par Mayrik : seul space.hazard était
  // vérifié, laissant les cases avec un hazard révélé sélectionnables.
  if (space.hazard) return false;
  if (space.revealedHazard) return false;
  if (getCarAt(allCars, col, row)) return false;
  if (allChoppers.some((c) => c !== chopper && c.placed && c.col === col && c.row === row)) return false;
  return true;
}

function listValidAirstrikePlacements(board, allCars, allChoppers, chopper) {
  const placements = [];
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      if (isValidAirstrikePlacement(board, allCars, allChoppers, chopper, col, row)) {
        placements.push({ col, row });
      }
    }
  }
  return placements;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getTurnContext,
    getMovementStepOptions,
    getEntryRowOptions,
    computePointsLost,
    getShootTargetOptions,
    getAvailableCommands,
    isValidAirstrikePlacement,
    listValidAirstrikePlacements
  };
}

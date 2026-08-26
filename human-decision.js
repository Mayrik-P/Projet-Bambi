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
 * Réutilise SANS LES DUPLIQUER : computeReachableDestinations /
 * computeReachableEntryDestinations / chooseShootTarget
 * (ai-decision.js — pure géométrie/règles de terrain, aucune
 * politique) et checkDecisionLegality / executeDecision
 * (turn-executor.js — mêmes règles mécaniques que celles qui
 * valident déjà les décisions de l'IA en self-play).
 */

"use strict";

const engine = require("./engine.js");
const ai = require("./ai-decision.js");

const { CAR_STATUS, TERRAIN, getSpace, getCarAt } = engine;
const { computeReachableDestinations, computeReachableEntryDestinations } = ai;

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
// SECTION 2 — TRAJECTOIRES ATTEIGNABLES POUR UN CHOIX (voiture + dé)
// ===================================================================
/**
 * Renvoie toutes les cases atteignables (avec leurs métadonnées :
 * terminalReason, dangerousCellsCrossed, slamTarget, path...) pour la
 * voiture et le dé choisis par le joueur — jamais UNE seule "meilleure"
 * destination comme le ferait chooseGeneralTrajectory côté IA. Au
 * joueur de choisir librement parmi les options réellement légales.
 * `driftAvailable` doit être `true` seulement si le joueur a choisi de
 * jouer la Command Drift ce tour (voir Section 3).
 */
function getReachableOptions(board, car, dieValue, allCars, allChoppers, driftAvailable = false) {
  if (car.col === null) {
    return computeReachableEntryDestinations(board, dieValue, allCars, allChoppers, driftAvailable);
  }
  return computeReachableDestinations(board, car, dieValue, allCars, allChoppers, driftAvailable);
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
function getAvailableCommands(availableDice, myInoperableCars) {
  const commands = [];

  const nitroDice = availableDice.filter((v) => v >= 1 && v <= 3);
  if (nitroDice.length > 0) {
    commands.push({ type: "nitro", eligibleDice: nitroDice });
  }

  const driftDice = availableDice.filter((v) => v >= 3 && v <= 5);
  if (driftDice.length > 0) {
    commands.push({ type: "drift", eligibleDice: driftDice });
  }

  const aliveInoperable = myInoperableCars.filter((c) => c.status !== CAR_STATUS.ELIMINATED);
  if (availableDice.includes(6) && aliveInoperable.length > 0) {
    commands.push({ type: "repair", eligibleDice: [6], eligibleTargets: aliveInoperable });
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
  if (space.hazard) return false;
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

// ===================================================================
// SECTION 5 — CONSTRUCTION DE LA DÉCISION FINALE
// ===================================================================
/**
 * Assemble la décision du joueur dans EXACTEMENT la même forme que
 * celle produite par ai.decideAssignAndCommand — c'est ce qui permet
 * à turn-executor.js de l'exécuter sans aucune distinction entre une
 * décision humaine et une décision IA.
 *   - car, dieValue : la voiture et le dé de mouvement choisis.
 *   - command : null, ou { type, dieValue, target? } — pour
 *     "airstrike", target ET placement doivent être fournis (voir
 *     Section 4 pour les placements valides ; target est la voiture
 *     adverse visée, choisie librement par le joueur parmi les
 *     opérables, ou null si aucune n'est atteignable/souhaitée).
 *   - destination : UNE des options renvoyées par getReachableOptions
 *     (Section 2), choisie par le joueur.
 *   - isCoast : true si ce tour est un Coast (voir Section 1).
 */
function buildHumanDecision({ car, dieValue, command, destination, isCoast = false }) {
  const isEntry = car.col === null && !isCoast;
  return {
    car,
    dieValue,
    command: command || null,
    destination,
    isEntry,
    isCoast,
    slam: destination.terminalReason === "slam",
    roadBonusPath: destination.roadBonusPath || null
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getTurnContext,
    getReachableOptions,
    getAvailableCommands,
    isValidAirstrikePlacement,
    listValidAirstrikePlacements,
    buildHumanDecision
  };
}

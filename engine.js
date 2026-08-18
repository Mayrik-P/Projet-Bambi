/**
 * ThunderRoad In The Pocket — Moteur de règles (sans graphisme)
 * ---------------------------------------------------------------
 * Ce fichier ne dessine RIEN. Il modélise juste l'état du jeu et les
 * règles qui le font évoluer. On le teste en lisant les résultats
 * dans la console (voir test-engine.js).
 *
 * ÉTAPE 1 (ce fichier) : une seule tuile, une seule voiture, le
 * mouvement de base (arc avant, coût des terrains). Pas encore de
 * slams, hazards, tir, dégâts, IA, ni plusieurs tuiles qui défilent.
 * On ajoutera ces briques une par une, chacune testée avant la
 * suivante.
 */

// -----------------------------------------------------------------
// 1. CONSTANTES DE RÈGLES (tirées du rulebook)
// -----------------------------------------------------------------

const TERRAIN = {
  ROAD: "road",           // coûte 1 déplacement
  OFF_ROAD: "off_road",   // coûte 1 déplacement
  MUD: "mud",             // coûte 2 déplacements
  IMPASSABLE: "impassable" // élimine la voiture qui y entre
};

const MOVE_COST = {
  [TERRAIN.ROAD]: 1,
  [TERRAIN.OFF_ROAD]: 1,
  [TERRAIN.MUD]: 2
  // IMPASSABLE n'a pas de coût : on n'y "avance" pas, on est éliminé.
};

const CAR_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large"
};

const CAR_STATUS = {
  OPERABLE: "operable",
  INOPERABLE: "inoperable",
  ELIMINATED: "eliminated"
};

// -----------------------------------------------------------------
// 1bis. RÉPARTITION EXACTE DES DÉS (confirmée par Mayrik, p.10 rulebook)
// -----------------------------------------------------------------
// Centralisé ici pour référence. Tous ont une fonction de tirage
// (rollRoadDie, rollStuntDie, rollShootingDie, rollSlamDie,
// rollDirectionDie) sauf MOVEMENT : la valeur du dé de mouvement est
// toujours fournie en paramètre par l'appelant (joueur/IA), jamais
// "tirée" par le moteur lui-même — gardé ici comme simple référence
// de la composition du dé physique.

const DICE_FACES = {
  MOVEMENT: [1, 2, 3, 4, 5, 6],
  ROAD: [1, 1, 1, 2, 2, 3],
  STUNT: [1, 2, 2, 3, 3, 4],
  SHOOTING: ["large", "large", "large", "medium", "small-medium", "any"],
  SLAM: ["top", "top", "bottom", "bottom", "bottom", "bottom"] // déjà utilisé par rollSlamDie
};

// -----------------------------------------------------------------
// 2. MODÈLE DE LA TUILE
// -----------------------------------------------------------------
// Une tuile est une grille [row][col]. col augmente vers l'avant
// (direction dans laquelle les voitures avancent). row est la
// position latérale sur la tuile.
//
// NOTE : la géométrie exacte (grille isométrique à cases décalées,
// comme dans l'éditeur de plateau) sera reconciliée avec le rendu
// plus tard. Pour l'instant on teste la LOGIQUE sur une grille
// simple rectangulaire — les règles de coût/arc sont identiques,
// seul l'affichage final changera.

function createTestTile(cols, rows) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ terrain: TERRAIN.ROAD, hazard: null });
    }
    grid.push(row);
  }
  return { cols, rows, grid };
}

// -----------------------------------------------------------------
// 2bis. PLATEAU (p.5) — rear + middle + lead collées en une seule grille
// -----------------------------------------------------------------
// Le plateau réel du jeu est composé de 3 tuiles à la fois. Plutôt
// que d'apprendre à moveCar/enterAdjacentSpace/etc. à jongler entre 3
// tuiles séparées, on les colle en une seule grande grille (mêmes
// lignes, colonnes concaténées) — le "plateau" a alors EXACTEMENT la
// même forme qu'une tuile simple ({cols, rows, grid}), donc TOUT le
// moteur déjà écrit et testé (mouvement, slam, hazards, bonus Road...)
// fonctionne dessus SANS AUCUNE modification.
//
// Colonnes 0..tileCols-1 = rear, tileCols..2*tileCols-1 = middle,
// 2*tileCols..3*tileCols-1 = lead. Les cellules du plateau sont les
// MÊMES OBJETS que celles des tuiles d'origine (pas une copie) — donc
// une résolution de hazard qui modifie une case via le plateau modifie
// bien la vraie tuile en dessous, ce qui compte quand cette tuile
// glissera de position (rear→défaussée, middle→rear, lead→middle).
function createBoard(...tiles) {
  const rows = tiles[0].rows;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid.push(tiles.reduce((acc, t) => acc.concat(t.grid[r]), []));
  }
  const cols = tiles.reduce((sum, t) => sum + t.cols, 0);
  return {
    cols,
    rows,
    grid,
    tiles: [...tiles],
    tileCols: tiles[0].cols // largeur de la tuile rear — reste valide même avec une 4e tuile Arrivée ajoutée
  };
}

function getSpace(tile, col, row) {
  if (row < 0 || row >= tile.rows) return null; // hors tuile (bord gauche/droit)
  if (col < 0 || col >= tile.cols) return undefined; // hors tuile (bord avant/arrière) — les appelants (enterAdjacentSpace, forceMoveOneSpace) distinguent ensuite avant (progression des tuiles) et arrière (élimination)
  return tile.grid[row][col];
}

// -----------------------------------------------------------------
// 2ter. PROGRESSION DES TUILES (p.11)
// -----------------------------------------------------------------
// État possédant les 3 VRAIES tuiles (pas juste le plateau collé,
// qui n'en est qu'une vue reconstruite à chaque fois). C'est cet
// état qui évolue quand une voiture sort par l'avant.
//
// LIMITATION ACTUELLE, à corriger plus tard : pas de "retournement"
// de tuile à proprement parler — chaque tuile physique a 2 faces
// différentes (A/B) dans le vrai jeu, mais ici chaque face est un
// fichier de données à part entière (voir tiles/data/), donc "choisir
// une face" se fait en amont, au moment de choisir QUEL fichier
// instancier, pas dans ce moteur.
//
// Place automatiquement un jeton hazard sur chaque case marquée
// hazardSpace=true des 3 tuiles de départ (mise en place physique du
// jeu p.5) — voir populateTileHazards(). Sans effet sur des tuiles de
// test sans ce marquage. options.forced{Rear,Middle,Lead}Hazards
// permettent des tirages déterministes en test, tuile par tuile.
function createTileProgressionState(rearTile, middleTile, leadTile, drawPile = [], options = {}) {
  populateTileHazards(rearTile, options.forcedRearHazards || []);
  populateTileHazards(middleTile, options.forcedMiddleHazards || []);
  populateTileHazards(leadTile, options.forcedLeadHazards || []);
  return {
    rearTile,
    middleTile,
    leadTile,
    drawPile: [...drawPile], // tuiles restant à piocher
    tilesPlacedCount: 1, // la lead actuelle compte comme la 1ère tuile "placée" (p.11, règle des 5 tuiles à 2 joueurs)
    finishLineTile: null // devient une vraie tuile (1 colonne) une fois les conditions réunies, voir checkGameEndConditions
  };
}

// La ligne d'arrivée n'est PAS la lead tile elle-même — c'est une
// tuile À PART ajoutée APRÈS elle une fois les conditions de tuile
// finale réunies : une seule colonne de large, purement décorative
// (précisé par Mayrik). Y entrer = victoire immédiate pour le
// propriétaire du véhicule.
function createFinishLineTile(rows) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid.push([{ terrain: TERRAIN.ROAD, hazard: null }]);
  }
  return { cols: 1, rows, grid };
}

function buildBoardFromProgressionState(state) {
  const tiles = [state.rearTile, state.middleTile, state.leadTile];
  if (state.finishLineTile) tiles.push(state.finishLineTile); // ajoutée seulement une fois les conditions réunies
  return createBoard(...tiles);
}

// p.11 : FONCTION FAISANT AUTORITÉ pour l'état de fin de partie —
// à appeler à CHAQUE fin de tour (précisé par Mayrik), pas seulement
// quand une voiture atteint le bord du plateau. Quatre vérifications,
// dans cet ordre :
//   1. Un véhicule est sur la tuile Finish Line → partie terminée,
//      victoire de son propriétaire.
//   2. Plus qu'un seul joueur encore en jeu → partie terminée,
//      victoire de ce joueur (p.11, "last player standing").
//   3. Partie à 2 joueurs et 5e tuile posée → ajoute la Finish Line
//      (sans terminer la partie : il faut encore l'atteindre).
//   4. Partie à 3-4 joueurs et un joueur hors jeu → ajoute la Finish
//      Line (même remarque).
// Idempotent : appeler cette fonction plusieurs fois par tour (ex.
// une fois après le mouvement, une fois en fin de tour) ne cause
// aucun effet de bord — une fois la Finish Line posée ou la partie
// terminée, les vérifications suivantes ne font que le confirmer.
function checkGameEndConditions(state, allCars, allChoppers, playerNames) {
  const log = [];

  // 1. Victoire par ligne d'arrivée.
  if (state.finishLineTile) {
    const finishColStart = state.rearTile.cols + state.middleTile.cols + state.leadTile.cols;
    const winnerCar = allCars.find((c) => c.status !== CAR_STATUS.ELIMINATED && c.col >= finishColStart);
    if (winnerCar) {
      log.push(`${winnerCar.id} est sur la Finish Line → VICTOIRE de ${winnerCar.owner} !`);
      return { log, gameOver: true, winner: winnerCar.owner, reason: "finish-line" };
    }
  }

  // 2. Dernier joueur restant.
  const activePlayers = playerNames.filter((p) => !isPlayerOutOfGame(p, allCars));
  if (activePlayers.length <= 1) {
    const winner = activePlayers[0] || null;
    log.push(winner ? `${winner} est le dernier joueur encore en jeu → VICTOIRE !` : `Plus aucun joueur en jeu — partie terminée sans vainqueur.`);
    return { log, gameOver: true, winner, reason: "last-player-standing" };
  }

  // 3-4. Ajout de la Finish Line si les conditions sont réunies (sans
  // terminer la partie — il faut encore l'atteindre).
  if (!state.finishLineTile) {
    let shouldAdd = false;

    if (playerNames.length <= 2 && state.tilesPlacedCount >= 5) {
      shouldAdd = true;
      log.push(`Finish Line ajoutée (5e tuile, partie à 2 joueurs).`);
    }

    if (!shouldAdd && playerNames.length >= 3) {
      const anyOut = playerNames.some((p) => isPlayerOutOfGame(p, allCars));
      if (anyOut) {
        shouldAdd = true;
        log.push(`Finish Line ajoutée (un joueur hors jeu, partie à 3-4 joueurs).`);
      }
    }

    if (shouldAdd) {
      state.finishLineTile = createFinishLineTile(state.rearTile.rows);
    }
  }

  return { log, gameOver: false, winner: null };
}

// p.11, ÉTAPES 1-9 : à appeler quand une voiture sort par l'AVANT du
// plateau (moveResult.frontExit === true) ET que la tuile qu'elle
// vient de quitter n'était PAS la tuile finale (sinon c'est une
// victoire, à gérer séparément — voir la future condition de
// victoire). Décale rear→défaussée, middle→rear, lead→middle,
// pioche une nouvelle lead, et REBASE toutes les positions (voitures
// + choppers) sur le nouveau repère de colonnes.
function advanceBoardOnFrontExit(state, allCars, allChoppers, options = {}) {
  const log = [];
  const tileCols = state.rearTile.cols;

  // 1. Toutes les voitures sur la tuile rear (qui va être retirée)
  // sont éliminées (p.11, étape 1).
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    if (car.col >= 0 && car.col < tileCols) {
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} était sur la tuile rear retirée → ÉLIMINÉE`);
    }
  }

  // 2. Les hazards de la tuile rear disparaissent avec elle (rien de
  // plus à faire : on ne conserve pas de référence à cette tuile).
  log.push(`Hazards de la tuile rear défaussés avec elle.`);

  // 3. Les choppers présents sur la tuile rear sont rendus à leurs
  // joueurs (redeviennent non placés).
  for (const ch of allChoppers || []) {
    if (ch.placed && ch.col >= 0 && ch.col < tileCols) {
      ch.placed = false;
      ch.col = null;
      ch.row = null;
      log.push(`Chopper de ${ch.owner} rendu (était sur la tuile rear retirée).`);
    }
  }

  // 4-6. Décalage : rear défaussée, middle→rear, lead→middle,
  // nouvelle lead piochée (ou fournie explicitement pour les tests
  // via options.forcedNextTile).
  state.drawPile.push(state.rearTile); // simplification : pas de vrai "retournement" de face pour l'instant
  state.rearTile = state.middleTile;
  state.middleTile = state.leadTile;

  const newLeadTile = options.forcedNextTile || state.drawPile.shift();
  if (!newLeadTile) {
    return { ok: false, reason: "Plus aucune tuile disponible dans la pile de pioche.", log };
  }
  state.leadTile = newLeadTile;
  state.tilesPlacedCount += 1;

  // 7. Hazards aléatoires sur la nouvelle lead (p.11) — chaque case
  // marquée hazardSpace=true (vraie tuile instanciée via
  // instantiateTile) reçoit un jeton fraîchement tiré. Sans effet sur
  // les tuiles de test (createTestTile) qui n'ont pas ce marquage.
  // options.forcedLeadHazards permet un tirage déterministe en test.
  populateTileHazards(newLeadTile, options.forcedLeadHazards || []);
  log.push(`Nouvelle tuile lead posée, hazards placés sur ses cases marquées.`);

  // Rebase : toutes les positions (voitures encore en jeu, choppers
  // placés) reculent d'une largeur de tuile, puisque le repère
  // (colonne 0) avance d'une tuile vers l'avant.
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    car.col -= tileCols;
  }
  for (const ch of allChoppers || []) {
    if (ch.placed) ch.col -= tileCols;
  }

  const newBoard = buildBoardFromProgressionState(state);

  return { ok: true, log, newBoard };
}

// -----------------------------------------------------------------
// 2quater. ORCHESTRATEUR : MOUVEMENT + PROGRESSION + VICTOIRE (p.11)
// -----------------------------------------------------------------
// Enchaîne automatiquement : mouvement → si sortie par l'avant, soit
// décalage des tuiles (si pas encore la tuile finale) et reprise du
// mouvement restant, soit détection de la tuile finale (ajout de la
// ligne d'arrivée) → et victoire dès que la voiture entre
// effectivement sur cette ligne d'arrivée. Reconstruit le plateau à
// chaque itération (nécessaire puisque le nombre de tuiles peut
// changer en cours de route, une fois la ligne d'arrivée ajoutée).
function moveCarWithProgression(state, car, dieValue, chosenPath, allCars, allChoppers, playerNames, slamOptions = {}) {
  const log = [];
  let remainingPath = [...chosenPath];
  let remainingDie = dieValue;

  // Injecte l'état de progression et les choppers dans les options
  // transmises à moveCar — permet à des effets résolus en profondeur
  // (ex. Blast Off via une Mine) d'accéder à progressionState pour
  // décaler les tuiles ou détecter une victoire par Finish Line,
  // au lieu de rester bloqués sur le plateau à 3 tuiles local.
  const movementOptions = { ...slamOptions, progressionState: state, allChoppers };

  while (true) {
    const board = buildBoardFromProgressionState(state);
    const moveResult = moveCar(board, car, remainingDie, remainingPath, allCars, movementOptions);
    log.push(...moveResult.log);

    if (!moveResult.ok) {
      return { ok: false, reason: moveResult.reason, log };
    }

    // Vérifie l'ENSEMBLE des conditions de fin de partie après ce
    // segment de mouvement (victoire par Finish Line, dernier joueur
    // restant, et ajout de la Finish Line si les conditions sont
    // réunies) — même fonction que celle appelée en fin de tour.
    const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
    log.push(...endCheck.log);
    if (endCheck.gameOver) {
      return { ok: true, log, moveResult, gameOver: true, winner: endCheck.winner, reason: endCheck.reason };
    }

    if (!moveResult.frontExit) {
      // Mouvement terminé (normalement, élimination, ou slam) sans
      // atteindre le bord avant : rien de plus à orchestrer.
      return { ok: true, log, moveResult, gameOver: false, winner: null };
    }

    // Sortie par l'avant de la lead tile ACTUELLE.
    remainingDie = moveResult.remaining;
    remainingPath = remainingPath.slice(moveResult.stepsConsumed);

    if (!state.finishLineTile) {
      // La Finish Line n'est toujours pas là (checkGameEndConditions
      // vient de le confirmer ci-dessus) : décalage classique.
      const advanceResult = advanceBoardOnFrontExit(state, allCars, allChoppers, {});
      log.push(...advanceResult.log);
      if (!advanceResult.ok) {
        return { ok: false, reason: advanceResult.reason, log };
      }
    }
    // Si la Finish Line vient d'être attachée par checkGameEndConditions
    // ci-dessus, la prochaine itération reconstruit un plateau à 4
    // tuiles, sur lequel la voiture peut y entrer normalement (plus de
    // sortie de plateau à ce stade).

    // On boucle : reprise du reste du mouvement sur le plateau à jour.
  }
}

// -----------------------------------------------------------------
// 3. MODÈLE DE LA VOITURE
// -----------------------------------------------------------------

let nextCarId = 1;

function createCar(owner, size, col, row) {
  return {
    id: nextCarId++,
    owner,
    size,
    col,
    row,
    status: CAR_STATUS.OPERABLE,
    damageTokens: [],
    facingReversed: false, // true une fois inopérable (p.6)
    movedThisRound: false, // p.8 : une voiture ne peut être ASSIGNÉE normalement qu'une fois par ROUND
    coastCount: 0 // p.8 : nombre de fois où elle a été réactivée par Coast ce round (max 2)
  };
}

// -----------------------------------------------------------------
// 3bis. CHOPPER (p.6, p.8, p.11)
// -----------------------------------------------------------------
// Un chopper N'EST PAS un véhicule routier : il ne peut pas être
// tiré dessus, ne prend pas de dégâts, ne slamme pas et n'est pas
// slammé. Il PEUT tirer, et élimine tout véhicule qui finit un tour
// sur sa case (même le sien). Il est placé via la commande Airstrike
// (voir placeChopperAirstrike ci-dessous) — avant sa première
// utilisation, il n'est nulle part sur le plateau (placed: false).
let nextChopperId = 1;

function createChopper(owner) {
  return {
    id: `chopper-${nextChopperId++}`,
    owner,
    col: null,
    row: null,
    placed: false,
    isChopper: true // permet à resolveShoot() de refuser de le cibler
  };
}

// p.8 : "Place your chopper on any empty space on the board (a space
// with no obstacles)." Un obstacle = un véhicule routier, un AUTRE
// chopper, un hazard (face cachée ou visible), ou une case impassable
// (p.7, "Obstacles"). Retourne {ok:false, reason} si la case n'est
// pas valide, sinon place le chopper et retourne {ok:true}.
function placeChopperAirstrike(tile, allCars, allChoppers, chopper, col, row) {
  const space = getSpace(tile, col, row);

  if (space === null || space === undefined) {
    return { ok: false, reason: "Case hors du plateau." };
  }
  if (space.terrain === TERRAIN.IMPASSABLE) {
    return { ok: false, reason: "Case impassable : pas une case vide." };
  }
  if (space.hazard) {
    return { ok: false, reason: "Case avec un hazard : pas une case vide." };
  }
  if (getCarAt(allCars, col, row)) {
    return { ok: false, reason: "Case occupée par un véhicule : pas une case vide." };
  }
  if (allChoppers.some((c) => c !== chopper && c.placed && c.col === col && c.row === row)) {
    return { ok: false, reason: "Case occupée par un autre chopper : pas une case vide." };
  }

  chopper.col = col;
  chopper.row = row;
  chopper.placed = true;
  return { ok: true };
}

// p.11, END OF TURN : "Any cars in a space with a chopper are
// eliminated." — à appeler par le futur moteur de tour, à la fin de
// CHAQUE tour (pas seulement celui qui vient de placer un chopper).
function eliminateCarsOnChoppers(allCars, allChoppers) {
  const log = [];
  for (const car of allCars) {
    if (car.status === CAR_STATUS.ELIMINATED) continue;
    const onChopper = allChoppers.some((ch) => ch.placed && ch.col === car.col && ch.row === car.row);
    if (onChopper) {
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} finit sur la case d'un chopper → ÉLIMINÉE`);
    }
  }
  return { log };
}

// -----------------------------------------------------------------
// 4. ARC AVANT
// -----------------------------------------------------------------
// Règle (p.9) : une voiture ne peut avancer que dans l'une des 3
// cases de son arc avant : front-left, front, front-right.

function getFrontArc(car) {
  return [
    { name: "front-left", col: car.col + 1, row: car.row - 1 },
    { name: "front", col: car.col + 1, row: car.row },
    { name: "front-right", col: car.col + 1, row: car.row + 1 }
  ];
}

// -----------------------------------------------------------------
// 5. DÉPLACEMENT
// -----------------------------------------------------------------
// Règle (p.9) : une voiture gagne un nombre de déplacements égal au
// dé assigné. Chaque case coûte 1 ou 2 déplacements selon le terrain.
// Une voiture doit utiliser TOUT son déplacement, sauf si un effet
// lui fait perdre ses déplacements restants (dégâts, slam...).
// Le mouvement lui-même gère aussi, au fil des cases : slam,
// résolution des hazards, et sortie du plateau (avant → progression
// des tuiles ; arrière/latéral → élimination).

// Fait entrer une voiture dans UNE case adjacente en respectant le
// coût de terrain (contrairement à forceMoveOneSpace, utilisé par le
// slam, qui ignore ce coût). Partagé entre moveCar (mouvement normal,
// arc avant) et l'effet Dazed (6 directions, coût respecté).
//
// Retourne { log, remaining, stopped, eliminated?, frontExit?,
// insufficientMove?, slam? }. stopped=true signifie que la séquence
// de déplacement en cours doit s'arrêter là (élimination, slam, ou
// pas assez de déplacement pour cette case).
function enterAdjacentSpace(tile, car, allCars, targetCol, targetRow, remaining, slamOptions = {}, suppressOccupantSlam = false) {
  const log = [];
  const space = getSpace(tile, targetCol, targetRow);

  if (space === null) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} sort par le bord latéral → ÉLIMINÉE`);
    return { log, remaining: 0, stopped: true, eliminated: true };
  }

  if (space === undefined) {
    if (targetCol < 0) {
      // p.5-6 : sortie par le bord ARRIÈRE du plateau → élimination,
      // même règle que la sortie latérale.
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} sort par le bord ARRIÈRE du plateau → ÉLIMINÉE`);
      return { log, remaining: 0, stopped: true, eliminated: true };
    }
    // targetCol >= tile.cols : sortie par l'AVANT — PAS une
    // élimination. Signal distinct pour l'orchestrateur de
    // progression des tuiles (voir advanceBoardOnFrontExit),
    // qui décide la suite (décalage des tuiles + poursuite du
    // mouvement, ou victoire si tuile finale + ligne d'arrivée).
    log.push(`${car.id} atteint le bord AVANT du plateau (sortie par l'avant)`);
    return { log, remaining, stopped: true, frontExit: true };
  }

  if (space.terrain === TERRAIN.IMPASSABLE) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} entre sur une case impassable → ÉLIMINÉE`);
    return { log, remaining: 0, stopped: true, eliminated: true };
  }

  const cost = MOVE_COST[space.terrain];
  const mudExceptionApplies = space.terrain === TERRAIN.MUD && remaining === 1; // p.7

  if (cost > remaining && !mudExceptionApplies) {
    return { log, remaining, stopped: true, insufficientMove: true };
  }

  car.col = targetCol;
  car.row = targetRow;
  let newRemaining = mudExceptionApplies ? 0 : remaining - cost;
  log.push(`${car.id} avance vers (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

  // Résolution d'un hazard éventuel (p.7) AVANT la vérification
  // d'occupation : un Wreck fraîchement posé devient lui-même
  // l'occupant à considérer, et résout déjà son propre slam.
  const hazardResult = resolveHazard(tile, allCars, car, newRemaining, slamOptions);
  log.push(...hazardResult.log);
  newRemaining = hazardResult.remaining;
  if (hazardResult.stopped) {
    return {
      log,
      remaining: newRemaining,
      stopped: true,
      eliminated: car.status === CAR_STATUS.ELIMINATED,
      slam: hazardResult.slam
    };
  }

  // NOTE : car.col/car.row peuvent avoir changé si le hazard était un
  // Oil Slick (glissade) — on vérifie donc l'occupation à la position
  // ACTUELLE de la voiture, pas à targetCol/targetRow d'origine.
  const occupant = getCarAt(allCars, car.col, car.row, car);

  if (occupant && suppressOccupantSlam) {
    // p.8 : Drift — la voiture traverse SANS slammer. NOTE : cette
    // exemption ne couvre que l'occupation "classique" (véhicule déjà
    // présent) — pas un slam déclenché par un hazard (ex. Wreck), qui
    // est déjà résolu plus haut avant ce point, indépendamment de Drift.
    log.push(`${car.id} traverse la case de ${occupant.id} sans la slammer (Drift)`);
    return { log, remaining: newRemaining, stopped: false, driftPassThrough: true };
  }

  if (occupant) {
    log.push(`${car.id} entre dans la case de ${occupant.id} → SLAM`);
    const slamResult = resolveSlam(tile, allCars, car, occupant, slamOptions);
    log.push(...slamResult.log);
    return { log, remaining: 0, stopped: true, slam: slamResult };
  }

  return { log, remaining: newRemaining, stopped: false };
}

function moveCar(tile, car, dieValue, chosenPath, allCars = [], slamOptions = {}) {
  // chosenPath : liste de directions ("front-left" | "front" | "front-right"),
  // une par case franchie. Pour l'étape 1, c'est le joueur (ou plus
  // tard l'IA) qui choisit ce chemin à l'avance ; le moteur se
  // contente de vérifier et d'appliquer.
  // allCars : toutes les voitures en jeu, pour détecter les cases occupées.
  //
  // slamOptions.driftAvailable (p.8, commande Drift) : autorise à
  // traverser SANS slammer le PREMIER véhicule rencontré — mais
  // seulement si ce n'est PAS la case où le mouvement va se terminer
  // ("If you end your turn in a space with a road vehicle, you still
  // slam it, even if it is your first slam").
  //
  // slamOptions.startedInStartingArea (p.9, bonus Road, précisé par
  // Mayrik) : au 1er tour de jeu, la voiture entre depuis la zone de
  // départ hors plateau — considérée comme une case route par
  // convention pour l'éligibilité au bonus. À utiliser UNIQUEMENT pour
  // ce cas précis (sinon l'éligibilité se base sur la vraie case de
  // départ de la voiture sur la tuile).

  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: "La voiture n'est pas opérationnelle." };
  }

  let remaining = dieValue;
  const log = [];
  let driftUsed = false;
  const driftAvailable = !!slamOptions.driftAvailable;

  // p.9 : éligibilité au bonus Road — la voiture doit avoir COMMENCÉ
  // son mouvement sur une case route, et être restée sur une case
  // route à CHAQUE étape (y compris après résolution d'un hazard
  // comme Blank/Oil Slick, qui transforment la case en route "sous le
  // capot" — voir enterAdjacentSpace/resolveHazard). Un hazard Oil
  // Slick qui glisse la voiture ne casse pas l'éligibilité SI la
  // case d'atterrissage de la glissade est elle-même une route (ce
  // qui est vérifié naturellement ici, puisqu'on lit la position
  // FINALE de la voiture après résolution complète du hazard).
  let roadEligible = true;
  if (slamOptions.startedInStartingArea !== true) {
    const startSpace = getSpace(tile, car.col, car.row);
    if (!startSpace || startSpace.terrain !== TERRAIN.ROAD) {
      roadEligible = false;
    }
  }

  for (let i = 0; i < chosenPath.length; i++) {
    const direction = chosenPath[i];
    if (remaining <= 0) break;

    const arc = getFrontArc(car);
    const target = arc.find((a) => a.name === direction);
    if (!target) {
      return { ok: false, reason: `Direction invalide : ${direction}` };
    }

    // Anticipation : cette case sera-t-elle celle où le mouvement se
    // termine (dernière du chemin choisi, OU plus de déplacement
    // ensuite) ? Nécessaire pour savoir si Drift peut s'appliquer ICI.
    let isFinalStep = true;
    const lookSpace = getSpace(tile, target.col, target.row);
    if (lookSpace && lookSpace.terrain !== TERRAIN.IMPASSABLE) {
      const lookCost = MOVE_COST[lookSpace.terrain];
      const lookMudException = lookSpace.terrain === TERRAIN.MUD && remaining === 1;
      const predictedRemaining = lookMudException ? 0 : remaining - lookCost;
      const hasMoreSteps = i < chosenPath.length - 1;
      isFinalStep = !(predictedRemaining > 0 && hasMoreSteps);
    }

    const driftEligible = driftAvailable && !driftUsed && !isFinalStep;

    const step = enterAdjacentSpace(tile, car, allCars, target.col, target.row, remaining, slamOptions, driftEligible);
    log.push(...step.log);

    if (step.insufficientMove) {
      return { ok: false, reason: "Pas assez de déplacements restants pour cette case." };
    }

    remaining = step.remaining;

    if (step.driftPassThrough) {
      driftUsed = true; // Drift ne s'applique qu'au PREMIER véhicule traversé (p.8)
    }

    // Suivi de l'éligibilité au bonus Road : on lit la position
    // ACTUELLE de la voiture (après résolution complète du hazard,
    // y compris une éventuelle glissade Oil Slick) plutôt que la
    // case initialement visée.
    if (roadEligible && car.status !== CAR_STATUS.ELIMINATED) {
      const enteredSpace = getSpace(tile, car.col, car.row);
      if (!enteredSpace || enteredSpace.terrain !== TERRAIN.ROAD) {
        roadEligible = false;
      }
    }

    if (step.eliminated) return { ok: true, log, eliminated: true, roadEligible, stepsConsumed: i };
    if (step.frontExit) return { ok: true, log, remaining, frontExit: true, roadEligible, stepsConsumed: i };
    if (step.slam) return { ok: true, log, remaining: 0, slam: step.slam, roadEligible, stepsConsumed: i };
  }

  return { ok: true, log, remaining, roadEligible };
}

// -----------------------------------------------------------------
// 6. UTILITAIRES : voiture présente à une position
// -----------------------------------------------------------------

function getCarAt(allCars, col, row, excludeCar = null) {
  return allCars.find(
    (c) =>
      c !== excludeCar &&
      c.col === col &&
      c.row === row &&
      c.status !== CAR_STATUS.ELIMINATED
  );
}

// -----------------------------------------------------------------
// 7. SLAM (p.9-10)
// -----------------------------------------------------------------
// Quand deux voitures se retrouvent dans la même case, elles se
// slamment. Le dé de Slam désigne laquelle des deux bouge (voiture
// du dessus ou du dessous), le dé de Direction indique où. La
// voiture désignée est déplacée d'UNE case dans cette direction,
// quel que soit le coût d'entrée normal de cette case (règle
// confirmée par Mayrik) — mais les effets de la case d'arrivée
// s'appliquent normalement une fois dessus.
//
// Toutes les 6 directions possibles (pas seulement l'arc avant,
// contrairement au mouvement normal).

const DIRECTIONS = {
  front: { dCol: 1, dRow: 0 },
  "front-left": { dCol: 1, dRow: -1 },
  "front-right": { dCol: 1, dRow: 1 },
  rear: { dCol: -1, dRow: 0 },
  "rear-left": { dCol: -1, dRow: -1 },
  "rear-right": { dCol: -1, dRow: 1 }
};

const SIZE_RANK = {
  [CAR_SIZE.SMALL]: 1,
  [CAR_SIZE.MEDIUM]: 2,
  [CAR_SIZE.LARGE]: 3
};

// Dé de slam à 6 faces : 2 faces "top", 4 faces "bottom" (p.10).
// injectedValue permet de forcer un résultat précis pour les tests.
function rollSlamDie(injectedValue = null) {
  if (injectedValue) return injectedValue; // "top" | "bottom"
  return DICE_FACES.SLAM[Math.floor(Math.random() * DICE_FACES.SLAM.length)];
}

// Dé de direction à 6 faces, une par direction (p.10).
// injectedValue permet de forcer une direction précise pour les tests.
function rollDirectionDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const faces = Object.keys(DIRECTIONS);
  return faces[Math.floor(Math.random() * faces.length)];
}

// Dé de cascade (Stunt) à 6 faces : 1-2-2-3-3-4 (confirmé par Mayrik).
// Utilisé par les jetons Dazed et Blast Off.
function rollStuntDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  return DICE_FACES.STUNT[Math.floor(Math.random() * DICE_FACES.STUNT.length)];
}

// Dé de tir à 6 faces : large×3, medium×1, small-medium×1, any×1
// (confirmé par Mayrik, correspond à DICE_FACES.SHOOTING).
function rollShootingDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  return DICE_FACES.SHOOTING[Math.floor(Math.random() * DICE_FACES.SHOOTING.length)];
}

// Dé Road à 6 faces : 1-1-1-2-2-3 (confirmé par Mayrik). Tiré une
// seule fois par round, par le 1er joueur (p.9). NOTE : ce dé n'est
// pour l'instant utilisé QUE pour la rotation de round (qui le tire,
// quand) — le BONUS de déplacement qu'il donne aux voitures restées
// sur route n'est pas encore implémenté dans moveCar (voir p.9 :
// "if their car started on and moved on only road spaces, that car
// may immediately gain moves equal to the road die").
function rollRoadDie(injectedValue = null) {
  if (injectedValue) return injectedValue;
  return DICE_FACES.ROAD[Math.floor(Math.random() * DICE_FACES.ROAD.length)];
}

// p.9 : BONUS DU DÉ ROAD. Une fois le mouvement normal terminé, si
// moveResult.roadEligible est vrai (voiture restée sur route du
// début à la fin de son mouvement, voir moveCar), le joueur peut
// choisir d'utiliser ce bonus : +roadDieValue déplacements
// supplémentaires, qui eux N'ONT PAS besoin de rester sur route.
// Optionnel, mais s'il est utilisé, il doit l'être EN ENTIER (pas de
// bonus partiel) — modélisé simplement en passant la valeur complète
// à moveCar, qui consomme toujours son dé en entier sauf incident
// (élimination, slam, sortie de tuile).
function applyRoadBonus(tile, car, moveResult, allCars, roadDieValue, bonusChosenPath, slamOptions = {}) {
  const log = [];

  if (!moveResult || !moveResult.roadEligible) {
    return { ok: false, reason: "Mouvement non éligible au bonus Road (pas resté entièrement sur route).", log };
  }
  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: `${car.id} n'est plus opérable, bonus Road impossible.`, log };
  }

  log.push(`BONUS ROAD : ${car.id} était restée sur route → +${roadDieValue} déplacement(s) (peut désormais quitter la route)`);
  const bonusMoveResult = moveCar(tile, car, roadDieValue, bonusChosenPath, allCars, slamOptions);
  log.push(...bonusMoveResult.log);

  return { ok: true, log, bonusMoveResult };
}

// Déplace une voiture d'UNE case dans une direction donnée, sans
// tenir compte du coût de terrain (utilisé par le slam, et plus
// tard par les effets d'extension type rampe/desert glass).
// Retourne un log, et déclenche récursivement un nouveau slam si la
// case d'arrivée est déjà occupée (chaîne de slams, p.9).
//
// options est transmis tel quel aux slams en chaîne éventuels
// (mêmes forcedDice / decideReroll que le slam d'origine).
function forceMoveOneSpace(tile, car, allCars, directionName, options = {}) {
  const log = [];
  const delta = DIRECTIONS[directionName];
  const targetCol = car.col + delta.dCol;
  const targetRow = car.row + delta.dRow;

  const space = getSpace(tile, targetCol, targetRow);

  if (space === null) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} est projetée hors du bord latéral → ÉLIMINÉE`);
    return { log };
  }

  if (space === undefined) {
    if (targetCol < 0) {
      // p.5-6 : sortie par le bord ARRIÈRE → élimination (ex. voiture
      // projetée vers l'arrière par un slam ou un Skid).
      car.status = CAR_STATUS.ELIMINATED;
      log.push(`${car.id} est projetée hors du bord ARRIÈRE du plateau → ÉLIMINÉE`);
      return { log, eliminated: true };
    }
    // targetCol >= tile.cols : projetée hors de l'avant du plateau —
    // même signal que dans enterAdjacentSpace, à gérer par la
    // progression des tuiles (cas rare mais possible : slam qui
    // pousse une voiture par-dessus le bord avant).
    log.push(`${car.id} est projetée hors du bord AVANT du plateau`);
    return { log, frontExit: true };
  }

  if (space.terrain === TERRAIN.IMPASSABLE) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} est projetée sur une case impassable → ÉLIMINÉE`);
    return { log };
  }

  car.col = targetCol;
  car.row = targetRow;
  log.push(`${car.id} est projetée en ${directionName} vers (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

  // Résolution d'un hazard éventuel (p.7) avant la vérification
  // d'occupation, même logique que dans enterAdjacentSpace.
  const hazardResult = resolveHazard(tile, allCars, car, 0, options);
  log.push(...hazardResult.log);
  if (hazardResult.stopped) {
    // On fait remonter le slam éventuel (ex. Wreck) à l'appelant —
    // utile notamment pour Oil Slick, qui doit savoir si sa glissade
    // a déclenché un slam.
    return { log, slam: hazardResult.slam, eliminated: car.status === CAR_STATUS.ELIMINATED };
  }

  const occupant = getCarAt(allCars, car.col, car.row, car);
  if (occupant) {
    log.push(`${car.id} atterrit sur ${occupant.id} → nouveau slam en chaîne`);
    const chained = resolveSlam(tile, allCars, car, occupant, options);
    log.push(...chained.log);
    return { log, slam: chained };
  }

  return { log };
}

// Résout un slam entre deux voitures empilées dans la même case (p.9-10).
//
// options.forcedDice = { slam, direction, rerolledSlam, rerolledDirection }
//   → force les résultats de dés (tests uniquement ; sinon aléatoire).
//
// options.decideReroll = (context) => boolean
//   → appelée UNIQUEMENT quand les deux voitures ont une taille
//   différente (seul cas où la règle p.9 autorise une relance).
//   context = { largerCar, smallerCar, slamRoll, directionRoll }.
//   Cette fonction est le point d'entrée pour brancher plus tard soit
//   une vraie interaction joueur (popup "Relancer ?"), soit une IA
//   simplifiée (ex. relance si le résultat lui est défavorable).
//   Par défaut, ne relance jamais (comportement neutre tant qu'aucun
//   joueur/IA n'est branché).
function resolveSlam(tile, allCars, topCar, bottomCar, options = {}) {
  const { forcedDice = {}, decideReroll = () => false } = options;
  const log = [];

  let slamRoll = rollSlamDie(forcedDice.slam);
  let directionRoll = rollDirectionDie(forcedDice.direction);
  log.push(`Dé de slam : ${slamRoll} | Dé de direction : ${directionRoll}`);

  const topRank = SIZE_RANK[topCar.size];
  const bottomRank = SIZE_RANK[bottomCar.size];

  if (topRank !== bottomRank) {
    const largerCar = topRank > bottomRank ? topCar : bottomCar;
    const smallerCar = topRank > bottomRank ? bottomCar : topCar;

    const wantsReroll = decideReroll({ largerCar, smallerCar, slamRoll, directionRoll });
    if (wantsReroll) {
      log.push(`${largerCar.id} (voiture plus grande) demande la relance des deux dés`);
      slamRoll = rollSlamDie(forcedDice.rerolledSlam);
      directionRoll = rollDirectionDie(forcedDice.rerolledDirection);
      log.push(`Relance → Dé de slam : ${slamRoll} | Dé de direction : ${directionRoll}`);
    }
  }

  const movingCar = slamRoll === "top" ? topCar : bottomCar;
  log.push(`→ ${movingCar.id} bouge en ${directionRoll}`);

  const moveResult = forceMoveOneSpace(tile, movingCar, allCars, directionRoll, options);
  log.push(...moveResult.log);

  return { log, movingCar, direction: directionRoll };
}

// -----------------------------------------------------------------
// 7bis. HAZARDS (p.7)
// -----------------------------------------------------------------
// Noms de variables alignés sur le matériel officiel (fiche BGG) :
// Blank, Oil Slick, Dirt, Mine, Wreck — 26 jetons au total.
//
// Simplification valable dans les deux cas du rulebook ("discard
// after resolving" pour Mine/Wreck, "remain on board" pour
// Blank/Dirt/Oil Slick qui transforment la case en terrain permanent) :
// CHAQUE jeton ne se déclenche qu'UNE SEULE fois. Pas besoin de suivre
// un état face cachée/face visible séparé — resolveHazard() efface
// toujours le hazard de la case après l'avoir résolu.

const HAZARD_TYPES = {
  BLANK: "blank",       // p.7 "Road" — la case devient une case de route
  OIL_SLICK: "oil_slick",
  DIRT: "dirt",          // p.7 "Mud" — la case devient une case de boue
  MINE: "mine",
  WRECK: "wreck"
};

const HAZARD_TOKEN_COMPOSITION = [
  { type: HAZARD_TYPES.BLANK, count: 6 },
  { type: HAZARD_TYPES.OIL_SLICK, count: 6 },
  { type: HAZARD_TYPES.DIRT, count: 6 },
  { type: HAZARD_TYPES.MINE, count: 4 },
  { type: HAZARD_TYPES.WRECK, count: 4 }
]; // total : 26

function drawHazardToken(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const pool = [];
  for (const entry of HAZARD_TOKEN_COMPOSITION) {
    for (let i = 0; i < entry.count; i++) pool.push(entry.type);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// -----------------------------------------------------------------
// 1ter. CONTENU RÉEL DES TUILES (produit par l'outil de tagging,
// fichiers tiles/data/*.js) — fait le pont entre le format exporté
// par l'outil et celui utilisé en jeu par le moteur.
// -----------------------------------------------------------------
// L'outil de tagging exporte, pour chaque case, `hazard: true/false`
// — une propriété FIXE du design de la vraie tuile physique (case
// marquée du double triangle rouge, oui/non). Le moteur, lui, utilise
// déjà `cell.hazard` pour tout autre chose : le jeton ACTUELLEMENT
// posé sur la case (null tant qu'aucun jeton n'y a été placé, sinon
// une valeur de HAZARD_TYPES). Pour ne jamais confondre ces deux sens
// différents du même mot, le flag fixe est renommé `hazardSpace` dès
// l'instanciation de la tuile — `hazard` reste réservé au jeton
// dynamique, exactement comme avant sur les tuiles de test.
function instantiateTile(rawTileData) {
  const grid = rawTileData.grid.map((row) =>
    row.map((cell) => ({
      terrain: cell.terrain,
      hazardSpace: !!cell.hazard,
      hazard: null // jeton actuel — vide tant que populateTileHazards() ne l'a pas rempli
    }))
  );
  return {
    id: rawTileData.id,
    name: rawTileData.name,
    format: rawTileData.format,
    extension: rawTileData.extension,
    cols: rawTileData.cols,
    rows: rawTileData.rows,
    grid
  };
}

// Pose un jeton hazard fraîchement tiré sur chaque case marquée
// hazardSpace=true d'une tuile qui entre en jeu — mise en place
// initiale des 3 tuiles de départ (voir createTileProgressionState)
// ET nouvelle tuile lead piochée en cours de partie (p.11 étape 7,
// voir advanceBoardOnFrontExit). Sans effet sur une tuile de test
// (createTestTile) qui n'a pas ce marquage — donc aucune régression
// sur les tests déjà en place qui n'utilisent pas de vraies tuiles.
//
// forcedSequence permet des tirages déterministes en test : un jeton
// par case marquée, dans l'ordre de lecture de la grille (rangée par
// rangée, gauche à droite) ; une fois la séquence épuisée, les cases
// restantes retombent sur un tirage aléatoire normal — même
// convention que les autres dés forçables du moteur.
function populateTileHazards(tile, forcedSequence = []) {
  const forced = [...forcedSequence];
  for (const row of tile.grid) {
    for (const cell of row) {
      if (cell.hazardSpace) {
        cell.hazard = drawHazardToken(forced.length ? forced.shift() : null);
      }
    }
  }
}

// Résout le hazard présent sur la case ACTUELLE de la voiture (déjà
// entrée dessus). remaining = déplacement qu'il lui restait avant
// résolution — utile pour Mine (qui le met à 0) et Oil Slick (qui ne
// consomme rien, donc `remaining` ressort inchangé).
//
// Retourne { log, remaining, stopped, slam? }. stopped=true signifie
// que la séquence de mouvement en cours doit s'arrêter (Mine, Wreck,
// ou élimination survenue pendant la résolution).
function resolveHazard(tile, allCars, car, remaining, options = {}) {
  const log = [];
  const cell = getSpace(tile, car.col, car.row);

  if (!cell || !cell.hazard) {
    return { log, remaining, stopped: false };
  }

  const hazardType = cell.hazard;
  log.push(`${car.id} déclenche un hazard : ${hazardType}`);

  switch (hazardType) {
    case HAZARD_TYPES.BLANK: {
      cell.terrain = TERRAIN.ROAD;
      cell.hazard = null;
      log.push("Case transformée en ROUTE (jeton Blank défaussé)");
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.DIRT: {
      cell.terrain = TERRAIN.MUD;
      cell.hazard = null;
      log.push("Case transformée en BOUE (jeton Dirt défaussé)");
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.OIL_SLICK: {
      cell.terrain = TERRAIN.ROAD;
      cell.hazard = null;
      const direction = rollDirectionDie(options.forcedDice?.oilSlickDirection);
      log.push(`Case transformée en ROUTE (jeton Oil Slick défaussé), glissade en ${direction} (ne coûte aucun déplacement)`);
      const slideResult = forceMoveOneSpace(tile, car, allCars, direction, options);
      log.push(...slideResult.log);

      if (car.status === CAR_STATUS.ELIMINATED) {
        return { log, remaining: 0, stopped: true, eliminated: true };
      }

      if (slideResult.slam) {
        // Confirmé par Mayrik : un slam déclenché par la glissade suit
        // EXACTEMENT les règles normales du slam — perte de tout le
        // déplacement restant, empilement, relance possible pour le
        // véhicule strictement plus grand, etc. Tout ça est déjà géré
        // par resolveSlam à l'intérieur de forceMoveOneSpace ci-dessus ;
        // ici on se contente d'aligner remaining/stopped sur ce fait.
        log.push(`${car.id} — slam déclenché par la glissade : traité comme un slam normal (perte du déplacement restant)`);
        return { log, remaining: 0, stopped: true, slam: slideResult.slam };
      }

      // p.7 : "does not cost a move, and the vehicle continues moving
      // if it has moves remaining" → pas de slam, le mouvement en
      // cours continue normalement avec le même `remaining`.
      return { log, remaining, stopped: false };
    }

    case HAZARD_TYPES.MINE: {
      cell.hazard = null;
      log.push("Jeton Mine défaussé");
      const dmgResult = applyDamage(car, { ...options, tile, allCars });
      log.push(...dmgResult.log);
      log.push(`${car.id} perd tout son déplacement restant (Mine)`);
      return { log, remaining: 0, stopped: true };
    }

    case HAZARD_TYPES.WRECK: {
      cell.hazard = null;
      log.push("Jeton Wreck défaussé, une épave apparaît sur la case");
      // p.7 : les épaves sont traitées comme des petites voitures
      // inopérables, slammées comme n'importe quel véhicule.
      const wreckCar = createCar(null, CAR_SIZE.SMALL, car.col, car.row);
      wreckCar.status = CAR_STATUS.INOPERABLE;
      wreckCar.isWreck = true;
      allCars.push(wreckCar);
      log.push(`Épave créée : ${wreckCar.id}`);
      const slamResult = resolveSlam(tile, allCars, car, wreckCar, options);
      log.push(...slamResult.log);
      return { log, remaining: 0, stopped: true, slam: slamResult };
    }

    default:
      return { log, remaining, stopped: false };
  }
}


// Le compteur/statut (opérable → inopérable au 2e dégât) ET le
// contenu réel des 5 types de jetons sont gérés ici.
//
// Répartition exacte des 20 jetons confirmée par Mayrik (fiche
// officielle BoardGameGeek) et intégrée dans DAMAGE_TOKEN_COMPOSITION
// ci-dessous. Le type de jeton reste forçable pour les tests et pour
// la résolution manuelle (mine, tir...).

const TOKEN_TYPES = {
  DENT: "dent",
  SHRAPNEL: "shrapnel",
  SKID: "skid",
  DAZED: "dazed",
  BLAST_OFF: "blast_off"
};

// Composition exacte des 20 jetons de dégâts (source : fiche officielle
// BoardGameGeek du jeu, transmise par Mayrik). Chaque jeton Skid a une
// direction FIXE imprimée dessus (6 jetons, un par direction) — c'est
// donc la composition qui porte cette info, pas un tirage séparé.
const DAMAGE_TOKEN_COMPOSITION = [
  { type: TOKEN_TYPES.DENT, count: 3 },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front-left" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "front-right" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear-left" },
  { type: TOKEN_TYPES.SKID, count: 1, skidDirection: "rear-right" },
  { type: TOKEN_TYPES.SHRAPNEL, count: 3 },
  { type: TOKEN_TYPES.DAZED, count: 3 },
  { type: TOKEN_TYPES.BLAST_OFF, count: 5 }
]; // total : 20

// Tire un jeton au hasard dans la composition ci-dessus (tirage AVEC
// remise pour l'instant — pas encore de pile partagée qui s'épuise
// au fil de la partie ; à revoir si on veut modéliser la vraie pile
// physique qui se vide/se remélange).
// injectedValue permet de forcer un jeton précis pour les tests :
// { type, skidDirection? }.
function drawDamageToken(injectedValue = null) {
  if (injectedValue) return injectedValue;
  const pool = [];
  for (const entry of DAMAGE_TOKEN_COMPOSITION) {
    for (let i = 0; i < entry.count; i++) {
      pool.push({ type: entry.type, skidDirection: entry.skidDirection || null });
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Résout l'effet d'un jeton de dégâts déjà tiré (p.12).
// tokenType : une valeur de TOKEN_TYPES.
// options : { forcedDice, skidDirection, decideReroll } — forcedDice
// peut contenir shrapnelDirection / dazedStunt / dazedDirections
// (tableau, une direction par case) / blastOffDirection / blastOffStunt.
function resolveDamageToken(tile, allCars, car, tokenType, options = {}) {
  const forcedDice = options.forcedDice || {};
  const log = [];

  switch (tokenType) {
    case TOKEN_TYPES.DENT: {
      log.push(`${car.id} — jeton DENT : aucun effet`);
      break;
    }

    case TOKEN_TYPES.SHRAPNEL: {
      // p.12 : dé de direction, ligne droite en ignorant tout terrain
      // (même impassable), jusqu'au premier véhicule rencontré ou au
      // bord du plateau (auquel cas rien ne se passe).
      const direction = rollDirectionDie(forcedDice.shrapnelDirection);
      log.push(`${car.id} — jeton SHRAPNEL : direction ${direction}`);
      const delta = DIRECTIONS[direction];
      let scanCol = car.col + delta.dCol;
      let scanRow = car.row + delta.dRow;
      let hit = null;

      while (true) {
        const space = getSpace(tile, scanCol, scanRow);
        if (space === null || space === undefined) break; // bord du plateau atteint
        const occupant = getCarAt(allCars, scanCol, scanRow);
        if (occupant) {
          hit = occupant;
          break;
        }
        scanCol += delta.dCol;
        scanRow += delta.dRow;
      }

      if (hit) {
        log.push(`Shrapnel touche ${hit.id} (même si c'est une des vôtres)`);
        const hitResult = applyDamage(hit, {
          tokenType: TOKEN_TYPES.DENT, // simplification : pas de pioche en cascade pour la voiture touchée
          tile,
          allCars,
          forcedDice,
          decideReroll: options.decideReroll
        });
        log.push(...hitResult.log);
      } else {
        log.push("Shrapnel ne touche rien (bord du plateau atteint)");
      }
      break;
    }

    case TOKEN_TYPES.SKID: {
      // p.12 : 6 jetons différents, chacun avec une direction FIXE
      // imprimée dessus (pas un dé) — direction obligatoire à fournir.
      const direction = options.skidDirection;
      if (!direction) {
        log.push(`${car.id} — jeton SKID : direction manquante (bug d'appel, à corriger)`);
        break;
      }
      log.push(`${car.id} — jeton SKID : direction fixe ${direction}`);
      // Même comportement que le slam : coût de terrain ignoré,
      // élimination si bord/impassable, slam en chaîne si occupé.
      const moveResult = forceMoveOneSpace(tile, car, allCars, direction, options);
      log.push(...moveResult.log);
      break;
    }

    case TOKEN_TYPES.DAZED: {
      // p.12 : dé de cascade = nombre de cases, direction RELANCÉE à
      // chaque case, coût de terrain RESPECTÉ (contrairement à Skid),
      // s'arrête plus tôt si une case fait perdre les déplacements
      // restants (ex. slam).
      let remaining = rollStuntDie(forcedDice.dazedStunt);
      log.push(`${car.id} — jeton DAZED : dé de cascade = ${remaining}`);
      let step = 0;
      while (remaining > 0) {
        const forcedStepDirection = forcedDice.dazedDirections ? forcedDice.dazedDirections[step] : null;
        const direction = rollDirectionDie(forcedStepDirection);
        const delta = DIRECTIONS[direction];
        const targetCol = car.col + delta.dCol;
        const targetRow = car.row + delta.dRow;
        log.push(`  Étape ${step + 1} — direction ${direction}`);

        const stepResult = enterAdjacentSpace(tile, car, allCars, targetCol, targetRow, remaining, options);
        log.push(...stepResult.log);
        remaining = stepResult.remaining;
        step++;

        if (stepResult.stopped) {
          log.push("Dazed s'arrête (élimination, slam, ou plus assez de déplacement)");
          break;
        }
      }
      break;
    }

    case TOKEN_TYPES.BLAST_OFF: {
      // p.12 : dé de direction + dé de cascade = distance en une seule
      // fois, cases intermédiaires totalement ignorées (pas de coût,
      // pas de résolution de hazard sur le trajet). Seule la case
      // d'arrivée compte.
      const direction = rollDirectionDie(forcedDice.blastOffDirection);
      const distance = rollStuntDie(forcedDice.blastOffStunt);
      log.push(`${car.id} — jeton BLAST OFF : direction ${direction}, distance ${distance} (cases intermédiaires ignorées)`);
      const delta = DIRECTIONS[direction];
      let targetCol = car.col + delta.dCol * distance;
      const targetRow = car.row + delta.dRow * distance;

      // p.11, précisé par Mayrik : si le saut dépasse le bord AVANT du
      // plateau, deux cas — soit ça déclenche la progression normale
      // des tuiles (décalage), soit, si la Finish Line est déjà en
      // place, ça donne directement la victoire. Nécessite que
      // l'appelant ait fourni options.progressionState (le vrai état
      // à 3-4 tuiles, pas juste le "tile" local) — sinon (appel direct
      // hors du moteur de tour avec progression) on garde l'ancien
      // comportement simplifié ci-dessous, inchangé.
      const progState = options.progressionState;
      if (progState) {
        let currentBoard = buildBoardFromProgressionState(progState);

        // Tant que la cible dépasse le bord avant du plateau ACTUEL et
        // qu'aucune Finish Line n'existe encore, on décale les tuiles
        // et on rebase la cible en conséquence — même logique que la
        // progression normale (advanceBoardOnFrontExit rebase déjà
        // toutes les voitures, dont celle-ci, de -tileCols ; on
        // applique le même rebasage à `targetCol`, qui n'est pas
        // encore assignée à car.col à ce stade).
        while (!progState.finishLineTile && targetCol >= currentBoard.cols) {
          const tileCols = progState.rearTile.cols;
          const advanceResult = advanceBoardOnFrontExit(progState, allCars, options.allChoppers || [], {});
          log.push(...advanceResult.log);
          if (!advanceResult.ok) {
            log.push(`${car.id} — Blast Off interrompu : ${advanceResult.reason}`);
            return { log };
          }
          targetCol -= tileCols;
          currentBoard = advanceResult.newBoard;
        }

        // Si la Finish Line existe (déjà en place, ou tout juste
        // ajoutée par le décalage ci-dessus si les conditions étaient
        // réunies), une cible qui atteint/dépasse son seuil est une
        // victoire — la simple comparaison numérique suffit, pas
        // besoin que la case existe réellement dans la grille
        // (checkGameEndConditions, appelé par l'orchestrateur juste
        // après, la détectera automatiquement).
        if (progState.finishLineTile) {
          const finishColStart = progState.rearTile.cols + progState.middleTile.cols + progState.leadTile.cols;
          if (targetCol >= finishColStart) {
            car.col = targetCol;
            car.row = targetRow;
            log.push(`${car.id} atterrit sur la Finish Line via Blast Off !`);
            break;
          }
        }

        // Cible désormais dans les limites du plateau à jour : on
        // continue avec la résolution normale ci-dessous, sur ce
        // plateau reconstruit.
        car.col = targetCol;
        car.row = targetRow;
        const finalSpace = getSpace(currentBoard, targetCol, targetRow);
        if (!finalSpace) {
          log.push(`${car.id} atterrit hors des limites du plateau reconstruit (cas limite) → position conservée sans résolution supplémentaire`);
          break;
        }
        log.push(`${car.id} atterrit en (col ${targetCol}, row ${targetRow}) — terrain ${finalSpace.terrain}`);
        if (finalSpace.terrain === TERRAIN.IMPASSABLE) {
          car.status = CAR_STATUS.ELIMINATED;
          log.push(`${car.id} atterrit sur une case impassable → ÉLIMINÉE`);
          break;
        }
        const hazardResult2 = resolveHazard(currentBoard, allCars, car, 0, options);
        log.push(...hazardResult2.log);
        if (hazardResult2.stopped) break;
        const occupant2 = getCarAt(allCars, car.col, car.row, car);
        if (occupant2) {
          log.push(`${car.id} atterrit sur ${occupant2.id} → SLAM`);
          const slamResult2 = resolveSlam(currentBoard, allCars, car, occupant2, options);
          log.push(...slamResult2.log);
        }
        break;
      }

      const space = getSpace(tile, targetCol, targetRow);
      if (space === null) {
        car.status = CAR_STATUS.ELIMINATED;
        log.push(`${car.id} atterrit hors du bord latéral → ÉLIMINÉE`);
        break;
      }
      if (space === undefined) {
        if (targetCol < 0) {
          // Cohérent avec enterAdjacentSpace/forceMoveOneSpace : sortie
          // par l'arrière du plateau → élimination (p.5-6).
          car.status = CAR_STATUS.ELIMINATED;
          log.push(`${car.id} atterrit hors du bord ARRIÈRE du plateau → ÉLIMINÉE`);
          break;
        }
        // Pas de progressionState fourni (appel direct hors du moteur
        // de tour) : impossible de décaler les tuiles ou de vérifier
        // la Finish Line ici — la voiture reste à sa position actuelle.
        log.push(`${car.id} atterrirait hors du bord AVANT du plateau (aucun état de progression fourni : position conservée)`);
        break;
      }
      if (space.terrain === TERRAIN.IMPASSABLE) {
        car.status = CAR_STATUS.ELIMINATED;
        log.push(`${car.id} atterrit sur une case impassable → ÉLIMINÉE`);
        break;
      }

      car.col = targetCol;
      car.row = targetRow;
      log.push(`${car.id} atterrit en (col ${targetCol}, row ${targetRow}) — terrain ${space.terrain}`);

      // p.12 : "You are still affected by the space you move into" —
      // un hazard sur la case d'ARRIVÉE s'applique normalement (mais
      // pas sur les cases ignorées entre les deux).
      const hazardResult = resolveHazard(tile, allCars, car, 0, options);
      log.push(...hazardResult.log);
      if (hazardResult.stopped) break;

      const occupant = getCarAt(allCars, car.col, car.row, car);
      if (occupant) {
        log.push(`${car.id} atterrit sur ${occupant.id} → SLAM`);
        const slamResult = resolveSlam(tile, allCars, car, occupant, options);
        log.push(...slamResult.log);
      }
      break;
    }
  }

  return { log };
}

// -----------------------------------------------------------------
// 8. DÉGÂTS ET STATUT (p.6, p.8, p.12)
// -----------------------------------------------------------------

// Applique un dégât à une voiture. Retourne applied:false si le
// dégât est ignoré (voiture déjà inopérable, p.6 : "cannot take
// additional damage ; if it would, ignore it").
//
// options.tokenType : force le type de jeton (sinon tiré via
// drawDamageToken() selon la vraie répartition, voir
// DAMAGE_TOKEN_COMPOSITION plus haut).
// options.tile / options.allCars : nécessaires pour résoudre les
// effets qui déplacent la voiture (Skid/Dazed/Blast Off) ou qui
// touchent une autre voiture (Shrapnel). Sans eux, seul le
// compteur/statut est mis à jour (utile pour les tests qui ne
// testent que ça).
//
// NOTE : si la voiture était EN TRAIN de bouger quand elle prend le
// dégât (ex. hazard Mine pendant un mouvement), elle perd tout
// déplacement restant — déjà géré à l'appel, voir le cas MINE dans
// resolveHazard() plus haut (remaining mis à 0 après applyDamage).
function applyDamage(car, options = {}) {
  const log = [];

  if (car.status === CAR_STATUS.ELIMINATED) {
    return { log, applied: false };
  }

  // p.7 : "Wrecks are eliminated ... [if they] take any damage." —
  // règle spéciale, à vérifier AVANT la règle générale d'inopérabilité
  // ci-dessous, car une épave est TOUJOURS inopérable par construction
  // (sinon cette règle spéciale ne se déclencherait jamais : elle
  // serait immédiatement absorbée par le cas "déjà inopérable = dégât
  // ignoré" qui s'applique aux voitures normales).
  if (car.isWreck) {
    car.status = CAR_STATUS.ELIMINATED;
    log.push(`${car.id} (épave) prend un dégât → ÉLIMINÉE (règle spéciale des épaves, p.7)`);
    return { log, applied: true, eliminated: true };
  }

  if (car.status === CAR_STATUS.INOPERABLE) {
    log.push(`${car.id} est déjà inopérable → dégât ignoré (aucun jeton pioché)`);
    return { log, applied: false };
  }

  let tokenType = options.tokenType;
  let skidDirection = options.skidDirection;

  if (!tokenType) {
    const drawn = drawDamageToken(options.forcedDice?.drawnToken);
    tokenType = drawn.type;
    if (tokenType === TOKEN_TYPES.SKID && !skidDirection) {
      skidDirection = drawn.skidDirection;
    }
  }

  car.damageTokens.push({ type: tokenType });
  log.push(`${car.id} reçoit un dégât — jeton ${tokenType} (total : ${car.damageTokens.length}/2)`);

  if (car.damageTokens.length >= 2) {
    car.status = CAR_STATUS.INOPERABLE;
    car.facingReversed = true; // "Turn the car to face backward on the road tile" (p.6)
    log.push(`${car.id} devient INOPÉRABLE (2e dégât) → tourne face arrière`);
  }

  if (options.tile && options.allCars) {
    const effectResult = resolveDamageToken(options.tile, options.allCars, car, tokenType, { ...options, skidDirection });
    log.push(...effectResult.log);
  }

  return { log, applied: true };
}

// -----------------------------------------------------------------
// 9. TIR (p.10)
// -----------------------------------------------------------------
// Fonctionne aussi bien pour un tir DEPUIS une voiture que DEPUIS un
// chopper (Airstrike) — resolveShoot() ne lit que .col/.row/arc avant
// du tireur, donc un chopper (voir createChopper) fonctionne sans
// code spécifique. La règle "ne peut pas tirer sur UN chopper" (comme
// cible) est vérifiée explicitement ci-dessous via target.isChopper.
// "Premier round : pas de tir" reste une règle de structure de tour
// (compteur de round), appliquée au niveau du moteur de tour complet
// (playTurnAssignMove/playTurnCoast), pas ici.

// Résout un tir d'une voiture vers une autre (ou une épave — p.10 :
// "You may shoot wrecks. Wrecks are treated as inoperable small cars.
// If a wreck takes any damage, it is eliminated" — déjà géré par la
// règle spéciale des épaves dans applyDamage).
//
// options.forcedDice.shootingDie force le résultat du dé pour les tests.
function resolveShoot(tile, allCars, shooter, target, options = {}) {
  const log = [];
  const forcedDice = options.forcedDice || {};

  // p.10 : "You may not shoot choppers."
  if (target.isChopper) {
    log.push(`${target.id} est un chopper → impossible de lui tirer dessus`);
    return { log, hit: false };
  }

  // p.10 : on ne peut tirer que sur une cible dans son arc avant —
  // même règle géométrique que le mouvement (p.9, "Front Arc").
  const arc = getFrontArc(shooter);
  const inArc = arc.some((a) => a.col === target.col && a.row === target.row);
  if (!inArc) {
    log.push(`${target.id} n'est pas dans l'arc avant de ${shooter.id} → tir impossible`);
    return { log, hit: false };
  }

  const roll = rollShootingDie(forcedDice.shootingDie);
  log.push(`${shooter.id} tire sur ${target.id} (taille ${target.size}) — dé de tir : ${roll}`);

  // p.10 : le dé touche si sa valeur correspond exactement à la
  // taille de la cible, "small-medium" touchant Small OU Medium, et
  // "any" touchant n'importe quelle taille.
  const isHit =
    roll === "any" ||
    (roll === "small-medium" && (target.size === CAR_SIZE.SMALL || target.size === CAR_SIZE.MEDIUM)) ||
    roll === target.size;

  if (!isHit) {
    log.push(`Raté — le dé ne correspond pas à la taille de ${target.id}`);
    return { log, hit: false };
  }

  log.push(`Touché !`);
  const dmgResult = applyDamage(target, { ...options, tile, allCars });
  log.push(...dmgResult.log);

  return { log, hit: true, damageResult: dmgResult };
}

// Commande Repair (p.8, dé = 6) : retire un dégât et rend
// l'opérabilité si la voiture était inopérable.
function repairCar(car) {
  const log = [];

  if (car.status === CAR_STATUS.ELIMINATED) {
    log.push(`${car.id} est éliminée, impossible à réparer`);
    return { log, repaired: false };
  }

  if (car.damageTokens.length === 0) {
    log.push(`${car.id} n'a aucun dégât à réparer`);
    return { log, repaired: false };
  }

  car.damageTokens.pop(); // remis dans la pile de jetons — pas modélisé ici (pas encore de pile globale)
  log.push(`${car.id} répare un dégât (reste : ${car.damageTokens.length}/2)`);

  if (car.status === CAR_STATUS.INOPERABLE && car.damageTokens.length < 2) {
    car.status = CAR_STATUS.OPERABLE;
    car.facingReversed = false;
    log.push(`${car.id} redevient OPÉRABLE (et pourra bouger plus tard ce round si un tour lui reste)`);
  }

  return { log, repaired: true };
}

// -----------------------------------------------------------------
// 11. COMMAND BOARD (p.8) — ÉTAPE 2 DU MOTEUR DE TOUR
// -----------------------------------------------------------------
// Chaque commande valide son propre dé (certaines exigent une valeur
// précise) et applique son effet. La règle "une seule commande par
// ROUND" et "commande activée AVANT le mouvement de la voiture
// assignée" seront appliquées par le futur assemblage du tour complet
// (playTurnAssignMove sera étendu pour orchestrer tout ça) — ces 4
// fonctions restent volontairement indépendantes et testables seules.

// AIRSTRIKE (n'importe quel dé, p.8) : place le chopper sur une case
// vide, puis tire avec s'il en a l'occasion ("if able" — si
// options.shootTarget est fourni ET valide, sinon aucun tir n'a lieu,
// ce n'est pas une erreur). La règle "pas de tir au 1er round"
// s'appliquera au niveau du futur moteur de round complet.
function resolveAirstrikeCommand(tile, allCars, allChoppers, chopper, col, row, options = {}) {
  const log = [];

  const placeResult = placeChopperAirstrike(tile, allCars, allChoppers, chopper, col, row);
  if (!placeResult.ok) {
    return { ok: false, reason: placeResult.reason };
  }
  log.push(`AIRSTRIKE : chopper de ${chopper.owner} placé en (col ${col}, row ${row})`);

  let shootResult = null;
  if (options.shootTarget) {
    shootResult = resolveShoot(tile, allCars, chopper, options.shootTarget, options);
    log.push(...shootResult.log);
  }

  return { ok: true, log, shootResult };
}

// NITRO (dé 1-3, p.8) : augmente le mouvement de la voiture assignée
// de la valeur de CE dé, en plus du dé de mouvement normal. Fonction
// pure : elle ne fait que calculer/valider le bonus, à additionner au
// dé de mouvement avant d'appeler moveCar (composition faite par le
// futur assemblage du tour).
function resolveNitroCommand(dieValue) {
  if (dieValue < 1 || dieValue > 3) {
    return { ok: false, reason: "Nitro nécessite un dé de valeur 1 à 3." };
  }
  return { ok: true, bonus: dieValue };
}

// DRIFT (dé 3-5, p.8) : valide le dé et renvoie le flag à transmettre
// à moveCar (slamOptions.driftAvailable) — la mécanique elle-même est
// déjà intégrée dans moveCar/enterAdjacentSpace (voir plus haut).
function resolveDriftCommand(dieValue) {
  if (dieValue < 3 || dieValue > 5) {
    return { ok: false, reason: "Drift nécessite un dé de valeur 3 à 5." };
  }
  return { ok: true, driftAvailable: true };
}

// REPAIR (dé 6, p.8) : valide le dé, puis délègue à repairCar() déjà
// existant et testé.
function resolveRepairCommand(dieValue, car) {
  if (dieValue !== 6) {
    return { ok: false, reason: "Repair nécessite un dé de valeur 6." };
  }
  return { ok: true, ...repairCar(car) };
}

// -----------------------------------------------------------------
// 12. MOTEUR DE TOUR — ASSIGN + MOVE + SHOOT + END OF TURN (p.8, p.11)
// -----------------------------------------------------------------
// playTurnAssignMove() (et sa variante playTurnAssignMoveWithProgression
// plus bas) couvre, pour UNE voiture d'UN joueur :
//   1. ASSIGN : vérifie que la voiture est opérable et n'a pas déjà
//      été assignée ce round (p.8).
//   2. MOVE : délègue à moveCar() (ou moveCarWithProgression pour la
//      variante multi-tuiles), déjà entièrement testés.
//   3. SHOOT (p.10) : voir resolveShootStep() ci-dessous.
//   4. END OF TURN (p.11) : marque la voiture comme "déjà jouée ce
//      round", puis vérifie l'élimination par chopper — cette
//      dernière vérification porte sur TOUTES les voitures en jeu,
//      pas seulement celle qui vient de bouger (conforme à la règle,
//      qui ne limite pas cette vérification à la voiture du tour).
// Le Command board (Airstrike/Nitro/Drift/Repair) et Coast sont des
// briques séparées (voir plus haut/bas), composées par l'appelant
// avant d'invoquer ces fonctions (ex. Nitro augmente dieValue, Drift
// passe par slamOptions.driftAvailable).

// Étape SHOOT commune à playTurnAssignMove/playTurnCoast et leurs
// variantes avec progression — évite de dupliquer 4 fois la même
// logique de validation (cible fournie ? 1er round ? voiture encore
// opérable ?).
//
// "The car you moved ... may shoot" — MÊME après un slam (p.10 :
// "You may shoot after resolving a slam"), donc cette étape ne
// bloque PAS le tir juste parce que le mouvement contenait un slam
// ou s'est arrêté prématurément. Elle bloque seulement si :
//   - aucune cible n'a été fournie (pas de tir tenté, "if able")
//   - le 1er round (armes pas encore actives, p.10) — vérifié via
//     options.roundNumber, fourni par le moteur de round
//   - la voiture n'est plus opérable (éliminée ou inopérable) après
//     son mouvement (une voiture inopérable ne peut ni bouger ni
//     tirer, p.6)
function resolveShootStep(board, allCars, car, options) {
  const log = [];
  let shootResult = null;

  if (!options.shootTarget) {
    return { log, shootResult };
  }

  if (options.roundNumber === 1) {
    log.push(`Tir impossible : les armes ne sont pas encore actives au 1er round (p.10)`);
  } else if (car.status !== CAR_STATUS.OPERABLE) {
    log.push(`${car.id} n'est plus opérable → tir impossible`);
  } else {
    shootResult = resolveShoot(board, allCars, car, options.shootTarget, options);
    log.push(...shootResult.log);
  }

  return { log, shootResult };
}

function playTurnAssignMove(tile, car, dieValue, chosenPath, allCars, allChoppers, options = {}) {
  const log = [];

  // --- ASSIGN ---
  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: `${car.id} n'est pas opérable, ne peut pas être assignée.` };
  }
  if (car.movedThisRound) {
    return { ok: false, reason: `${car.id} a déjà été assignée ce round.` };
  }
  log.push(`ASSIGN : dé ${dieValue} assigné à ${car.id}`);

  // --- MOVE ---
  const moveResult = moveCar(tile, car, dieValue, chosenPath, allCars, options);
  log.push(...moveResult.log);

  // --- SHOOT (p.10) ---
  const shootStep = resolveShootStep(tile, allCars, car, options);
  log.push(...shootStep.log);
  const shootResult = shootStep.shootResult;

  // --- END OF TURN (p.11) ---
  // Après le tir, pas juste après le mouvement (ordre exact du tour,
  // p.8 : Assign → Command → Move → Shoot, puis fin de tour).
  car.movedThisRound = true;
  log.push(`END OF TURN : ${car.id} ne pourra plus être assignée ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  return { ok: true, log, moveResult, shootResult };
}

// -----------------------------------------------------------------
// 12bis. ASSIGN + MOVE + SHOOT + END OF TURN — VERSION AVEC PROGRESSION
// -----------------------------------------------------------------
// Identique à playTurnAssignMove ci-dessus (ASSIGN/SHOOT/END OF TURN
// inchangés), sauf que le MOVE passe par moveCarWithProgression (donc
// gère la traversée de plusieurs tuiles, l'ajout de la Finish Line,
// et une victoire éventuelle EN COURS de mouvement), et qu'un ultime
// checkGameEndConditions() ferme le tour — couvre le cas où le tir ou
// l'élimination-par-chopper de fin de tour déclenche la victoire même
// sans que le mouvement lui-même n'ait atteint la Finish Line.
//
// Séparée de playTurnAssignMove (plutôt que de la modifier) pour ne
// prendre AUCUN risque sur les tests déjà en place, qui continuent
// à utiliser la version simple pour tester chaque brique isolément.
function playTurnAssignMoveWithProgression(state, car, dieValue, chosenPath, allCars, allChoppers, playerNames, options = {}) {
  const log = [];

  // --- ASSIGN ---
  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: `${car.id} n'est pas opérable, ne peut pas être assignée.` };
  }
  if (car.movedThisRound) {
    return { ok: false, reason: `${car.id} a déjà été assignée ce round.` };
  }
  log.push(`ASSIGN : dé ${dieValue} assigné à ${car.id}`);

  // --- MOVE (avec progression des tuiles) ---
  const moveResult = moveCarWithProgression(state, car, dieValue, chosenPath, allCars, allChoppers, playerNames, options);
  log.push(...moveResult.log);

  if (!moveResult.ok) {
    return { ok: false, reason: moveResult.reason, log };
  }

  if (moveResult.gameOver) {
    // Victoire en cours de mouvement (entrée sur la Finish Line) :
    // le tour s'arrête là, pas de tir, la partie est terminée.
    car.movedThisRound = true;
    return { ok: true, log, moveResult, gameOver: true, winner: moveResult.winner };
  }

  // --- SHOOT (p.10) ---
  const shootStep = resolveShootStep(buildBoardFromProgressionState(state), allCars, car, { ...options, progressionState: state, allChoppers });
  log.push(...shootStep.log);
  const shootResult = shootStep.shootResult;

  // --- END OF TURN (p.11) ---
  car.movedThisRound = true;
  log.push(`END OF TURN : ${car.id} ne pourra plus être assignée ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  // Vérification finale des conditions de fin de partie (couvre une
  // victoire déclenchée par le tir ou l'élimination-par-chopper qui
  // vient d'avoir lieu, pas seulement par le mouvement).
  const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
  log.push(...endCheck.log);

  return { ok: true, log, moveResult, shootResult, gameOver: endCheck.gameOver, winner: endCheck.winner };
}


// -----------------------------------------------------------------
// 13. COAST (p.8) — ÉTAPE 4 DU MOTEUR DE TOUR
// -----------------------------------------------------------------
// Précisé par Mayrik : le Coast N'EST PAS une étape de tour en plus —
// c'est une VARIANTE d'ASSIGN qui réactive une voiture déjà activée
// ce round, au lieu d'en assigner une nouvelle. Règles :
//   - Impossible si le joueur a encore une voiture OPÉRABLE non
//     activée ce round (p.8 : "You may NOT assign a die to coast if
//     you have an operable car you have not moved").
//   - La voiture à coaster doit avoir déjà été activée ce round
//     (movedThisRound === true) — sinon ce n'est pas un coast, c'est
//     une activation normale.
//   - Le dé assigné compte TOUJOURS comme 1, quelle que soit sa
//     valeur réelle affichée.
//   - Aucune commande ne peut être activée sur un tour de coast (p.8).
//   - Maximum 2 coasts par voiture par round (donc 3 activations
//     possibles au total par round pour une même voiture : 1 normale
//     + 2 coasts).
//   - Le reste du tour (Move, Shoot, End of turn) se déroule ensuite
//     normalement, comme pour playTurnAssignMove.

// Validation commune à playTurnCoast et playTurnCoastWithProgression
// (les 4 conditions d'éligibilité au Coast) — évite de dupliquer ce
// bloc entre les deux fonctions.
function validateCoastEligibility(car, allCars, options) {
  if (car.status !== CAR_STATUS.OPERABLE) {
    return { ok: false, reason: `${car.id} n'est pas opérable, ne peut pas coaster.` };
  }
  if (!car.movedThisRound) {
    return { ok: false, reason: `${car.id} n'a pas encore été activée ce round — impossible de la coaster (ce serait une activation normale).` };
  }
  if ((car.coastCount || 0) >= 2) {
    return { ok: false, reason: `${car.id} a déjà coasté 2 fois ce round (maximum atteint).` };
  }

  // p.8 : le coast n'est autorisé que si TOUTES les autres voitures
  // opérables du même propriétaire ont déjà été activées ce round.
  const ownerOtherCars = allCars.filter((c) => c.owner === car.owner && c !== car);
  const hasUnmovedOperableCar = ownerOtherCars.some(
    (c) => c.status === CAR_STATUS.OPERABLE && !c.movedThisRound
  );
  if (hasUnmovedOperableCar) {
    return { ok: false, reason: `Coast impossible : ${car.owner} a encore une voiture opérable non activée ce round.` };
  }

  // p.8 : "You may NOT assign a die to a command on a turn you are
  // coasting." — refus explicite si une commande a été glissée dans
  // les options (Drift notamment, seul flag de commande indépendant
  // de la valeur du dé — Nitro est neutralisé de fait puisque le dé
  // de coast vaut toujours 1, quel que soit ce qui serait ajouté).
  if (options.driftAvailable) {
    return { ok: false, reason: "Impossible d'activer une commande (Drift) pendant un coast." };
  }

  return { ok: true };
}

function playTurnCoast(tile, car, chosenPath, allCars, allChoppers, options = {}) {
  const log = [];

  const eligibility = validateCoastEligibility(car, allCars, options);
  if (!eligibility.ok) {
    return eligibility;
  }

  const coastNumber = (car.coastCount || 0) + 1;
  log.push(`COAST : ${car.id} réactivée (coast n°${coastNumber} ce round) — dé compté comme 1`);

  // --- MOVE --- (toujours avec une valeur de 1, quelle que soit la
  // valeur réelle du dé assigné)
  const moveResult = moveCar(tile, car, 1, chosenPath, allCars, options);
  log.push(...moveResult.log);

  // --- SHOOT ---
  const shootStep = resolveShootStep(tile, allCars, car, options);
  log.push(...shootStep.log);
  const shootResult = shootStep.shootResult;

  // --- END OF TURN ---
  car.coastCount = coastNumber;
  log.push(`END OF TURN : ${car.id} a coasté ${coastNumber} fois ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  return { ok: true, log, moveResult, shootResult };
}

// -----------------------------------------------------------------
// 13bis. COAST — VERSION AVEC PROGRESSION
// -----------------------------------------------------------------
// Même principe que playTurnAssignMoveWithProgression : toutes les
// vérifications de playTurnCoast restent identiques, seul le MOVE
// passe par moveCarWithProgression, et un checkGameEndConditions()
// final ferme le tour.
function playTurnCoastWithProgression(state, car, chosenPath, allCars, allChoppers, playerNames, options = {}) {
  const log = [];

  const eligibility = validateCoastEligibility(car, allCars, options);
  if (!eligibility.ok) {
    return eligibility;
  }

  const coastNumber = (car.coastCount || 0) + 1;
  log.push(`COAST : ${car.id} réactivée (coast n°${coastNumber} ce round) — dé compté comme 1`);

  // --- MOVE (avec progression des tuiles, toujours avec une valeur
  // de 1 quelle que soit la valeur réelle du dé assigné) ---
  const moveResult = moveCarWithProgression(state, car, 1, chosenPath, allCars, allChoppers, playerNames, options);
  log.push(...moveResult.log);

  if (!moveResult.ok) {
    return { ok: false, reason: moveResult.reason, log };
  }

  if (moveResult.gameOver) {
    car.coastCount = coastNumber;
    return { ok: true, log, moveResult, gameOver: true, winner: moveResult.winner };
  }

  // --- SHOOT ---
  const shootStep = resolveShootStep(buildBoardFromProgressionState(state), allCars, car, { ...options, progressionState: state, allChoppers });
  log.push(...shootStep.log);
  const shootResult = shootStep.shootResult;

  // --- END OF TURN ---
  car.coastCount = coastNumber;
  log.push(`END OF TURN : ${car.id} a coasté ${coastNumber} fois ce round`);

  const chopperElim = eliminateCarsOnChoppers(allCars, allChoppers || []);
  log.push(...chopperElim.log);

  const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
  log.push(...endCheck.log);

  return { ok: true, log, moveResult, shootResult, gameOver: endCheck.gameOver, winner: endCheck.winner };
}


// -----------------------------------------------------------------
// Rotation à UN tour à la fois (pas "3 tours d'affilée par joueur") :
// "The player on your left takes the next turn" (p.11). Un round se
// termine quand chaque joueur ENCORE EN JEU a pris 3 tours (p.8).
// Un joueur est "out of game" (p.11) si toutes ses voitures sont
// éliminées ou inopérables — il ne joue plus aucun tour, mais reste
// dans l'ordre de rotation (sauté silencieusement).
//
// Les voitures/choppers eux-mêmes ne sont PAS stockés dans l'état de
// round : on les retrouve via allCars/allChoppers en filtrant sur
// owner === nom du joueur (même logique déjà utilisée par
// playTurnCoast pour retrouver "les autres voitures du joueur").

function createRoundState(playerNames) {
  return {
    playerOrder: [...playerNames], // ordre de table, fixe pour toute la partie
    turnsThisRound: Object.fromEntries(playerNames.map((n) => [n, 0])),
    currentPlayerIndex: 0,
    roundStartIndex: 0, // joueur qui a démarré CE round (celui qui tire le dé Road)
    roundNumber: 1,
    roadDie: null // tiré au début de chaque round, remis à null à chaque nouveau round
  };
}

function getCurrentPlayer(state) {
  return state.playerOrder[state.currentPlayerIndex];
}

// p.11 : un joueur est hors jeu si TOUTES ses voitures sont éliminées
// ou inopérables (les inopérables restent sur le plateau mais ne
// peuvent plus jouer — il en va de même pour leur propriétaire).
function isPlayerOutOfGame(playerName, allCars) {
  const playerCars = allCars.filter((c) => c.owner === playerName);
  if (playerCars.length === 0) return false; // aucune voiture trouvée : cas défensif, on ne le considère pas hors jeu
  return playerCars.every(
    (c) => c.status === CAR_STATUS.ELIMINATED || c.status === CAR_STATUS.INOPERABLE
  );
}

// p.9 : le dé Road n'est tiré qu'une fois par round, par le 1er
// joueur. Appeler cette fonction à chaque tour ne le retire PAS s'il
// est déjà tiré ce round (idempotent).
function ensureRoadDieRolled(state, forcedValue = null) {
  if (state.roadDie !== null) {
    return { log: [], value: state.roadDie };
  }
  const value = rollRoadDie(forcedValue);
  state.roadDie = value;
  return { log: [`Dé Road tiré pour le round ${state.roundNumber} : ${value}`], value };
}

// À appeler une fois le tour du joueur courant terminé (qu'il ait
// joué normalement ou coasté). Incrémente son compteur de tours,
// avance au joueur suivant ENCORE EN JEU qui n'a pas fini ses 3 tours,
// et détecte/le passage au round suivant si plus personne ne peut
// jouer ce round.
function advanceTurn(state, allCars) {
  const log = [];
  const currentPlayer = getCurrentPlayer(state);
  state.turnsThisRound[currentPlayer] = (state.turnsThisRound[currentPlayer] || 0) + 1;
  log.push(`${currentPlayer} a joué ${state.turnsThisRound[currentPlayer]} tour(s) ce round.`);

  const n = state.playerOrder.length;
  let foundNext = false;

  // Cherche, dans l'ordre de table à partir du joueur suivant, le
  // premier joueur encore en jeu qui n'a pas fini ses 3 tours. Le
  // dernier pas (step = n) revient sur le joueur courant lui-même :
  // ça couvre naturellement le cas d'un seul joueur encore en jeu qui
  // n'a pas fini ses 3 tours, sans code séparé.
  for (let step = 1; step <= n; step++) {
    const idx = (state.currentPlayerIndex + step) % n;
    const candidate = state.playerOrder[idx];
    if (isPlayerOutOfGame(candidate, allCars)) continue;
    if ((state.turnsThisRound[candidate] || 0) >= 3) continue;
    state.currentPlayerIndex = idx;
    foundNext = true;
    break;
  }

  if (!foundNext) {
    log.push(`Fin du round ${state.roundNumber}.`);
    for (const p of state.playerOrder) state.turnsThisRound[p] = 0;
    state.roundNumber += 1;
    state.roadDie = null;

    // p.11 : "pass the road die to the player on your left" — "your"
    // fait référence au 1er joueur DE CE ROUND (roundStartIndex), pas
    // au dernier joueur à avoir pris un tour. Le prochain 1er joueur
    // est donc celui après roundStartIndex, encore en jeu.
    for (let step = 1; step <= n; step++) {
      const idx = (state.roundStartIndex + step) % n;
      if (!isPlayerOutOfGame(state.playerOrder[idx], allCars)) {
        state.currentPlayerIndex = idx;
        state.roundStartIndex = idx;
        break;
      }
    }
    log.push(`Nouveau round ${state.roundNumber}, premier joueur : ${getCurrentPlayer(state)}`);
  }

  return { log };
}

module.exports = {
  TERRAIN,
  MOVE_COST,
  CAR_SIZE,
  CAR_STATUS,
  DIRECTIONS,
  DICE_FACES,
  TOKEN_TYPES,
  DAMAGE_TOKEN_COMPOSITION,
  HAZARD_TYPES,
  HAZARD_TOKEN_COMPOSITION,
  drawHazardToken,
  resolveHazard,
  instantiateTile,
  populateTileHazards,
  createTestTile,
  createBoard,
  createTileProgressionState,
  createFinishLineTile,
  buildBoardFromProgressionState,
  checkGameEndConditions,
  advanceBoardOnFrontExit,
  moveCarWithProgression,
  getSpace,
  createCar,
  createChopper,
  placeChopperAirstrike,
  eliminateCarsOnChoppers,
  getFrontArc,
  getCarAt,
  enterAdjacentSpace,
  moveCar,
  rollSlamDie,
  rollDirectionDie,
  rollStuntDie,
  rollShootingDie,
  resolveShoot,
  forceMoveOneSpace,
  resolveSlam,
  drawDamageToken,
  resolveDamageToken,
  applyDamage,
  repairCar,
  resolveAirstrikeCommand,
  resolveNitroCommand,
  resolveDriftCommand,
  resolveRepairCommand,
  playTurnAssignMove,
  playTurnAssignMoveWithProgression,
  playTurnCoast,
  playTurnCoastWithProgression,
  rollRoadDie,
  applyRoadBonus,
  createRoundState,
  getCurrentPlayer,
  isPlayerOutOfGame,
  ensureRoadDieRolled,
  advanceTurn
};

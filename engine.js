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
  // via options.forcedNextTile). La tuile défaussée est réinstanciée
  // à neuf avant de rejoindre la pioche — état d'origine restauré
  // (pas le terrain/jetons de son passage précédent), ET face
  // retirée à nouveau au hasard entre A et B si les deux sont connues
  // (règle confirmée par Mayrik : la face se tire à CHAQUE entrée en
  // jeu, y compris un recyclage depuis la défausse, pas seulement au
  // tout premier tirage). options.forcedDiscardFace permet un tirage
  // déterministe en test. Sur une tuile de test (sans _rawData/
  // _facesEntry), comportement inchangé : objet repoussé tel quel —
  // aucune régression sur les tests existants, qui fournissent
  // toujours leur pioche explicitement.
  let discardedTile = state.rearTile;
  if (state.rearTile._facesEntry) {
    const rawPick = pickRandomFace(state.rearTile._facesEntry, options.forcedDiscardFace);
    discardedTile = instantiateTile(rawPick, state.rearTile._facesEntry);
  } else if (state.rearTile._rawData) {
    discardedTile = instantiateTile(state.rearTile._rawData);
  }
  state.drawPile.push(discardedTile);
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
  // p.9 (bonus Road) : l'éligibilité doit tenir sur TOUTE la
  // trajectoire, pas seulement le dernier segment — bug corrigé
  // (détecté en câblant le bonus Road, jamais appliqué jusqu'ici) :
  // chaque tour de boucle appelait moveCar() qui recalculait
  // roadEligible à partir de zéro depuis la position de DÉPART de ce
  // segment (après un changement de tuile), écrasant silencieusement
  // l'historique d'un segment précédent qui aurait quitté la route.
  let overallRoadEligible = true;

  const movementOptions = { ...slamOptions, progressionState: state, allChoppers };

  while (true) {
    const board = buildBoardFromProgressionState(state);
    const moveResult = moveCar(board, car, remainingDie, remainingPath, allCars, movementOptions);
    log.push(...moveResult.log);

    if (!moveResult.ok) {
      return { ok: false, reason: moveResult.reason, log };
    }

    overallRoadEligible = overallRoadEligible && !!moveResult.roadEligible;

    const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
    log.push(...endCheck.log);
    if (endCheck.gameOver) {
      return { ok: true, log, moveResult, gameOver: true, winner: endCheck.winner, reason: endCheck.reason, roadEligible: overallRoadEligible };
    }

    if (!moveResult.frontExit) {
      // Mouvement terminé (normalement, élimination, ou slam) sans
      // atteindre le bord avant : rien de plus à orchestrer.
      return { ok: true, log, moveResult, gameOver: false, winner: null, roadEligible: overallRoadEligible };
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

// Résout un nom de direction AVANT (front / front-left / front-right)
// en delta {dCol, dRow} réel depuis une case (col, row) donnée, en
// respectant la parité de la rangée de départ (voir getFrontArc).
// Réutilisé par tout code qui marche une trajectoire hypothétique
// (recherche IA) sans passer par moveCar — la table DIRECTIONS seule
// ne suffit PAS ici : elle ignore la parité et ne doit servir que
// pour rear/rear-left/rear-right (pas encore couverts par une règle
// confirmée, voir DIRECTIONS plus bas).
function getForwardDelta(dirName, fromCol, fromRow) {
  const arc = getFrontArc({ col: fromCol, row: fromRow });
  const target = arc.find((a) => a.name === dirName);
  return { dCol: target.col - fromCol, dRow: target.row - fromRow };
}

function getFrontArc(car) {
  // La tuile est en quinconce (cases en chevron) : selon la parité de
  // la rangée de DÉPART, les deux cases diagonales de l'arc avant ne
  // sont pas physiquement adjacentes au même décalage de colonne que
  // la case "front" tout droit. Confirmé par Mayrik avec des exemples
  // concrets sur le vrai rendu visuel (jamais détecté avant : aucun
  // des 174 tests ni des centaines de parties simulées n'avait de
  // vérification contre la géométrie réelle des tuiles) :
  //   - Depuis une rangée PAIRE (0, 2, 4...) : les diagonales restent
  //     sur la MÊME colonne que la case de départ.
  //   - Depuis une rangée IMPAIRE (1, 3, 5...) : les diagonales
  //     avancent aussi d'une colonne (+1), comme la case "front".
  const diagColOffset = (car.row % 2 === 0) ? 0 : 1;
  return [
    { name: "front-left", col: car.col + diagColOffset, row: car.row - 1 },
    { name: "front", col: car.col + 1, row: car.row },
    { name: "front-right", col: car.col + diagColOffset, row: car.row + 1 }
  ];
}

// Arc ARRIÈRE (rear / rear-left / rear-right) — même principe que
// getFrontArc, confirmé par Mayrik avec 2 exemples concrets (rangée
// paire et impaire). Utilisé par le slam, et par les jetons de dégâts
// qui peuvent envoyer une voiture dans n'importe laquelle des 6
// directions (Skid, Dazed, Blast Off, Shrapnel) :
//   - Depuis une rangée PAIRE : les diagonales sont sur la MÊME
//     colonne que la case "rear" tout droit (col - 1).
//   - Depuis une rangée IMPAIRE : les diagonales restent sur la
//     colonne de départ (aucun décalage).
function getRearArc(car) {
  const diagColOffset = (car.row % 2 === 0) ? -1 : 0;
  return [
    { name: "rear-left", col: car.col + diagColOffset, row: car.row - 1 },
    { name: "rear", col: car.col - 1, row: car.row },
    { name: "rear-right", col: car.col + diagColOffset, row: car.row + 1 }
  ];
}

// Résout un nom de direction ARRIÈRE en delta {dCol, dRow} réel depuis
// une case donnée (même rôle que getForwardDelta, pour rear/rear-left/
// rear-right).
function getBackwardDelta(dirName, fromCol, fromRow) {
  const arc = getRearArc({ col: fromCol, row: fromRow });
  const target = arc.find((a) => a.name === dirName);
  return { dCol: target.col - fromCol, dRow: target.row - fromRow };
}

// Dispatcher unique pour les 6 directions nommées — à utiliser à la
// place de la table statique DIRECTIONS partout où une case cible
// réelle est calculée (la table DIRECTIONS elle-même reste en place
// uniquement pour lister les noms/existence des 6 directions, plus
// comme source de vérité géométrique).
function getDirectionDelta(dirName, fromCol, fromRow) {
  if (dirName === "front" || dirName === "front-left" || dirName === "front-right") {
    return getForwardDelta(dirName, fromCol, fromRow);
  }
  return getBackwardDelta(dirName, fromCol, fromRow);
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
    return { ok: false, reason: "La voiture n'est pas opérationnelle.", log: [] };
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

// -----------------------------------------------------------------
// IA — MOVE : recherche de trajectoire (document "TRV initiative IA"
// fourni par Mayrik, arbre déjà éprouvé un an sur un automate à
// cartes du jeu physique). Traduction fidèle de sa logique, pas une
// réinterprétation — les améliorations viendront après, une fois
// cette base validée.
//
// Principe : 7 paliers de sécurité décroissante (terrain autorisé de
// plus en plus large, contrainte d'évitement des hazards cachés
// relâchée à mi-parcours de chaque palier terrain), tous excluant
// absolument le déclenchement d'un SLAM et exigeant d'utiliser LA
// TOTALITÉ des points de mouvement du dé. Dès qu'un palier offre une
// trajectoire valide, elle est retenue (le "plus loin vers l'avant"
// du document est automatiquement satisfait : les 3 directions avant
// avancent TOUJOURS d'une colonne chacune, donc toute trajectoire
// complète utilisant tous les points avance de la même distance —
// le choix entre plusieurs trajectoires valides d'un même palier est
// donc arbitraire, on garde la première trouvée). Palier 8 (repli) :
// si aucun palier sûr ne fonctionne, cherche la trajectoire qui
// avance le plus loin possible avant de devoir déclencher un SLAM.
const AI_FORWARD_DIRECTIONS = ["front", "front-left", "front-right"];

// Coût pour entrer sur une case, répliquant EXACTEMENT la règle
// utilisée par enterAdjacentSpace (y compris l'exception p.7 : la
// boue ne coûte que le dernier point restant s'il n'en reste qu'1) —
// indispensable pour que l'IA ne planifie jamais une trajectoire
// qu'elle ne pourrait pas réellement exécuter ensuite via moveCar.
// Retourne null si la case est infranchissable ou inabordable avec
// les points restants.
function computeAiStepCost(terrain, remainingBefore) {
  if (terrain === TERRAIN.IMPASSABLE) return null;
  const cost = MOVE_COST[terrain];
  if (terrain === TERRAIN.MUD && remainingBefore === 1) return 1; // p.7
  if (cost > remainingBefore) return null;
  return cost;
}

// Une case est un "hazard face cachée" du point de vue de l'IA tant
// que son jeton n'a jamais été résolu (cell.hazard !== null) — elle
// ne peut pas savoir ce qu'il contient avant de le déclencher,
// exactement comme un joueur humain face à un jeton non retourné.
function isAiHiddenHazard(cell) {
  return cell.hazard !== null;
}

// p.9 (bonus Road) : vérifie si un chemin reste ENTIÈREMENT sur des
// cases route — la voiture doit avoir COMMENCÉ sur une case route ET
// être restée sur route à chaque case franchie. Une estimation avant
// exécution réelle (utilisée par playOneAiTurn pour décider s'il vaut
// la peine de préparer un chemin de bonus) — la vérification qui
// compte VRAIMENT reste celle, faisant autorité, de moveCar/
// moveCarWithProgression (roadEligible) au moment de l'exécution
// réelle ; une estimation optimiste erronée ici n'a aucune
// conséquence, le bonus est simplement ignoré silencieusement.
function isAiPathAllRoad(board, car, path) {
  const startSpace = getSpace(board, car.col, car.row);
  if (!startSpace || startSpace.terrain !== TERRAIN.ROAD) return false;
  let col = car.col;
  let row = car.row;
  for (const dir of path) {
    const delta = getForwardDelta(dir, col, row);
    col += delta.dCol;
    row += delta.dRow;
    const space = getSpace(board, col, row);
    if (!space || space.terrain !== TERRAIN.ROAD) return false;
  }
  return true;
}

// Recherche exhaustive (au plus 3^6 = 729 combinaisons, trivial) une
// trajectoire complète — qui consomme EXACTEMENT tous les points de
// mouvement — respectant : terrain limité à allowedTerrains, jamais
// de case occupée par une autre voiture (SLAM toujours exclu ici),
// jamais de hazard face cachée si avoidHazard, et si
// forbidLateralEdgeFinish, la case FINALE ne doit pas border un bord
// latéral de tuile (row 0 ou dernière row). Retourne le tableau de
// directions trouvé, ou null si aucune trajectoire ne satisfait ces
// critères.
// Collecte TOUTES les trajectoires valides d'un palier (au lieu de
// s'arrêter à la première trouvée) — nécessaire pour départager
// plusieurs trajectoires équivalentes en distance selon l'opportunité
// de tir de leur case d'arrivée (voir pickPreferredTrajectory ci-
// dessous, précision ajoutée par Mayrik). Le nombre de combinaisons
// reste trivial (3^6 = 729 au pire), aucun souci de performance à
// tout explorer plutôt qu'à s'arrêter au 1er résultat.
function searchAiSafeTrajectory(board, car, allCars, remainingPoints, currentCol, currentRow, pathSoFar, allowedTerrains, avoidHazard, forbidLateralEdgeFinish, collector) {
  if (remainingPoints === 0) {
    if (forbidLateralEdgeFinish && (currentRow === 0 || currentRow === board.rows - 1)) return;
    collector.push({ path: pathSoFar, finalCol: currentCol, finalRow: currentRow });
    return;
  }
  for (const dir of AI_FORWARD_DIRECTIONS) {
    const delta = getForwardDelta(dir, currentCol, currentRow);
    const targetCol = currentCol + delta.dCol;
    const targetRow = currentRow + delta.dRow;
    const space = getSpace(board, targetCol, targetRow);
    if (!space) continue; // bord latéral, arrière ou avant — hors du périmètre de cette recherche "sûre"
    if (!allowedTerrains.includes(space.terrain)) continue;
    if (avoidHazard && isAiHiddenHazard(space)) continue;
    if (getCarAt(allCars, targetCol, targetRow, car)) continue; // SLAM toujours exclu dans les 7 paliers sûrs
    const cost = computeAiStepCost(space.terrain, remainingPoints);
    if (cost === null) continue;
    searchAiSafeTrajectory(board, car, allCars, remainingPoints - cost, targetCol, targetRow, [...pathSoFar, dir], allowedTerrains, avoidHazard, forbidLateralEdgeFinish, collector);
  }
}

// Parmi plusieurs trajectoires valides d'un même palier (donc toutes
// à égalité de distance parcourue — les 3 directions avant avancent
// TOUJOURS d'une colonne chacune), préfère celle dont la case
// d'arrivée permet de tirer sur au moins un véhicule adverse (précisé
// par Mayrik : oubli de son document d'origine). Repli sur la 1ère
// trajectoire trouvée si aucune ne permet de tir.
// Parmi plusieurs trajectoires valides d'un même palier (donc toutes
// à égalité de distance parcourue — les 3 directions avant avancent
// TOUJOURS d'une colonne chacune), préfère dans l'ordre :
// 1. Celle dont la case d'arrivée permet de tirer sur au moins un
//    véhicule adverse (précisé par Mayrik).
// 2. À défaut, celle qui se termine PRÉCISÉMENT sur une case occupée
//    par un véhicule adverse et déclenche donc un SLAM à l'arrivée
//    (précisé par Mayrik : "s'il n'y a pas de cible de tir, on
//    choisit en priorité le slam") — slamCandidates est calculé
//    séparément via searchAiSlamEndingTrajectory, puisque ces
//    trajectoires sont volontairement EXCLUES de la recherche "sûre"
//    normale (qui évite toujours les cases occupées).
// 3. Repli : la 1ère trajectoire sûre trouvée, sans préférence.
// p.6 : une voiture qui termine son tour dans la même case qu'UN
// chopper (même le sien) est éliminée. Traverser un chopper reste
// autorisé (p.7), donc cette règle ne filtre que la case D'ARRIVÉE,
// jamais les cases intermédiaires. Ajouté suite à un vrai cas observé
// par Mayrik : l'IA terminait parfois sciemment sur un chopper alors
// qu'une autre case sûre était disponible au même palier.
function isChopperOccupied(allChoppers, col, row) {
  return !!(allChoppers && allChoppers.some((c) => c.placed && c.col === col && c.row === row));
}

function pickPreferredTrajectory(candidates, slamCandidates, car, allCars, allChoppers) {
  const canShootAt = (candidate) => {
    const arc = getFrontArc({ col: candidate.finalCol, row: candidate.finalRow });
    return allCars.some(
      (c) => c.owner !== car.owner && c.status !== CAR_STATUS.ELIMINATED && !c.isChopper && arc.some((a) => a.col === c.col && a.row === c.row)
    );
  };
  const isSafeFromChopper = (candidate) => !isChopperOccupied(allChoppers, candidate.finalCol, candidate.finalRow);

  // 1. Sans chopper ET permet de tirer — le meilleur des deux mondes.
  const bestOfBoth = candidates.find((c) => isSafeFromChopper(c) && canShootAt(c));
  if (bestOfBoth) return bestOfBoth.path;

  // 2. Sans chopper (même sans tir) — éviter l'auto-élimination passe
  // AVANT la préférence de tir : mieux vaut rater un tir que finir
  // éliminé.
  const safeOnly = candidates.find((c) => isSafeFromChopper(c));
  if (safeOnly) return safeOnly.path;

  // 3. Repli (cas rare : toutes les cases sûres de ce palier ont un
  // chopper dessus) — comportement historique inchangé.
  for (const candidate of candidates) {
    if (canShootAt(candidate)) return candidate.path;
  }
  if (slamCandidates && slamCandidates.length > 0) return slamCandidates[0].path;
  return candidates[0].path;
}

// Recherche, au sein d'un palier donné (mêmes règles de terrain/hazard
// que searchAiSafeTrajectory), les trajectoires qui utilisent TOUS les
// points de mouvement et se terminent PRÉCISÉMENT sur une case
// occupée par un véhicule ADVERSE (jamais le sien), déclenchant ainsi
// un SLAM à l'arrivée. Restent "propres" jusque-là : aucune case
// occupée traversée AVANT la toute dernière (toucher un véhicule
// interrompt le mouvement immédiatement dans le vrai jeu — voir
// enterAdjacentSpace — donc un slam ne peut jamais être qu'à la toute
// fin d'une trajectoire, jamais en plein milieu).
function searchAiSlamEndingTrajectory(board, car, allCars, remainingPoints, currentCol, currentRow, pathSoFar, allowedTerrains, avoidHazard, forbidLateralEdgeFinish, collector) {
  for (const dir of AI_FORWARD_DIRECTIONS) {
    const delta = getForwardDelta(dir, currentCol, currentRow);
    const targetCol = currentCol + delta.dCol;
    const targetRow = currentRow + delta.dRow;
    const space = getSpace(board, targetCol, targetRow);
    if (!space) continue;
    if (!allowedTerrains.includes(space.terrain)) continue;
    if (avoidHazard && isAiHiddenHazard(space)) continue;
    const cost = computeAiStepCost(space.terrain, remainingPoints);
    if (cost === null) continue;
    const remainingAfter = remainingPoints - cost;
    const occupant = getCarAt(allCars, targetCol, targetRow, car);

    if (remainingAfter === 0) {
      if (occupant && occupant.owner !== car.owner) {
        if (!(forbidLateralEdgeFinish && (targetRow === 0 || targetRow === board.rows - 1))) {
          collector.push({ path: [...pathSoFar, dir], finalCol: targetCol, finalRow: targetRow, slamTarget: occupant });
        }
      }
      continue;
    }

    if (occupant) continue; // pas le dernier pas : une case occupée arrêterait le mouvement ici, invalide pour continuer
    searchAiSlamEndingTrajectory(board, car, allCars, remainingAfter, targetCol, targetRow, [...pathSoFar, dir], allowedTerrains, avoidHazard, forbidLateralEdgeFinish, collector);
  }
}

// Palier 8 (repli) : plus aucune trajectoire sûre n'existe — on
// avance le plus loin possible (terrain Road/Off-Road/Mud, jamais
// Impassable ni bord latéral, quitte à ignorer les hazards cachés)
// jusqu'à devoir déclencher un SLAM, à ce moment-là accepté. Ne
// consomme pas forcément tous les points du dé : un SLAM interrompt
// le mouvement, exactement comme au jeu réel (voir moveCar).
function searchAiFallbackTrajectory(board, car, allCars, remainingPoints, currentCol, currentRow, pathSoFar) {
  if (remainingPoints === 0) return pathSoFar;

  const allowedTerrains = [TERRAIN.ROAD, TERRAIN.OFF_ROAD, TERRAIN.MUD];
  let bestClearContinuation = null;
  let slamFallbackDir = null;

  for (const dir of AI_FORWARD_DIRECTIONS) {
    const delta = getForwardDelta(dir, currentCol, currentRow);
    const targetCol = currentCol + delta.dCol;
    const targetRow = currentRow + delta.dRow;
    const space = getSpace(board, targetCol, targetRow);
    if (!space || !allowedTerrains.includes(space.terrain)) continue; // jamais de bord ni d'Impassable, même en dernier recours
    const cost = computeAiStepCost(space.terrain, remainingPoints);
    if (cost === null) continue;
    const occupied = !!getCarAt(allCars, targetCol, targetRow, car);
    if (!occupied && !bestClearContinuation) {
      const deeper = searchAiFallbackTrajectory(board, car, allCars, remainingPoints - cost, targetCol, targetRow, [...pathSoFar, dir]);
      if (deeper && deeper.length > pathSoFar.length) bestClearContinuation = deeper;
    } else if (occupied && !slamFallbackDir) {
      slamFallbackDir = dir; // 1er candidat "j'accepte le SLAM ici" rencontré
    }
  }

  if (bestClearContinuation) return bestClearContinuation;
  if (slamFallbackDir) return [...pathSoFar, slamFallbackDir];
  return pathSoFar; // aucune continuation possible sans s'éliminer volontairement : on s'arrête là
}

// Point d'entrée : essaie les 7 paliers sûrs dans l'ordre du
// document, puis le repli (palier 8) si aucun ne fonctionne. Retourne
// toujours un tableau de directions (jamais null — le repli garantit
// un résultat, même vide si le véhicule est totalement bloqué).
function chooseAiMoveTrajectory(board, car, dieValue, allCars, allChoppers = []) {
  const tiers = [
    { terrains: [TERRAIN.ROAD], avoidHazard: true, forbidEdge: true },
    { terrains: [TERRAIN.ROAD], avoidHazard: true, forbidEdge: false },
    { terrains: [TERRAIN.ROAD], avoidHazard: false, forbidEdge: false },
    { terrains: [TERRAIN.ROAD, TERRAIN.OFF_ROAD], avoidHazard: true, forbidEdge: false },
    { terrains: [TERRAIN.ROAD, TERRAIN.OFF_ROAD], avoidHazard: false, forbidEdge: false },
    { terrains: [TERRAIN.ROAD, TERRAIN.OFF_ROAD, TERRAIN.MUD], avoidHazard: true, forbidEdge: false },
    { terrains: [TERRAIN.ROAD, TERRAIN.OFF_ROAD, TERRAIN.MUD], avoidHazard: false, forbidEdge: false }
  ];

  for (const tier of tiers) {
    const candidates = [];
    searchAiSafeTrajectory(board, car, allCars, dieValue, car.col, car.row, [], tier.terrains, tier.avoidHazard, tier.forbidEdge, candidates);
    if (candidates.length === 0) continue;
    const slamCandidates = [];
    searchAiSlamEndingTrajectory(board, car, allCars, dieValue, car.col, car.row, [], tier.terrains, tier.avoidHazard, tier.forbidEdge, slamCandidates);
    return pickPreferredTrajectory(candidates, slamCandidates, car, allCars, allChoppers);
  }

  return searchAiFallbackTrajectory(board, car, allCars, dieValue, car.col, car.row, []);
}

// -----------------------------------------------------------------
// IA — SHOOT : choix de cible (document "TRV initiative IA")
// -----------------------------------------------------------------
// Réutilise le même arc avant (3 cases : front-left/front/front-right,
// UNE colonne devant) que le tir normal (getFrontArc) — "les 3 cases
// devant le véhicule" du document correspond exactement à cette
// géométrie déjà en place pour resolveShoot, aucune nouvelle zone à
// définir. Ne retient que les véhicules ADVERSES (jamais ses propres
// véhicules ni les choppers, qu'on ne peut de toute façon pas cibler).
//
// Priorité : s'il y a plusieurs tailles parmi les cibles possibles,
// la plus grosse (L>M>S) l'emporte. À taille égale, priorité au
// véhicule appartenant au joueur ayant le plus de véhicules ENCORE EN
// JEU (non éliminés — un véhicule inopérable compte toujours, il est
// toujours sur le plateau) ; en cas d'égalité, priorité au véhicule
// du joueur dont un véhicule est le plus en avant de la course.
//
// Retourne le véhicule choisi, ou null si aucun adversaire dans l'arc
// (correspond à "Fin de phase de tir" du document — pas de tir tenté).
function chooseAiShootTarget(shooter, allCars) {
  const arc = getFrontArc(shooter);
  const candidates = allCars.filter(
    (c) =>
      c.owner !== shooter.owner &&
      c.status !== CAR_STATUS.ELIMINATED &&
      !c.isChopper &&
      arc.some((a) => a.col === c.col && a.row === c.row)
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const distinctSizes = new Set(candidates.map((c) => c.size));
  if (distinctSizes.size > 1) {
    return candidates.reduce((best, c) => (SIZE_RANK[c.size] > SIZE_RANK[best.size] ? c : best));
  }

  const carsStillInPlay = (owner) => allCars.filter((c) => c.owner === owner && c.status !== CAR_STATUS.ELIMINATED).length;
  const frontmostCol = (owner) => Math.max(...allCars.filter((c) => c.owner === owner && c.status !== CAR_STATUS.ELIMINATED).map((c) => c.col));

  return candidates.reduce((best, c) => {
    const bestCount = carsStillInPlay(best.owner);
    const cCount = carsStillInPlay(c.owner);
    if (cCount > bestCount) return c;
    if (cCount < bestCount) return best;
    return frontmostCol(c.owner) > frontmostCol(best.owner) ? c : best;
  });
}

// -----------------------------------------------------------------
// IA — COMMAND : choix d'une commande (document "TRV initiative IA")
// -----------------------------------------------------------------
// Confirmé par le rulebook officiel (p.8, transmis par Mayrik) : la
// Command se décide DANS LE MÊME TOUR que l'Assign normal d'une
// voiture (pas une pré-décision séparée à transmettre plus tard) —
// "ONCE PER ROUND, in addition to assigning a die to a car, you may
// also assign an unused movement die to one of the commands". Une
// seule Command par joueur par round (state.commandUsedThisRound),
// jamais pendant un Coast (actingCar.movedThisRound doit être false —
// sinon ce tour EST un Coast, pas un Assign normal).
//
// Simplifications assumées pour cette recherche automatisée (l'automa
// à cartes d'origine de Mayrik faisait de même, de façon manuelle) :
// "peut atteindre la sortie de la tuile de tête" est évalué en valeur
// de dé brute (position + dé le plus fort disponible >= bord avant du
// plateau assemblé), sans tenir compte du coût de terrain — un
// indicateur de menace suffisant, pas un calcul de trajectoire exact
// (qui existe déjà par ailleurs via chooseAiMoveTrajectory pour SA
// PROPRE voiture, mais pas pour anticiper celle d'un adversaire).

// Cherche une case de placement pour le chopper telle que targetCar
// tombe dans son arc avant une fois posé (mêmes 3 cases que
// getFrontArc, mais "à l'envers" : col-1, row-1/row/row+1). Retourne
// {col,row} de la première case valide trouvée (mêmes critères que
// placeChopperAirstrike : dans le plateau, pas Impassable, pas de
// hazard non résolu, pas de véhicule, pas d'autre chopper), ou null.
function findAiAirstrikePlacement(board, targetCar, allCars, allChoppers) {
  // Même correctif que getFrontArc (voir son commentaire) : on
  // cherche ici l'inverse — une case pour le CHOPPER telle que
  // targetCar tombe dans SON arc avant à lui. Le décalage de colonne
  // des diagonales dépend donc de la parité de la rangée du CHOPPER
  // (candidate.row), pas de celle de targetCar.
  const diagColOffsetFor = (row) => (((row % 2) + 2) % 2 === 0) ? 0 : 1; // sûr même pour row négatif
  const candidates = [
    { col: targetCar.col - diagColOffsetFor(targetCar.row - 1), row: targetCar.row - 1 }, // targetCar en front-right du chopper
    { col: targetCar.col - 1, row: targetCar.row },                                        // targetCar en front du chopper
    { col: targetCar.col - diagColOffsetFor(targetCar.row + 1), row: targetCar.row + 1 }  // targetCar en front-left du chopper
  ];
  for (const { col, row } of candidates) {
    const space = getSpace(board, col, row);
    if (!space) continue;
    if (space.terrain === TERRAIN.IMPASSABLE) continue;
    if (space.hazard) continue;
    if (getCarAt(allCars, col, row)) continue;
    if (allChoppers.some((c) => c.placed && c.col === col && c.row === row)) continue;
    return { col, row };
  }
  return null;
}

// Point d'entrée. actingCar = la voiture sur le point de recevoir son
// dé d'Assign normal ce tour (pas encore bougée ce round — sinon ce
// serait un Coast). dicePool = state.dicePool complet (tous les
// joueurs, pour évaluer la menace adverse avec LEURS dés réellement
// disponibles, information publique sur le plateau). Retourne
// { type: 'airstrike'|'nitro'|'drift', dieValue, ... } ou null si
// aucune commande ne doit être programmée ce tour.
// Utilitaires génériques de recherche de véhicule dans une liste (le
// plus en avant / le plus en arrière) — repérés en double lors d'une
// revue de code demandée par Mayrik : chooseAiCommand réécrivait
// cette même logique 2 fois différemment (une via reduce, une via
// boucle for manuelle), chooseAiAssign la redéfinissait une 3e fois
// en closures locales. Centralisés ici, utilisés par Command, Assign
// et Shoot.
function findFrontmostCar(cars) {
  return cars.reduce((best, c) => (c.col > best.col ? c : best));
}
function findRearmostCar(cars) {
  return cars.reduce((best, c) => (c.col < best.col ? c : best));
}

function chooseAiCommand(board, actingCar, allCars, allChoppers, dicePool, playerName, roundState) {
  if (roundState.commandUsedThisRound[playerName]) return null;
  if (actingCar.movedThisRound) return null; // ce tour est un Coast, jamais de Command possible

  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) return null;

  // 1. Un adversaire peut-il atteindre la sortie de la tuile de tête
  // avec son dé de plus forte valeur disponible ?
  const enemyOwners = [...new Set(allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED).map((c) => c.owner))];
  for (const enemyOwner of enemyOwners) {
    const enemyPool = dicePool[enemyOwner] || [];
    if (enemyPool.length === 0) continue;
    const enemyHighestDie = Math.max(...enemyPool);
    const enemyCars = allCars.filter((c) => c.owner === enemyOwner && c.status !== CAR_STATUS.ELIMINATED);
    if (enemyCars.length === 0) continue;
    const frontmostEnemy = findFrontmostCar(enemyCars);
    if (frontmostEnemy.col + enemyHighestDie >= board.cols) {
      const lowestDie = Math.min(...myPool);
      const placement = findAiAirstrikePlacement(board, frontmostEnemy, allCars, allChoppers);
      return { type: "airstrike", dieValue: lowestDie, target: frontmostEnemy, placement };
    }
  }

  // 2. Le véhicule activé ce tour sera-t-il forcé de traverser une
  // case déjà occupée ou Impassable (les 3 cases de son arc avant) ?
  const arc = getFrontArc(actingCar);
  const allBlocked = arc.every((a) => {
    const space = getSpace(board, a.col, a.row);
    if (!space) return true; // hors tuile : traité comme "bloqué", dangereux
    return space.terrain === TERRAIN.IMPASSABLE || !!getCarAt(allCars, a.col, a.row, actingCar);
  });
  if (allBlocked) {
    const driftDie = myPool.find((v) => v >= 3 && v <= 5);
    if (driftDie !== undefined) return { type: "drift", dieValue: driftDie };
  }

  // 3. Ce véhicule est-il le dernier de l'équipe à être activé pour
  // la 1ère fois ce round (plus aucune autre voiture opérable non
  // encore activée après lui) ?
  const otherNeverMoved = allCars.some(
    (c) => c !== actingCar && c.owner === playerName && c.status === CAR_STATUS.OPERABLE && !c.movedThisRound
  );
  if (!otherNeverMoved) {
    const nitroDie = myPool.find((v) => v >= 1 && v <= 3);
    if (nitroDie !== undefined) return { type: "nitro", dieValue: nitroDie };

    const enemyCandidates = allCars.filter((c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED);
    const bestEnemy = enemyCandidates.length > 0 ? findFrontmostCar(enemyCandidates) : null;
    if (bestEnemy) {
      const lowestDie = Math.min(...myPool);
      const placement = findAiAirstrikePlacement(board, bestEnemy, allCars, allChoppers);
      return { type: "airstrike", dieValue: lowestDie, target: bestEnemy, placement };
    }
  }

  return null;
}

// -----------------------------------------------------------------
// IA — ASSIGN : choix du véhicule + dé (document "TRV initiative IA",
// section préambule "Attribution des dés" + "1. Assign")
// -----------------------------------------------------------------
// Confirmé par le rulebook officiel (p.8) : Assign ET Command se
// décident dans le MÊME tour — chooseAiAssign() décide donc les DEUX
// à la fois (quel véhicule reçoit quel dé, et si une Command s'y
// greffe), via un seul appel à chooseAiCommand() pour le véhicule
// retenu.
//
// SIMPLIFICATION ASSUMÉE (à affiner plus tard sur demande) : le
// document prévoit, quand un véhicule ne peut PAS encore atteindre la
// Finish Line avec son plus gros dé seul, de tester si lui ADJOINDRE
// un dé de Nitro (1-3) le lui permettrait quand même. Cette
// optimisation combinatoire n'est pas encore codée ici — seule
// l'atteinte avec le dé seul est vérifiée. Le reste de la cascade
// (tuile de queue, Repair, rotation S/L/M) est traduit fidèlement.
//
// progressionState : nécessaire pour connaître les colonnes de la
// tuile de queue (rearTile.cols) et savoir si la Finish Line est
// posée (finishLineTile). board : le plateau assemblé complet
// (buildBoardFromProgressionState), pour la colonne de sortie avant.
//
// Retourne { car, dieValue, command } où command est le résultat de
// chooseAiCommand() (ou null), ou null si ce joueur n'a strictement
// rien à jouer (pool vide ou aucun véhicule opérable).
function chooseAiAssign(board, progressionState, allCars, allChoppers, dicePool, playerName, roundState) {
  const myPool = dicePool[playerName] || [];
  if (myPool.length === 0) return null;

  const myOperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.OPERABLE);
  const neverMoved = myOperableCars.filter((c) => !c.movedThisRound);
  const isCoastTurn = neverMoved.length === 0;
  const eligibleCars = isCoastTurn ? myOperableCars : neverMoved;
  if (eligibleCars.length === 0) return null;

  const highestDie = Math.max(...myPool);
  const rearTileEnd = progressionState.rearTile.cols;
  const leadExitCol = board.cols;
  const effectiveMove = isCoastTurn ? 1 : highestDie; // p.9 : un Coast avance TOUJOURS d'exactement 1 case

  const myQueueCars = eligibleCars.filter((c) => c.col < rearTileEnd);

  // 0.a — véhicule sur la tuile de queue ET adversaire à moins de 7
  // cases de la sortie de la tuile de tête : priorité absolue, on
  // sauve le véhicule en danger de défausse.
  if (myQueueCars.length > 0) {
    const enemyThreat = allCars.some(
      (c) => c.owner !== playerName && c.status !== CAR_STATUS.ELIMINATED && c.col >= leadExitCol - 7
    );
    if (enemyThreat) {
      return { car: findRearmostCar(myQueueCars), dieValue: highestDie, command: null };
    }
  }

  // 0.b — Finish Line en place, le véhicule le plus en avant peut
  // l'atteindre avec le dé de plus forte valeur (1 case si Coast).
  if (progressionState.finishLineTile) {
    const front = findFrontmostCar(eligibleCars);
    if (front.col + effectiveMove >= leadExitCol) {
      return { car: front, dieValue: highestDie, command: null };
    }
  }

  // 0.c — aucun véhicule sur la tuile de queue, un véhicule peut
  // sortir par l'avant de la tuile de tête (déclenche une nouvelle
  // tuile) avec le dé de plus forte valeur.
  if (myQueueCars.length === 0) {
    const front = findFrontmostCar(eligibleCars);
    if (front.col + effectiveMove >= leadExitCol) {
      return { car: front, dieValue: highestDie, command: null };
    }
  }

  // 1. Procédure détaillée — aucun cas prioritaire ci-dessus.
  // Repair + inopérable : jamais possible pendant un Coast (aucune
  // Command ne peut accompagner un Coast, p.8).
  if (!isCoastTurn && !roundState.commandUsedThisRound[playerName] && myPool.includes(6)) {
    const inoperableCars = allCars.filter((c) => c.owner === playerName && c.status === CAR_STATUS.INOPERABLE);
    if (inoperableCars.length > 0) {
      const remainingAfterSix = [...myPool];
      remainingAfterSix.splice(remainingAfterSix.indexOf(6), 1);
      if (remainingAfterSix.length > 0) {
        const repairTarget = findRearmostCar(inoperableCars);
        const carToMove = findRearmostCar(eligibleCars);
        const carDie = Math.max(...remainingAfterSix);
        return {
          car: carToMove,
          dieValue: carDie,
          command: { type: "repair", dieValue: 6, target: repairTarget }
        };
      }
    }
  }

  // Rotation S → L → M : la 1ère de ces 3 voitures encore éligible.
  // (Corrigé suite au retour de Mayrik : la défense de la tuile de
  // queue ne s'applique QUE si une vraie menace adverse existe — voir
  // 0.a plus haut — pas inconditionnellement à chaque tour. La
  // version inconditionnelle envisagée initialement ralentissait
  // anormalement la progression avec plusieurs véhicules par joueur.)
  for (const size of [CAR_SIZE.SMALL, CAR_SIZE.LARGE, CAR_SIZE.MEDIUM]) {
    const car = eligibleCars.find((c) => c.size === size);
    if (car) return { car, dieValue: highestDie, command: null };
  }

  // Repli (ne devrait normalement pas être atteint si les 3 tailles
  // sont bien représentées) : n'importe quel véhicule éligible.
  return { car: eligibleCars[0], dieValue: highestDie, command: null };
}

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
  const delta = getDirectionDelta(directionName, car.col, car.row);
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
// L'outil de tagging exporte directement `hazardSpace: true/false`
// pour chaque case — une propriété FIXE du design de la vraie tuile
// physique (case marquée du double triangle rouge, oui/non). Nom
// choisi précisément pour ne jamais être confondu avec `cell.hazard`,
// que le moteur utilise pour tout autre chose : le jeton ACTUELLEMENT
// posé sur la case (null tant qu'aucun jeton n'y a été placé, sinon
// une valeur de HAZARD_TYPES). instantiateTile() n'a donc plus qu'à
// recopier hazardSpace tel quel, et à initialiser hazard à null (le
// jeton dynamique, lui, doit toujours repartir vide à chaque nouvelle
// instanciation — voir populateTileHazards() juste après).
//
// facesEntry (optionnel) : { a: rawDataA, b: rawDataB } — les données
// brutes des DEUX faces de ce numéro physique, si connues. Permet à
// une tuile de retirer au hasard entre A et B le jour où elle revient
// en jeu après un passage par la défausse (voir advanceBoardOnFrontExit)
// — conforme à la règle confirmée par Mayrik : la face se tire au
// hasard à CHAQUE entrée en jeu, pas seulement la toute première.
// Absent (null) pour les tuiles instanciées sans ce contexte (ex.
// appel direct dans un test) — comportement de repli sans incidence.
function instantiateTile(rawTileData, facesEntry = null) {
  const grid = rawTileData.grid.map((row) =>
    row.map((cell) => ({
      terrain: cell.terrain,
      hazardSpace: !!cell.hazardSpace,
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
    grid,
    // Référence interne vers les données brutes d'origine — permet de
    // réinstancier une copie NEUVE de cette tuile plus tard (voir
    // advanceBoardOnFrontExit, étape "défausse"), sans quoi une tuile
    // qui revient dans la pioche après être passée par le plateau
    // garderait les cicatrices de son premier passage (terrain
    // modifié par un hazard résolu, jetons déjà consommés) au lieu de
    // revenir "neuve" comme le vrai composant physique. Absente sur
    // les tuiles de test (createTestTile), qui n'ont pas cette notion
    // — comportement de repli inchangé pour elles (voir plus bas).
    _rawData: rawTileData,
    // Référence aux 2 faces (voir doc au-dessus de la fonction) —
    // permet un nouveau tirage aléatoire de face lors d'un recyclage
    // depuis la défausse (voir advanceBoardOnFrontExit).
    _facesEntry: facesEntry
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

// -----------------------------------------------------------------
// 1quater. MISE EN PLACE D'UNE PARTIE À PARTIR DES VRAIES DONNÉES DE
// TUILE (fichiers tiles/data/*.js, exportés par l'outil de tagging)
// -----------------------------------------------------------------
// Fait le lien entre le contenu réel (10 fichiers, 5 numéros × 2
// faces) et un vrai tirage aléatoire de partie : quel numéro devient
// rear/middle/lead, quelle face (A/B) chacun prend, et quels numéros
// restants forment la pioche — pièce manquante jusqu'ici entre
// "les tuiles existent" et "une partie peut démarrer avec elles".
//
// Regroupe une liste de données brutes de tuile (les objets exportés
// par l'outil, un par fichier) par numéro physique, à partir de leur
// id ("vendetta-01a" → numéro "01", face "a"). Une tuile physique
// n'existe qu'une fois dans un jeu réel : chaque numéro DOIT avoir
// exactement 2 entrées (face a et face b) — un numéro incomplet est
// signalé dans le log et exclu (mieux vaut une tuile en moins qu'un
// tirage qui plante en pleine partie).
function groupTilesByNumber(rawTileDataList) {
  const log = [];
  const byNumber = {};
  for (const raw of rawTileDataList) {
    const match = /^([a-z]+)-(\d+)([ab])$/.exec(raw.id || "");
    if (!match) {
      log.push(`Identifiant de tuile inattendu, ignoré : "${raw.id}"`);
      continue;
    }
    const [, , number, face] = match;
    if (!byNumber[number]) byNumber[number] = {};
    byNumber[number][face] = raw;
  }
  const complete = {};
  for (const number in byNumber) {
    if (byNumber[number].a && byNumber[number].b) {
      complete[number] = byNumber[number];
    } else {
      log.push(`Tuile numéro ${number} incomplète (il manque une face), exclue du tirage.`);
    }
  }
  return { byNumber: complete, log };
}

// Choisit une face au hasard (ou la face forcée fournie, pour des
// tests déterministes — même convention que drawHazardToken).
function pickRandomFace(facesEntry, injectedFace = null) {
  const face = injectedFace || (Math.random() < 0.5 ? "a" : "b");
  return facesEntry[face];
}

// Mélange une copie du tableau (Fisher-Yates). injectedOrder permet
// de fournir un ordre exact pour des tests déterministes, en
// contournant le mélange — même convention que les dés forçables.
function shuffleTileNumbers(numbers, injectedOrder = null) {
  if (injectedOrder) return [...injectedOrder];
  const arr = [...numbers];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Construit rear/middle/lead + pioche à partir des données brutes de
// TOUTES les tuiles disponibles (un tableau plat, peu importe leur
// extension d'origine — le filtrage par extension choisie par le
// joueur, prévu par Mayrik pour plus tard, se fait via
// options.allowedExtensions). La tuile de départ (options.startingTileNumber,
// "01" par défaut, cf. règle confirmée par Mayrik) est TOUJOURS
// placée en rear, mais sa face reste tirée au hasard comme les
// autres. Les autres numéros disponibles sont mélangés : les 2
// premiers deviennent middle et lead, le reste forme state.drawPile.
//
// Ne pose PAS encore les hazards (populateTileHazards) — ce n'est pas
// le rôle de cette fonction, qui ne fait que choisir QUELLES tuiles
// entrent en jeu. C'est createTileProgressionState (appelée avec le
// résultat) qui s'en charge, exactement comme pour des tuiles
// choisies à la main.
//
// options.forcedFaces : { "01": "a", "03": "b", ... } — force la face
// d'un numéro donné plutôt que de la tirer au hasard.
// options.forcedDrawOrder : ["03","05","02","04"] — force l'ordre des
// numéros restants (middle, lead, puis pioche dans cet ordre) plutôt
// que de mélanger.
function setupTileProgressionFromRawData(rawTileDataList, options = {}) {
  const log = [];
  const startingNumber = options.startingTileNumber || "01";
  const forcedFaces = options.forcedFaces || {};

  let pool = rawTileDataList;
  if (options.allowedExtensions) {
    pool = pool.filter((t) => options.allowedExtensions.includes(t.extension));
  }

  const { byNumber, log: groupLog } = groupTilesByNumber(pool);
  log.push(...groupLog);

  if (!byNumber[startingNumber]) {
    return { ok: false, reason: `Tuile de départ numéro ${startingNumber} introuvable ou incomplète.`, log };
  }

  const rearRaw = pickRandomFace(byNumber[startingNumber], forcedFaces[startingNumber]);
  log.push(`Tuile de départ : numéro ${startingNumber}, face ${rearRaw.id.slice(-1)} (${rearRaw.name}).`);

  const remainingNumbers = Object.keys(byNumber).filter((n) => n !== startingNumber);
  if (remainingNumbers.length < 2) {
    return { ok: false, reason: `Pas assez de tuiles disponibles (${remainingNumbers.length} restantes, 2 minimum pour middle+lead).`, log };
  }

  const order = shuffleTileNumbers(remainingNumbers, options.forcedDrawOrder);
  const middleNumber = order[0];
  const leadNumber = order[1];
  const drawPileNumbers = order.slice(2);

  const middleRaw = pickRandomFace(byNumber[middleNumber], forcedFaces[middleNumber]);
  const leadRaw = pickRandomFace(byNumber[leadNumber], forcedFaces[leadNumber]);
  log.push(`Tuile middle : numéro ${middleNumber}, face ${middleRaw.id.slice(-1)} (${middleRaw.name}).`);
  log.push(`Tuile lead : numéro ${leadNumber}, face ${leadRaw.id.slice(-1)} (${leadRaw.name}).`);
  log.push(`Pioche (${drawPileNumbers.length} tuile(s) restante(s)) : ${drawPileNumbers.join(", ") || "aucune"}.`);

  const drawPile = drawPileNumbers.map((n) => instantiateTile(pickRandomFace(byNumber[n], forcedFaces[n]), byNumber[n]));

  return {
    ok: true,
    log,
    rearTile: instantiateTile(rearRaw, byNumber[startingNumber]),
    middleTile: instantiateTile(middleRaw, byNumber[middleNumber]),
    leadTile: instantiateTile(leadRaw, byNumber[leadNumber]),
    drawPile
  };
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
      // La grille est en quinconce : le décalage de colonne d'une
      // direction diagonale dépend de la parité de la rangée COURANTE
      // à chaque case franchie (pas une seule fois) — voir
      // getDirectionDelta. Une trajectoire "en ligne droite" zigzague
      // donc naturellement d'une colonne sur deux pour les 4
      // directions diagonales (front tout droit à chaque étape).
      let scanCol = car.col;
      let scanRow = car.row;
      let hit = null;

      while (true) {
        const stepDelta = getDirectionDelta(direction, scanCol, scanRow);
        scanCol += stepDelta.dCol;
        scanRow += stepDelta.dRow;
        const space = getSpace(tile, scanCol, scanRow);
        if (space === null || space === undefined) break; // bord du plateau atteint
        const occupant = getCarAt(allCars, scanCol, scanRow);
        if (occupant) {
          hit = occupant;
          break;
        }
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
        const delta = getDirectionDelta(direction, car.col, car.row);
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
      // La grille est en quinconce : le décalage de colonne d'un pas
      // diagonal dépend de la parité de la rangée COURANTE à CHAQUE
      // pas, donc on ne peut pas multiplier un delta fixe par la
      // distance — on accumule pas à pas (voir getDirectionDelta /
      // même logique que la correction du balayage Shrapnel).
      let targetCol = car.col;
      let targetRow = car.row;
      for (let step = 0; step < distance; step++) {
        const stepDelta = getDirectionDelta(direction, targetCol, targetRow);
        targetCol += stepDelta.dCol;
        targetRow += stepDelta.dRow;
      }

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
    return { ok: true, log, moveResult, gameOver: true, winner: moveResult.winner, reason: "finish-line" };
  }

  // --- BONUS ROAD (p.9) ---
  // Bug corrigé : cette fonction ne l'appliquait jamais (applyRoadBonus
  // existait, testée isolément, mais jamais câblée dans le vrai flux
  // de tour — trouvé par Mayrik en relisant le rulebook). Ce n'est pas
  // une étape séparée : juste une prolongation optionnelle du même
  // mouvement, résolue AVANT le tir. Éligible si la voiture est restée
  // sur route du DÉBUT à la FIN (moveResult.roadEligible, désormais
  // correctement accumulé y compris à travers un changement de tuile).
  // La valeur du dé Road vit sur roundState (pas state, qui est l'état
  // de progression des tuiles reçu ici — cette fonction ne connaît pas
  // le round) : l'appelant la transmet via options.roadDieValue. La
  // présence de options.roadBonusPath EST la décision de l'utiliser —
  // mêmes conventions que options.shootTarget. Réutilise
  // moveCarWithProgression (pas applyRoadBonus, plus simple mais pas
  // consciente des changements de tuile) pour hériter gratuitement de
  // la gestion de sortie de plateau et de victoire par Finish Line,
  // même sur ce bonus.
  if (car.status === CAR_STATUS.OPERABLE && moveResult.roadEligible && options.roadDieValue && options.roadBonusPath) {
    log.push(`BONUS ROAD disponible (dé ${options.roadDieValue}) — ${car.id} est restée sur route.`);
    const bonusResult = moveCarWithProgression(state, car, options.roadDieValue, options.roadBonusPath, allCars, allChoppers, playerNames, options);
    log.push(...bonusResult.log);
    if (!bonusResult.ok) {
      log.push(`Bonus Road non appliqué (chemin fourni invalide) : ${bonusResult.reason}`);
    } else if (bonusResult.gameOver) {
      car.movedThisRound = true;
      return { ok: true, log, moveResult: bonusResult, gameOver: true, winner: bonusResult.winner, reason: "finish-line" };
    }
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

  return { ok: true, log, moveResult, shootResult, gameOver: endCheck.gameOver, winner: endCheck.winner, reason: endCheck.reason };
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
    return { ok: true, log, moveResult, gameOver: true, winner: moveResult.winner, reason: "finish-line" };
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

  return { ok: true, log, moveResult, shootResult, gameOver: endCheck.gameOver, winner: endCheck.winner, reason: endCheck.reason };
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

// p.9 (précisé par Mayrik, pas explicite dans le rulebook transcrit
// jusqu'ici) : chaque joueur lance un pool de 4 dés de mouvement au
// début de CHAQUE round — jamais reporté d'un round à l'autre. Les 3
// tours du round consomment normalement 3 de ces dés (un par Assign,
// p.8) ; le 4e reste disponible pour UNE Command au choix pendant le
// round (Repair/Nitro/Drift/Airstrike, voir resolveXCommand) — perdu
// s'il n'est pas utilisé. injectedValues permet un tirage
// déterministe en test : { "Alice": [3,6,1,4], ... }.
function rollDicePool(playerNames, injectedValues = null) {
  const pool = {};
  for (const name of playerNames) {
    pool[name] =
      injectedValues && injectedValues[name]
        ? [...injectedValues[name]]
        : Array.from({ length: 4 }, () => rollMovementDie());
  }
  return pool;
}

// Retire et retourne LE dé de plus forte valeur du pool d'un joueur
// (utile pour l'IA — "le dé de plus forte valeur disponible" du
// document). Retourne null si le pool de ce joueur est vide.
function drawHighestDieFromPool(dicePool, playerName) {
  const dice = dicePool[playerName];
  if (!dice || dice.length === 0) return null;
  let bestIdx = 0;
  for (let i = 1; i < dice.length; i++) if (dice[i] > dice[bestIdx]) bestIdx = i;
  return dice.splice(bestIdx, 1)[0];
}

// Retire et retourne UNE occurrence d'une valeur précise du pool d'un
// joueur (ex. le 6 exact requis par Repair, ou un dé 1-3 pour Nitro).
// Retourne null si cette valeur n'est pas disponible dans le pool.
function drawSpecificDieFromPool(dicePool, playerName, value) {
  const dice = dicePool[playerName];
  if (!dice) return null;
  const idx = dice.indexOf(value);
  if (idx === -1) return null;
  return dice.splice(idx, 1)[0];
}

function createRoundState(playerNames, injectedDiceValues = null) {
  return {
    playerOrder: [...playerNames], // ordre de table, fixe pour toute la partie
    turnsThisRound: Object.fromEntries(playerNames.map((n) => [n, 0])),
    currentPlayerIndex: 0,
    roundStartIndex: 0, // joueur qui a démarré CE round (celui qui tire le dé Road)
    roundNumber: 1,
    roadDie: null, // tiré au début de chaque round, remis à null à chaque nouveau round
    dicePool: rollDicePool(playerNames, injectedDiceValues), // pool de 4 dés par joueur, relancé à chaque round (voir advanceTurn)
    commandUsedThisRound: Object.fromEntries(playerNames.map((n) => [n, false])) // 1 seule Command par joueur par round
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
    // Bug corrigé (détecté par simulateRandomGame, jamais couvert par
    // un test unitaire car aucun ne traversait une frontière de round
    // en le vérifiant) : movedThisRound et coastCount sont des
    // compteurs PAR ROUND (leurs noms et les commentaires du code le
    // disaient déjà) mais n'étaient jamais remis à zéro nulle part —
    // une voiture ne pouvait donc être assignée qu'UNE SEULE FOIS
    // dans toute la partie, jamais une fois par round comme prévu.
    for (const c of allCars) {
      c.movedThisRound = false;
      c.coastCount = 0;
    }
    state.roundNumber += 1;
    state.roadDie = null;
    // Nouveau pool de 4 dés par joueur pour ce nouveau round (précisé
    // par Mayrik) — jamais reporté, les dés non utilisés du round
    // précédent sont simplement perdus.
    state.dicePool = rollDicePool(state.playerOrder);
    state.commandUsedThisRound = Object.fromEntries(state.playerOrder.map((p) => [p, false]));

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

// -----------------------------------------------------------------
// 15. SIMULATION EN AUTO-JEU (test d'intégration + base de la future IA)
// -----------------------------------------------------------------
// Bot minimal, purement aléatoire : à chaque tour, choisit une
// voiture opérable pas encore activée ce round (au hasard s'il y en a
// plusieurs), lui tire un dé de mouvement, lui choisit un chemin
// avant au hasard (front / front-left / front-right, un par point de
// dé), et joue le tour via playTurnAssignMoveWithProgression. Ne
// coaste jamais, ne tire jamais, n'active aucune commande —
// volontairement minimal.
//
// Le but n'est PAS de fournir un adversaire crédible (ça viendra avec
// la vraie IA) mais un TEST D'INTÉGRATION : faire vraiment tourner le
// moteur de bout en bout (dés, mouvement, hazards, slams, progression
// des tuiles, victoire, rotation des joueurs) pour débusquer les bugs
// de COMPOSITION entre briques déjà testées isolément — pratique
// standard avant d'investir dans une IA réelle ou une interface. Ce
// même bot (roll + choix aléatoire) est aussi directement la
// structure que la vraie IA réutilisera plus tard, en remplaçant
// juste "choix au hasard" par "choix réfléchi".

function rollMovementDie(injectedValue = null) {
  return injectedValue || DICE_FACES.MOVEMENT[Math.floor(Math.random() * DICE_FACES.MOVEMENT.length)];
}

// Un chemin volontaire ne va jamais vers l'arrière (réservé aux
// projections de slam) — un par point de dé, parmi les 3 directions
// de l'arc avant.
function pickRandomForwardPath(dieValue, injectedDirections = null) {
  if (injectedDirections) return [...injectedDirections];
  const options = ["front", "front-left", "front-right"];
  const path = [];
  for (let i = 0; i < dieValue; i++) path.push(options[Math.floor(Math.random() * options.length)]);
  return path;
}

// Joue le tour du joueur courant avec le bot minimal ci-dessus, puis
// fait avancer la rotation. Si le joueur courant n'a aucune voiture
// opérable non encore activée ce round (ce bot minimal ne gère pas le
// Coast), le tour est une PASSE FORCÉE : loggée, la rotation avance
// quand même — c'est une simplification du bot, pas une règle du jeu
// (un vrai joueur/la future IA pourrait coaster à la place).
function playOneRandomTurn(state, roundState, allCars, allChoppers, playerNames, options = {}) {
  const log = [];
  ensureRoadDieRolled(roundState);

  const currentPlayer = getCurrentPlayer(roundState);
  if (!currentPlayer) return { ok: false, reason: "Plus aucun joueur en jeu.", log };

  const eligibleCars = allCars.filter(
    (c) => c.owner === currentPlayer && c.status === CAR_STATUS.OPERABLE && !c.movedThisRound
  );

  if (eligibleCars.length === 0) {
    log.push(`${currentPlayer} n'a aucune voiture éligible ce tour (bot minimal, ne coaste pas) → passe forcée.`);
    advanceTurn(roundState, allCars);
    return { ok: true, log, passed: true };
  }

  const car = eligibleCars[Math.floor(Math.random() * eligibleCars.length)];

  // p.9 (précisé par Mayrik) : le dé DOIT venir du pool de 4 dés déjà
  // lancés en début de round pour ce joueur, jamais relancé à la
  // volée — corrige le comportement précédent (rollMovementDie()
  // frais à chaque tour), qui ne correspondait pas à la vraie règle.
  const pool = roundState.dicePool[currentPlayer] || [];
  let dieValue = options.forcedDieValue;
  if (dieValue !== undefined) {
    const idx = pool.indexOf(dieValue);
    if (idx !== -1) pool.splice(idx, 1); // cohérence du pool si la valeur forcée y était présente
  } else if (pool.length > 0) {
    const dieIndex = Math.floor(Math.random() * pool.length);
    dieValue = pool.splice(dieIndex, 1)[0];
  } else {
    log.push(`${currentPlayer} n'a plus de dé disponible dans son pool ce round → passe forcée.`);
    advanceTurn(roundState, allCars);
    return { ok: true, log, passed: true };
  }

  const path = pickRandomForwardPath(dieValue, options.forcedPath);

  const turnResult = playTurnAssignMoveWithProgression(
    state, car, dieValue, path, allCars, allChoppers, playerNames,
    { roundNumber: roundState.roundNumber }
  );
  log.push(...(turnResult.log || []));

  if (turnResult.ok) advanceTurn(roundState, allCars);

  return { ...turnResult, log };
}

// -----------------------------------------------------------------
// IA — ORCHESTRATEUR DE TOUR : assemble Assign+Command+Move+Shoot en
// un seul tour joué réellement (dernière pièce de l'IA — remplace le
// bot minimal aléatoire par les vraies décisions réfléchies).
// -----------------------------------------------------------------
// Compose, dans l'ordre du tour (p.8) : chooseAiAssign() décide le
// véhicule + son dé (et pré-décide Repair le cas échéant) ;
// chooseAiCommand() est consultée en complément si Assign n'a pas
// déjà pré-décidé une Command (cas Repair) — les deux logiques sont
// indépendantes mais ne peuvent produire qu'UNE Command par tour (le
// rulebook n'en autorise qu'une par ROUND de toute façon) ;
// chooseAiMoveTrajectory() choisit le chemin (avec le bonus Nitro
// déjà ajouté au dé si applicable) ; chooseAiShootTarget() choisit la
// cible de tir. Retire réellement les dés utilisés du pool.
function playOneAiTurn(state, roundState, allCars, allChoppers, playerNames) {
  const log = [];
  ensureRoadDieRolled(roundState);

  const currentPlayer = getCurrentPlayer(roundState);
  if (!currentPlayer) return { ok: false, reason: "Plus aucun joueur en jeu.", log };

  const board = buildBoardFromProgressionState(state);
  const assignDecision = chooseAiAssign(board, state, allCars, allChoppers, roundState.dicePool, currentPlayer, roundState);

  if (!assignDecision) {
    log.push(`${currentPlayer} n'a rien à jouer ce tour (pool vide ou aucun véhicule opérable) → passe forcée.`);
    advanceTurn(roundState, allCars);
    return { ok: true, log, passed: true };
  }

  const { car } = assignDecision;
  const isCoastTurn = car.movedThisRound; // détecté ici : chooseAiAssign a choisi une voiture déjà activée ce round
  let command = assignDecision.command || chooseAiCommand(board, car, allCars, allChoppers, roundState.dicePool, currentPlayer, roundState);

  drawSpecificDieFromPool(roundState.dicePool, currentPlayer, assignDecision.dieValue);
  log.push(`ASSIGN (IA) : dé ${assignDecision.dieValue} attribué à ${car.id}${isCoastTurn ? " (Coast)" : ""}`);

  let effectiveDieValue = assignDecision.dieValue;
  const slamOptions = {};

  // p.8 : aucune Command possible pendant un Coast — déjà garanti par
  // chooseAiAssign (command toujours null dans ce cas) et
  // chooseAiCommand (refuse explicitement si movedThisRound), mais on
  // le reconfirme ici pour ne jamais exécuter par erreur une Command
  // ramassée d'un appel séparé.
  if (command && !isCoastTurn) {
    drawSpecificDieFromPool(roundState.dicePool, currentPlayer, command.dieValue);
    roundState.commandUsedThisRound[currentPlayer] = true;
    log.push(`COMMAND (IA) : ${command.type} (dé ${command.dieValue})`);

    if (command.type === "nitro") {
      const nitroResult = resolveNitroCommand(command.dieValue);
      if (nitroResult.ok) effectiveDieValue += nitroResult.bonus;
    } else if (command.type === "repair") {
      const repairResult = resolveRepairCommand(command.dieValue, command.target);
      log.push(...(repairResult.log || []));
    } else if (command.type === "drift") {
      const driftResult = resolveDriftCommand(command.dieValue);
      if (driftResult.ok) slamOptions.driftAvailable = true;
    } else if (command.type === "airstrike") {
      let chopper = allChoppers.find((ch) => ch.owner === currentPlayer);
      if (!chopper) {
        chopper = createChopper(currentPlayer);
        allChoppers.push(chopper);
      }
      if (command.placement) {
        const airstrikeResult = resolveAirstrikeCommand(
          board, allCars, allChoppers, chopper, command.placement.col, command.placement.row,
          { roundNumber: roundState.roundNumber, shootTarget: command.target }
        );
        log.push(...(airstrikeResult.log || []));
      }
    }
  }

  // p.9 : un Coast avance TOUJOURS d'exactement 1 case, quelle que
  // soit la valeur du dé assigné — la trajectoire IA doit donc être
  // recherchée pour 1 seul point de mouvement, et l'exécution passe
  // par playTurnCoastWithProgression (pas la fonction Assign normale,
  // qui refuserait une voiture déjà activée ce round).
  if (isCoastTurn) {
    const coastPath = chooseAiMoveTrajectory(board, car, 1, allCars, allChoppers);
    const coastResult = playTurnCoastWithProgression(state, car, coastPath, allCars, allChoppers, playerNames, { roundNumber: roundState.roundNumber });
    log.push(...(coastResult.log || []));
    if (coastResult.ok) advanceTurn(roundState, allCars);
    return { ...coastResult, log };
  }

  // Cas limite réel (découvert par simulation à grande échelle) : la
  // Command de ce même tour (Airstrike) peut, via un ricochet de
  // Shrapnel, blesser la voiture qu'on s'apprête justement à
  // assigner — "même si c'est une des vôtres" (voir resolveShoot).
  // Si elle devient inopérable AVANT le Move, le tour s'arrête là
  // (dé quand même dépensé, comme un vrai tour joué) plutôt que
  // d'échouer entièrement.
  if (car.status !== CAR_STATUS.OPERABLE) {
    log.push(`${car.id} est devenue inopérable pendant la Command de ce tour → pas de mouvement possible, fin du tour.`);
    advanceTurn(roundState, allCars);
    return { ok: true, log, car };
  }

  const path = chooseAiMoveTrajectory(board, car, effectiveDieValue, allCars, allChoppers);

  // Bug corrigé (détecté via l'écart entre mes simulations — presque
  // aucune élimination — et le vrai rythme du jeu décrit par Mayrik,
  // qui se termine généralement PAR élimination) : le Tir (étape 4,
  // p.8) se résout APRÈS le Mouvement, sur la position D'ARRIVÉE du
  // véhicule — pas sa position de départ. Choisir la cible sur la
  // position AVANT mouvement rendait la cible presque toujours hors
  // arc avant une fois le mouvement réellement effectué, donc le tir
  // échouait silencieusement à chaque tour. On projette la position
  // d'arrivée prévue par la trajectoire choisie (somme des pas avant,
  // fiable pour les 7 paliers sûrs ; simple approximation pour le
  // repli qui se termine sur un SLAM, dont la position réelle après
  // résolution du slam reste imprévisible par nature).
  let projectedCol = car.col;
  let projectedRow = car.row;
  for (const dir of path) {
    const delta = getForwardDelta(dir, projectedCol, projectedRow);
    projectedCol += delta.dCol;
    projectedRow += delta.dRow;
  }
  const projectedCar = { ...car, col: projectedCol, row: projectedRow };
  const shootTarget = chooseAiShootTarget(projectedCar, allCars);

  // Bug corrigé (câblage du bonus Road, jamais appliqué jusqu'ici —
  // voir moveCarWithProgression/playTurnAssignMoveWithProgression) :
  // l'IA doit ELLE-MÊME décider par avance si elle demandera le bonus,
  // puisque options.roadBonusPath doit être fourni AVANT que le
  // mouvement principal ne s'exécute réellement. On estime
  // l'éligibilité via isAiPathAllRoad (vérification faisant autorité
  // au moment de l'exécution réelle, ceci n'est qu'une estimation
  // préalable) ; si elle semble réunie, on prépare un chemin de bonus
  // avec la même recherche de trajectoire sûre, depuis la position
  // projetée d'arrivée, avec la valeur du dé Road du round. Prendre
  // le bonus est TOUJOURS avantageux pour l'IA (mouvement gratuit,
  // recherche toujours sûre en priorité) — pas de décision à peser.
  let roadBonusPath = null;
  if (roundState.roadDie && isAiPathAllRoad(board, car, path)) {
    roadBonusPath = chooseAiMoveTrajectory(board, projectedCar, roundState.roadDie, allCars, allChoppers);
  }

  const turnResult = playTurnAssignMoveWithProgression(
    state, car, effectiveDieValue, path, allCars, allChoppers, playerNames,
    { roundNumber: roundState.roundNumber, shootTarget, roadDieValue: roundState.roadDie, roadBonusPath, ...slamOptions }
  );
  log.push(...(turnResult.log || []));

  if (turnResult.ok) advanceTurn(roundState, allCars);

  return { ...turnResult, log };
}

// Simule une partie complète en auto-jeu avec la VRAIE IA (tous les
// joueurs) — même garde-fou maxTurns que simulateRandomGame, mêmes
// raisons de retour.
function simulateAiGame(state, roundState, allCars, allChoppers, playerNames, options = {}) {
  const maxTurns = options.maxTurns || 500;
  const fullLog = [];
  let turns = 0;
  let gameOver = false;
  let winner = null;
  let reason = null;

  while (turns < maxTurns) {
    const turnResult = playOneAiTurn(state, roundState, allCars, allChoppers, playerNames);
    fullLog.push(...(turnResult.log || []));
    turns++;

    if (!turnResult.ok) {
      return { completed: false, safetyCapHit: false, turns, log: fullLog, error: turnResult.reason };
    }
    if (turnResult.gameOver) {
      gameOver = true;
      winner = turnResult.winner;
      reason = turnResult.reason;
      break;
    }

    const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
    if (endCheck.gameOver) {
      gameOver = true;
      winner = endCheck.winner;
      reason = endCheck.reason;
      break;
    }
  }

  return {
    completed: gameOver,
    safetyCapHit: !gameOver && turns >= maxTurns,
    turns,
    winner,
    reason,
    log: fullLog
  };
}

// Simule une partie complète en auto-jeu (bot minimal des deux/tous
// côtés) jusqu'à victoire, ou jusqu'à options.maxTurns atteint (500
// par défaut) — un garde-fou : la partie doit normalement toujours
// converger vers une victoire (les voitures avancent, la Finish Line
// finit par apparaître), donc ce plafond sert surtout à DÉTECTER si
// jamais ce n'était pas le cas (boucle infinie, blocage) plutôt qu'à
// être atteint en usage normal.
function simulateRandomGame(state, roundState, allCars, allChoppers, playerNames, options = {}) {
  const maxTurns = options.maxTurns || 500;
  const fullLog = [];
  let turns = 0;
  let gameOver = false;
  let winner = null;
  let reason = null;

  while (turns < maxTurns) {
    const turnResult = playOneRandomTurn(state, roundState, allCars, allChoppers, playerNames, options);
    fullLog.push(...(turnResult.log || []));
    turns++;

    if (!turnResult.ok) {
      return { completed: false, safetyCapHit: false, turns, log: fullLog, error: turnResult.reason };
    }
    if (turnResult.gameOver) {
      gameOver = true;
      winner = turnResult.winner;
      reason = turnResult.reason;
      break;
    }

    // Vérification indépendante à chaque tour (couvre le cas d'un
    // joueur qui devient hors jeu ou une Finish Line qui devient
    // atteignable sans que ÇA SOIT le tour qui vient de se jouer qui
    // le détecte directement, ex. après une passe forcée).
    const endCheck = checkGameEndConditions(state, allCars, allChoppers, playerNames);
    if (endCheck.gameOver) {
      gameOver = true;
      winner = endCheck.winner;
      reason = endCheck.reason;
      break;
    }
  }

  return {
    completed: gameOver,
    safetyCapHit: !gameOver && turns >= maxTurns,
    turns,
    winner,
    reason,
    log: fullLog
  };
}

if (typeof module !== "undefined" && module.exports) {
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
  groupTilesByNumber,
  setupTileProgressionFromRawData,
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
  rollDicePool,
  drawHighestDieFromPool,
  drawSpecificDieFromPool,
  getCurrentPlayer,
  isPlayerOutOfGame,
  ensureRoadDieRolled,
  advanceTurn,
  rollMovementDie,
  pickRandomForwardPath,
  playOneRandomTurn,
  simulateRandomGame,
  chooseAiMoveTrajectory,
  pickPreferredTrajectory,
  searchAiSlamEndingTrajectory,
  computeAiStepCost,
  isAiHiddenHazard,
  isAiPathAllRoad,
  chooseAiShootTarget,
  findAiAirstrikePlacement,
  findFrontmostCar,
  findRearmostCar,
  chooseAiCommand,
  chooseAiAssign,
  playOneAiTurn,
  simulateAiGame
};
}

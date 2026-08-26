"use strict";

// ===================================================================
// Prototype jouable — Phase 2, point 2 (rendu interactif minimal).
// Aucune logique de jeu n'est réimplémentée ici : tout passe par les
// fonctions du bundle moteur (engine.js + ai-decision.js +
// human-decision.js + turn-executor.js, injectées juste au-dessus).
// Ce script ne fait QUE : afficher l'état, recueillir les choix du
// joueur humain via des clics, et appeler executeDecision() — la
// même fonction qui exécute déjà les tours de l'IA.
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
let sel = {}; // sélection en cours de construction pour le tour humain
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

function checkEnd() {
  const end = checkGameEndConditions(G.progressionState, G.allCars, G.allChoppers, PLAYER_NAMES);
  if (end && end.gameOver) {
    gameOver = true;
    gameOverInfo = end;
    pushLogLines(end.log || []);
  }
}

// ===================================================================
// TOUR DE L'IA — automatique, un clic pour déclencher
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
// TOUR HUMAIN — construit une décision pas à pas via des clics
// ===================================================================
function resetSelection() {
  sel = { step: "car" };
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

function pickCar(car) {
  sel.car = car;
  sel.step = sel.mode === "coast" ? "die" : "die";
}

function pickDie(dieValue) {
  sel.dieValue = dieValue;
  sel.step = (sel.mode === "assign" && sel.commandAvailable) ? "command" : "destination";
  if (sel.mode === "coast") sel.step = "destination";
}

function pickCommandChoice(type) {
  if (type === "none") {
    sel.command = null;
    sel.step = "destination";
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
    sel.step = "destination";
  }
}

function pickRepairTarget(target) {
  sel.command = { type: "repair", dieValue: 6, target };
  sel.step = "destination";
}

function pickAirstrikeTarget(target) {
  sel.airstrikeTarget = target; // peut être null ("aucune cible visée")
  sel.step = "destination";
}

function pickDestination(dest) {
  sel.destination = dest;
  // CORRECTIF (trouvé en testant réellement le chemin Airstrike avec
  // jsdom) : à ce stade, sel.command n'est PAS ENCORE construit pour
  // Airstrike (il ne l'est qu'après le placement, dans
  // pickAirstrikePlacement ci-dessous) — il faut donc tester
  // sel.commandType (déjà connu depuis pickCommandChoice), pas
  // sel.command.type qui vaudrait toujours undefined ici.
  if (sel.commandType === "airstrike") {
    sel.step = "airstrike-placement";
  } else {
    sel.step = "confirm";
  }
}

function pickAirstrikePlacement(col, row) {
  sel.command = { type: "airstrike", dieValue: sel.commandDieValue, target: sel.airstrikeTarget || null, placement: { col, row } };
  sel.step = "confirm";
}

function confirmTurn() {
  const decision = buildHumanDecision({
    car: sel.car,
    dieValue: sel.dieValue,
    command: sel.command || null,
    destination: sel.destination,
    isCoast: sel.mode === "coast"
  });
  const legality = checkDecisionLegality(decision, G.roundState.dicePool[HUMAN], HUMAN);
  if (!legality.allOk) {
    // Filet de sécurité : ne devrait jamais arriver puisque
    // l'interface n'offre que des choix légaux — si ça arrivait
    // quand même, on log clairement plutôt que d'exécuter en douce.
    pushLogLines([`Choix invalide, tour annulé (${JSON.stringify(legality)}).`]);
    resetSelection();
    render();
    return;
  }
  const result = executeDecision(G.progressionState, G.roundState, G.allCars, G.allChoppers, PLAYER_NAMES, HUMAN, decision);
  pushLogLines(result.log || [], `Round ${G.roundState.roundNumber} — ${HUMAN}`);
  checkEnd();
  resetSelection();
  render();
}

function cancelSelection() {
  resetSelection();
  render();
}

// ===================================================================
// RENDU
// ===================================================================
function highlightedCells() {
  // Renvoie les cases à surligner sur le plateau pour l'étape en
  // cours (destinations atteignables, ou placements Airstrike valides).
  if (!sel.step) return [];
  if (sel.step === "destination" && sel.car && sel.dieValue != null) {
    const driftAvailable = !!(sel.command && sel.command.type === "drift");
    const dist = sel.mode === "coast" ? 1 : sel.dieValue;
    const options = getReachableOptions(board(), sel.car, dist, G.allCars, G.allChoppers, driftAvailable);
    return options.map((o) => ({ col: o.col, row: o.row, onClick: () => { pickDestination(o); render(); } }));
  }
  if (sel.step === "airstrike-placement") {
    const chopper = G.allChoppers.find((c) => c.owner === HUMAN);
    const placements = listValidAirstrikePlacements(board(), G.allCars, G.allChoppers, chopper);
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

function renderPanel() {
  const panel = document.getElementById("panel");
  panel.innerHTML = "";

  if (gameOver) {
    return;
  }

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
  if (passHumanTurnIfImpossible(ctx)) { render(); return; }

  sel.mode = ctx.mode;
  sel.commandAvailable = ctx.commandAvailable;

  const h2 = document.createElement("h2");
  h2.textContent = ctx.mode === "coast" ? "Votre tour — Coast (aucune voiture disponible à activer)" : "Votre tour";
  panel.appendChild(h2);

  const choices = document.createElement("div");
  choices.className = "choices";

  if (!sel.step) sel.step = "car";

  if (sel.step === "car") {
    const p = document.createElement("div");
    p.textContent = ctx.mode === "coast" ? "Choisissez la voiture à faire avancer d'une case (Coast) :" : "Choisissez la voiture à activer :";
    panel.appendChild(p);
    const list = ctx.mode === "coast" ? ctx.coastableCars : ctx.activatableCars;
    list.forEach((car) => {
      choices.appendChild(choiceButton(`${car.size} (${car.col === null ? "hors plateau" : "col " + car.col + ",row " + car.row})`, () => { pickCar(car); render(); }));
    });
  } else if (sel.step === "die") {
    const p = document.createElement("div");
    p.textContent = `Voiture choisie : ${sel.car.size}. Choisissez un dé pour le mouvement :`;
    panel.appendChild(p);
    ctx.pool.forEach((d, i) => {
      choices.appendChild(choiceButton(String(d), () => { pickDie(d); render(); }));
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
  } else if (sel.step === "destination") {
    const p = document.createElement("div");
    p.textContent = "Cliquez une case surlignée sur le plateau pour choisir la destination.";
    panel.appendChild(p);
  } else if (sel.step === "airstrike-placement") {
    const p = document.createElement("div");
    p.textContent = "Cliquez une case surlignée pour placer le chopper (Airstrike).";
    panel.appendChild(p);
  } else if (sel.step === "confirm") {
    const p = document.createElement("div");
    p.textContent = `Prêt : ${sel.car.size}, dé ${sel.dieValue}${sel.command ? ", Command " + sel.command.type + " (dé " + sel.command.dieValue + ")" : ""}, destination (${sel.destination.col},${sel.destination.row}).`;
    panel.appendChild(p);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Valider ce tour";
    btn.addEventListener("click", confirmTurn);
    panel.appendChild(btn);
  }

  panel.appendChild(choices);

  if (sel.step !== "car") {
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

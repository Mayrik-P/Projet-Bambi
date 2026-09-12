/**
 * Test jsdom dédié — support de plusieurs IA (retour de Mayrik : le jeu
 * doit pouvoir se jouer jusqu'à 3 IA opposées au joueur humain, chacune
 * strictement indépendante). Identité par couleur (HUMAN="blue",
 * OPPONENT="orange" gardé comme alias de la 1ère IA pour compatibilité
 * avec le reste de la suite). Sur le vrai bundle navigateur
 * (tools/prototype.html), jamais une simple relecture du JS.
 * À lancer avec : node test-ui-multiplayer.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }

function clearHazardsAround(win, board, col, row) {
  win.getSpace(board, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(board, c, r);
    if (cell) cell.hazard = null;
  }
}

section("Test 1 — configurePlayers(N) : PLAYER_NAMES et PLAYER_CAR_COLOR corrects pour 1 à 3 IA");

let dom = makeDom();
let win = dom.window;
const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
console.log("HUMAN vaut bien 'blue' (attendu true) :", HUMAN === "blue");
console.log("OPPONENT reste 'orange' (1ère IA, compat avec l'existant) (attendu true) :", OPPONENT === "orange");

win.configurePlayers(1);
console.log("1 IA -> PLAYER_NAMES = [blue, orange] (attendu true) :", JSON.stringify(win.eval("PLAYER_NAMES")) === '["blue","orange"]');

win.configurePlayers(2);
console.log("2 IA -> PLAYER_NAMES = [blue, orange, green] (attendu true) :", JSON.stringify(win.eval("PLAYER_NAMES")) === '["blue","orange","green"]');

win.configurePlayers(3);
console.log("3 IA -> PLAYER_NAMES = [blue, orange, green, purple] (attendu true) :", JSON.stringify(win.eval("PLAYER_NAMES")) === '["blue","orange","green","purple"]');
console.log("PLAYER_CAR_COLOR est bien une identité (chaque joueur EST sa couleur) (attendu true) :",
  win.eval('PLAYER_CAR_COLOR.green === "green" && PLAYER_CAR_COLOR.purple === "purple"'));

win.configurePlayers(99); // borne haute -> jamais plus que AI_COLORS.length
console.log("Borné au nombre de couleurs IA disponibles (3 max pour l'instant) (attendu true) :", win.eval("PLAYER_NAMES").length === 4);
win.configurePlayers(0); // borne basse -> jamais moins de 1 IA
console.log("Borné à au moins 1 IA (attendu true) :", win.eval("PLAYER_NAMES").length === 2);

section("Test 2 — playerLabel() : format 'Humain Bleu' / 'IA Verte' pour les quelques endroits affichés en texte");

console.log("Label humain (attendu 'Humain Bleu') :", win.eval("playerLabel(HUMAN)"));
console.log("Label IA orange (attendu 'IA Orange') :", win.eval('playerLabel("orange")'));
console.log("Label IA verte, accord féminin (attendu 'IA Verte') :", win.eval('playerLabel("green")'));
console.log("Label IA violette, accord féminin (attendu 'IA Violette') :", win.eval('playerLabel("purple")'));

section("Test 3 — newGame() avec 3 IA : chaque joueur (humain + 3 IA) reçoit son propre chopper + 3 véhicules");

dom = makeDom();
win = dom.window;
win.configurePlayers(3);
win.newGame();
let G = win.eval("G");
console.log("4 choppers créés, un par joueur (attendu true) :", G.allChoppers.length === 4);
console.log("Chaque chopper appartient à un joueur distinct (attendu true) :",
  JSON.stringify(G.allChoppers.map((c) => c.owner).sort()) === JSON.stringify(["blue", "green", "orange", "purple"]));
console.log("12 véhicules créés (4 joueurs x 3 tailles) (attendu true) :", G.allCars.length === 12);
console.log("3 véhicules par joueur, aucun manquant (attendu true) :",
  win.eval("PLAYER_NAMES").every((p) => G.allCars.filter((c) => c.owner === p).length === 3));

section("Test 4 — Rendu des dashboards : 4 command boards distincts, bonne couleur, bon nombre de lignes empilées");

win.render();
const dashSvg4 = dom.window.document.getElementById("dashboards");
const cmdImgs4 = [...dashSvg4.querySelectorAll("image")].filter((img) => (img.getAttribute("href") || "").includes("command-"));
console.log("4 command boards dessinés (attendu true) :", cmdImgs4.length === 4);
const colorsSeen4 = cmdImgs4.map((img) => img.getAttribute("href").match(/command-(\w+)\.webp/)[1]).sort();
console.log("Les 4 couleurs sont bien présentes, une fois chacune (attendu true) :", JSON.stringify(colorsSeen4) === JSON.stringify(["blue", "green", "orange", "purple"]));

section("Test 5 — Rotation complète du tour : les 4 joueurs jouent chacun leur tour dans le même round");

dom = makeDom();
win = dom.window;
win.configurePlayers(3);
win.newGame();
G = win.eval("G");
const b5 = win.board();
const CAR_SIZE5 = win.eval("CAR_SIZE");
const PLAYER_NAMES5 = win.eval("PLAYER_NAMES");
G.allCars.length = 0;
PLAYER_NAMES5.forEach((p, i) => {
  clearHazardsAround(win, b5, 3 + i, 3);
  clearHazardsAround(win, b5, 3 + i, 4);
  clearHazardsAround(win, b5, 3 + i, 5);
  G.allCars.push(win.createCar(p, CAR_SIZE5.SMALL, 3 + i, 3));
  G.allCars.push(win.createCar(p, CAR_SIZE5.MEDIUM, 3 + i, 4));
  G.allCars.push(win.createCar(p, CAR_SIZE5.LARGE, 3 + i, 5));
});
const seen5 = new Set();
for (let i = 0; i < 30 && seen5.size < PLAYER_NAMES5.length; i++) {
  const cp = win.getCurrentPlayer(G.roundState);
  if (!cp) break;
  seen5.add(cp);
  if (cp === HUMAN) {
    win.advanceTurn(G.roundState, G.allCars);
  } else {
    win.playAiTurn();
  }
}
console.log("Les 4 joueurs ont chacun joué au moins un tour, sans blocage (attendu true) :",
  PLAYER_NAMES5.every((p) => seen5.has(p)));
console.log("Toujours dans le round 1 (aucun blocage infini, pas de saut de round anormal) (attendu true) :", G.roundState.roundNumber === 1);

section("Test 6 — Indépendance stricte : une IA cible bien une AUTRE IA (pas seulement l'humain) comme ennemie");

dom = makeDom();
win = dom.window;
win.configurePlayers(2); // orange + green
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b6 = win.board();
clearHazardsAround(win, b6, 4, 3);
const CAR_SIZE6 = win.eval("CAR_SIZE");
const orangeCar = win.createCar("orange", CAR_SIZE6.MEDIUM, 3, 3);
const greenCar = win.createCar("green", CAR_SIZE6.SMALL, 4, 3); // pile devant orange, aucun humain à portée
G.allCars.push(orangeCar, greenCar);
const targets6 = win.getShootTargetOptions(orangeCar, G.allCars);
console.log("L'IA orange voit bien l'IA verte comme cible légitime (attendu true) :", targets6.includes(greenCar));

section("Test 7 — Rétrocompatibilité : configurePlayers(1) restaure exactement le comportement 1v1 d'origine");

dom = makeDom();
win = dom.window;
win.configurePlayers(1);
win.newGame();
G = win.eval("G");
console.log("Exactement 2 joueurs (attendu true) :", win.eval("PLAYER_NAMES").length === 2);
console.log("2 choppers, 6 véhicules (attendu true) :", G.allChoppers.length === 2 && G.allCars.length === 6);

section("Test 8 — Écran d'accueil : visible par défaut, G pas encore démarré (null)");

dom = makeDom();
win = dom.window;
const startScreen8 = dom.window.document.getElementById("start-screen");
console.log("L'écran d'accueil existe et est visible par défaut (attendu true) :", !!startScreen8 && dom.window.getComputedStyle(startScreen8).display !== "none");
console.log("G vaut bien null tant qu'aucun choix n'a été fait (attendu true) :", win.eval("G") === null);
const buttons8 = [...dom.window.document.querySelectorAll(".opponent-btn")];
console.log("3 boutons (1/2/3 IA) présents (attendu true) :", buttons8.length === 3 && buttons8.map((b) => b.dataset.aiCount).join(",") === "1,2,3");

section("Test 9 — Clic sur '2 adversaires' : configure les joueurs, démarre la partie, masque l'écran d'accueil");

dom = makeDom();
win = dom.window;
const startScreen9 = dom.window.document.getElementById("start-screen");
const buttons9 = [...dom.window.document.querySelectorAll(".opponent-btn")];
buttons9[1].dispatchEvent(new win.Event("click", { bubbles: true })); // "2 adversaires"
console.log("L'écran d'accueil est bien masqué après le choix (attendu true) :", dom.window.getComputedStyle(startScreen9).display === "none");
console.log("PLAYER_NAMES correspond bien à 2 IA (attendu true) :", JSON.stringify(win.eval("PLAYER_NAMES")) === '["blue","orange","green"]');
const G9 = win.eval("G");
console.log("La partie a bien démarré avec 3 joueurs (9 véhicules) (attendu true) :", G9 !== null && G9.allCars.length === 9);

section("Test 10 — restoreGameState() reconstruit bien PLAYER_NAMES/AI_COUNT depuis la sauvegarde (pas le réglage courant)");

dom = makeDom();
win = dom.window;
// Prépare une sauvegarde à 3 IA (4 joueurs).
win.configurePlayers(3);
win.newGame();
const G10save = win.eval("G");
const payload10 = {
  progressionState: G10save.progressionState,
  allCars: G10save.allCars,
  allChoppers: G10save.allChoppers,
  roundState: G10save.roundState
};

// Repart sur le réglage par défaut (1 IA) AVANT de restaurer, pour
// bien vérifier que restoreGameState() écrase ce réglage courant avec
// celui de la sauvegarde plutôt que de le garder.
win.configurePlayers(1);
console.log("Réglage courant repassé à 1 IA avant restauration (attendu true) :", win.eval("PLAYER_NAMES").length === 2);

win.eval("(function(p){ restoreGameState(p); })")(payload10);
console.log("PLAYER_NAMES bien reconstruit à 4 joueurs depuis la SAUVEGARDE, pas le réglage courant (attendu true) :", JSON.stringify(win.eval("PLAYER_NAMES")) === '["blue","orange","green","purple"]');
const G10 = win.eval("G");
console.log("La partie restaurée contient bien les 12 véhicules d'origine (attendu true) :", G10.allCars.length === 12);
win.render();
const dashHtml10 = dom.window.document.getElementById("dashboards").innerHTML;
const cmdImgs10 = [...dom.window.document.querySelectorAll("#dashboards image")].filter((img) => (img.getAttribute("href") || "").includes("command-"));
console.log("Le rendu affiche bien les 4 command boards après restauration (attendu true) :", cmdImgs10.length === 4);

console.log("\n=== Fin des tests dédiés (support multi-IA) ===");

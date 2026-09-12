/**
 * Test jsdom dédié — première tranche visuelle des Dashboards
 * (S1 : sélection du dé sur le diceboard ; S2/S3 : pose sur un slot
 * ANY ou COAST d'un véhicule, annulation comprise). Sur le vrai
 * bundle navigateur (tools/prototype.html), vrais clics DOM — jamais
 * une simple relecture du JS. Voir docs/spec-dashboards.md.
 * À lancer avec : node test-ui-dashboards-slice1.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }
function dashboardClickables(dom) { return [...dom.window.document.querySelectorAll("#dashboards .clickable")]; }
function click(dom, el) { el.dispatchEvent(new dom.window.Event("click", { bubbles: true })); }

section("Test 1 — Mode ASSIGN : clic sur un dé du diceboard puis sur le slot ANY d'un véhicule");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const OPPONENT = win.eval("OPPONENT");
const CAR_SIZE = win.eval("CAR_SIZE");
let G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const small = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const medium = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const large = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(small, medium, large);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

let clickables = dashboardClickables(dom);
console.log("Exactement 4 dés cliquables sur le diceboard au départ (attendu true) :", clickables.length === 4);

// Premier dé cliquable du diceboard -> pickDie(pool[0]).
click(dom, clickables[0]);
let sel = win.eval("sel");
console.log("Étape passée à 'car' (attendu true) :", sel.step === "car");
console.log("dieValue bien retenu (attendu 4) :", sel.dieValue);

win.render();
clickables = dashboardClickables(dom);
console.log("Exactement 3 slots ANY cliquables (un par véhicule opérable non activé) (attendu true) :", clickables.length === 3);

// Clique le slot ANY du véhicule medium (2e élément — small/medium/large dans cet ordre).
click(dom, clickables[1]);
sel = win.eval("sel");
console.log("sel.car pointe bien vers le véhicule medium (attendu true) :", sel.car === medium);
console.log("Command disponible -> étape 'command-die' (attendu true) :", sel.step === "command-die");

win.render();
clickables = dashboardClickables(dom);
console.log("4 éléments cliquables : 3 dés restants (Command) + le dé posé (annulation) (attendu true) :", clickables.length === 4);

// Le dé posé (cancelable) est inséré APRÈS les dés du diceboard dans
// l'ordre du DOM (diceboard dessiné avant la boucle des véhicules) —
// donc le dernier élément cliquable de la liste.
const posedDie = clickables[clickables.length - 1];
click(dom, posedDie);
sel = win.eval("sel");
console.log("Annulation : retour à l'étape 'die', sel.car vidé (attendu true) :", sel.step === "die" && !sel.car);

section("Test 2 — Mode COAST : plus aucun slot ANY, seul le slot COAST est proposé");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s2 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l2 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
[s2, m2, l2].forEach((c) => { c.movedThisRound = true; c.coastCount = 0; });
G.allCars.push(s2, m2, l2);
G.roundState.dicePool[HUMAN] = [4];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

clickables = dashboardClickables(dom);
console.log("1 seul dé sur le diceboard, cliquable (attendu true) :", clickables.length === 1);
click(dom, clickables[0]);
sel = win.eval("sel");
console.log("Étape passée à 'car' (attendu true) :", sel.step === "car");

win.render();
clickables = dashboardClickables(dom);
console.log("Exactement 3 slots COAST cliquables — jamais de slot ANY en mode coast (attendu true) :", clickables.length === 3);

click(dom, clickables[0]);
sel = win.eval("sel");
console.log("sel.car pointe vers le véhicule small (attendu true) :", sel.car === s2);
console.log("Coast -> jamais de Command -> commit AUTOMATIQUE, mouvement déjà démarré (attendu true) :", sel.step === "move-step" || sel.step === "entry-row");

win.render();
const dashboardsHtml = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le dé posé sur le slot COAST est bien tourné à 45° (attendu true) :", dashboardsHtml.includes("rotate(45"));

section("Test 3 — Non-régression : pendant le tour de l'IA, aucun élément du diceboard humain n'est cliquable");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
win.render();
clickables = dashboardClickables(dom);
console.log("Aucun élément cliquable côté dashboards pendant le tour de l'IA (attendu true) :", clickables.length === 0);

section("Test 4 — Marqueurs de dégât : marker-damaged / marker-inoperable remplacent bien le rond noir/chiffre");

dom = makeDom();
win = dom.window;
win.newGame();
const CAR_STATUS = win.eval("CAR_STATUS");
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const dmg1 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
dmg1.damageTokens = ["dent"];
const dmg2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
dmg2.damageTokens = ["dent", "shrapnel"];
dmg2.status = CAR_STATUS.INOPERABLE;
G.allCars.push(dmg1, dmg2);
win.render();
const boardHtml = dom.window.document.getElementById("board").innerHTML;
console.log("marker-damaged présent pour le véhicule à 1 dégât (attendu true) :", boardHtml.includes("marker-damaged.webp"));
console.log("marker-inoperable présent pour le véhicule inopérable (attendu true) :", boardHtml.includes("marker-inoperable.webp"));
console.log("Plus aucun rond noir/chiffre de l'ancien système (attendu true) :", !boardHtml.includes('fill="#111"'));

section("Test 5 — Diceboard : positions stables (pas de glissement) quand un pool imposé directement en cours de round rétrécit");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s5 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m5 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
G.allCars.push(s5, m5);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1]; // pool imposé directement, comme les autres test-ui-*.js
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

let slots = win.eval('diceboardSlots("Vous")');
console.log("Les 4 valeurs imposées apparaissent bien dans les 4 emplacements (attendu true) :",
  JSON.stringify([...slots].sort()) === JSON.stringify([1, 3, 3, 4]));

// Un des deux dés "3" est assigné (retiré du pool réel) -> le pool
// rétrécit à 3 éléments. Sans passer par un vrai commit (pas
// nécessaire pour ce test ciblé sur l'affichage), on simule
// exactement ce que fait le moteur : retirer UNE occurrence de "3".
const idx = G.roundState.dicePool[HUMAN].indexOf(3);
G.roundState.dicePool[HUMAN].splice(idx, 1);
win.render();
const slots2 = win.eval('diceboardSlots("Vous")');
console.log("Les 3 positions des dés restants n'ont PAS bougé (attendu true) :",
  slots.map((v, i) => (v === 3 ? true : v === slots2[i])).every(Boolean));
console.log("Exactement un emplacement est maintenant vide (attendu true) :",
  slots2.filter((v) => v === null).length === 1);

section("Test 6 — Jetons dégât : rendu sous le dashboard, priorité gauche, face générique");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const noDmg = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const oneDmg = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
oneDmg.damageTokens = ["dent"];
const twoDmg = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
twoDmg.damageTokens = ["dent", "shrapnel"];
G.allCars.push(noDmg, oneDmg, twoDmg);
win.render();

const dashboardsEl = dom.window.document.getElementById("dashboards");
const dmgCount = [...dashboardsEl.querySelectorAll("image")].filter((img) => img.getAttribute("href").includes("damage-front.webp")).length;
console.log("Exactement 3 images damage-front.webp au total (0 pour SMALL + 1 pour MEDIUM + 2 pour LARGE) (attendu true) :", dmgCount === 3);
console.log("Aucun type de dégât révélé dans le rendu (dent/shrapnel) (attendu true) :", !dashboardsEl.innerHTML.includes("damage-dent") && !dashboardsEl.innerHTML.includes("damage-shrapnel"));

section("Test 7 — Command board : Drift (die 3, pas de sous-étape) jusqu'au commit");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s7 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m7 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l7 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(s7, m7, l7);
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

win.pickDie(4);
win.render();
win.pickCar(m7); // dé 4 posé sur medium (ANY)
win.render();
clickables = dashboardClickables(dom);
console.log("3 dés restants cliquables pour Command après pose ANY (attendu true) :", clickables.length - 1 === 3);

// Clique le dé "3" restant (pip count = 3) pour le consacrer à une Command.
const dieByPips = (n) => clickables.find((el) => el.querySelectorAll("image").length - 1 === n);
click(dom, dieByPips(3));
sel = win.eval("sel");
console.log("Étape passée à 'command' (attendu true) :", sel.step === "command");
console.log("commandDieValue = 3 (attendu true) :", sel.commandDieValue === 3);

win.render();
clickables = dashboardClickables(dom);
console.log("Slots Command éligibles pour un dé 3 (nitro+drift+airstrike) + le dé ANY posé (toujours annulable) (attendu true) :", clickables.length === 4);

click(dom, clickables[1]); // ordre de rendu : nitro, drift, repair, airstrike -> drift = 2e éligible ici
sel = win.eval("sel");
console.log("Type Command choisi = 'drift' (attendu true) :", sel.commandType === "drift");
console.log("Drift n'a pas de sous-étape -> commit AUTOMATIQUE, mouvement déjà démarré (attendu true) :", sel.step === "move-step" || sel.step === "entry-row");
console.log("sel.command bien construit (attendu true) :", sel.command && sel.command.type === "drift" && sel.command.dieValue === 3);

win.render();
const dashHtml7 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le dé de Command (tourné 45°) est visible sur le command board (attendu true) :", dashHtml7.includes("rotate(45"));

section("Test 8 — Command board : Repair (die 6) — clic sur un jeton dégât visible");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s8 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m8 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
m8.damageTokens = ["dent"]; // réparable
const l8 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(s8, m8, l8);
G.roundState.dicePool[HUMAN] = [6, 3, 1, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

win.pickDie(3);
win.render();
win.pickCar(s8); // active un AUTRE véhicule (small) que celui endommagé (medium)
win.render();
clickables = dashboardClickables(dom);
const dieByPips8 = (n) => clickables.find((el) => el.querySelectorAll && el.tagName === "g" && el.querySelectorAll("image").length - 1 === n);
click(dom, dieByPips8(6)); // consacre le dé 6 à une Command
sel = win.eval("sel");
console.log("commandDieValue = 6 (attendu true) :", sel.commandDieValue === 6);

win.render();
clickables = dashboardClickables(dom);
console.log("2 slots Command éligibles (repair + airstrike) + le dé ANY posé (attendu true) :", clickables.length === 3);
click(dom, clickables[0]); // ordre de rendu : nitro, drift, repair, airstrike -> repair = 1er éligible ici
sel = win.eval("sel");
console.log("Étape passée à 'repair-target' (attendu true) :", sel.step === "repair-target");

win.render();
const repairClickables = [...dom.window.document.querySelectorAll("#dashboards .clickable")].filter((el) => el.tagName === "image");
console.log("1 jeton dégât cliquable (celui du véhicule medium) (attendu true) :", repairClickables.length === 1);
console.log("Un halo vert (#b0d458) est visible derrière le jeton réparable (attendu true) :", dom.window.document.getElementById("dashboards").innerHTML.includes('fill="#b0d458"'));

click(dom, repairClickables[0]);
sel = win.eval("sel");
console.log("Repair cible bien le véhicule medium (attendu true) :", sel.command && sel.command.type === "repair" && sel.command.target === m8);
console.log("Étape passée à 'move-step'/'entry-row' — commit AUTOMATIQUE (attendu true) :", sel.step === "move-step" || sel.step === "entry-row");
console.log("La réparation a déjà été appliquée par le commit automatique (attendu true) :", m8.damageTokens.length === 0);

section("Test 9 — Repair : le joueur cible un jeton précis, l'autre garde sa place");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s9 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m9 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
m9.damageTokens = ["dent", "shrapnel"]; // 2 jetons distincts -> inopérable
m9.status = win.eval("CAR_STATUS").INOPERABLE;
const l9 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
G.allCars.push(s9, m9, l9);
G.roundState.dicePool[HUMAN] = [6, 3, 1, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

const slots9 = win.eval('damageSlots(G.allCars.find(c => c.id === ' + m9.id + '))');
console.log("Positions initiales : gauche='dent', droite='shrapnel' (attendu true) :", slots9.left === "dent" && slots9.right === "shrapnel");

win.pickDie(3);
win.render();
win.pickCar(s9);
win.render();
clickables = dashboardClickables(dom);
const dieByPips9 = (n) => clickables.find((el) => el.tagName === "g" && el.querySelectorAll("image").length - 1 === n);
click(dom, dieByPips9(6));
win.render();
clickables = dashboardClickables(dom).filter((el) => el.tagName === "rect");
click(dom, clickables[0]); // seul "repair" est éligible ici (véhicule inopérable, pas de tir Airstrike sur soi)
sel = win.eval("sel");
console.log("Étape passée à 'repair-target' (attendu true) :", sel.step === "repair-target");

win.render();
const repairImgs = [...dom.window.document.querySelectorAll("#dashboards image.clickable")];
console.log("2 jetons cliquables (gauche + droite) (attendu true) :", repairImgs.length === 2);

// Clique le 2e (droite, "shrapnel" d'après les positions initiales).
click(dom, repairImgs[1]);
sel = win.eval("sel");
console.log("Le jeton ciblé est bien 'shrapnel' (celui de droite) (attendu true) :", sel.command && sel.command.tokenValue === "shrapnel");

// Le clic ci-dessus a déjà déclenché le commit automatiquement (plus
// de bouton de confirmation, retour de Mayrik) — pas besoin de
// rappeler commitAssignAndCommand() ici.
console.log("'dent' (gauche) toujours présent, 'shrapnel' (droite) retiré (attendu true) :", JSON.stringify(m9.damageTokens) === JSON.stringify(["dent"]));

const slots9b = win.eval('damageSlots(G.allCars.find(c => c.id === ' + m9.id + '))');
console.log("'dent' reste bien à GAUCHE (ne glisse pas) après le retrait de 'shrapnel' (attendu true) :", slots9b.left === "dent" && slots9b.right === null);

section("Test 10 — Phase de tir : marqueur de cible + refus, sur le plateau");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
const shooter = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 2);
const enemy = win.createCar(OPPONENT, CAR_SIZE.SMALL, 6, 2); // pile devant (front)
G.allCars.push(shooter, enemy);
win.resetSelection();
sel = win.eval("sel");
sel.car = shooter;
sel.shootTargets = win.eval("getShootTargetOptions")(shooter, G.allCars);
sel.step = "shoot";
win.render();

const boardEl = dom.window.document.getElementById("board");
const targetImgs = [...boardEl.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes("target-small"));
console.log("Le marqueur target-small est affiché sur l'ennemi à portée (attendu true) :", targetImgs.length === 1);

const declineImgs = [...boardEl.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes("marker-no.webp"));
console.log("Le marqueur marker-no est affiché derrière le tireur (attendu true) :", declineImgs.length === 1);

click(dom, targetImgs[0]);
console.log("Le clic sur la cible a bien déclenché une résolution (véhicule ennemi touché ou statut changé, ou étape terminée) (attendu true) :", win.eval("sel").step !== "shoot" || enemy.damageTokens.length > 0);

section("Test 11 — Arc de tir Airstrike : marqueurs de cible + refus, même arc entièrement occupé");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
// 3 ennemis occupent les 3 cases de l'arc avant du chopper posé en
// (5,2) : front=(6,2), front-left=(5,1), front-right=(5,3) [rangée
// paire -> diagColOffset=0, voir getFrontArc].
const e1 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 6, 2);
const e2 = win.createCar(OPPONENT, CAR_SIZE.MEDIUM, 5, 1);
const e3 = win.createCar(OPPONENT, CAR_SIZE.LARGE, 5, 3);
G.allCars.push(e1, e2, e3);
const chopper = win.createChopper(HUMAN);
chopper.placed = true;
chopper.col = 5; chopper.row = 2;
G.allChoppers.push(chopper);
win.resetSelection();
sel = win.eval("sel");
sel.car = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 2); // panneau texte suppose sel.car défini (toujours vrai en vraie partie)
sel.airstrikePlacement = { col: 5, row: 2 };
sel.commandDieValue = 4;
sel.step = "airstrike-shoot-arc";
win.render();

const boardEl2 = dom.window.document.getElementById("board");
const targetSizes = ["small", "medium", "large"].map((sz) =>
  [...boardEl2.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes(`target-${sz}.webp`)).length
);
console.log("Les 3 tailles de cible sont bien affichées (une par ennemi dans l'arc, arc entièrement occupé) (attendu true) :", JSON.stringify(targetSizes) === JSON.stringify([1, 1, 1]));

const declineImgs2 = [...boardEl2.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes("marker-no.webp"));
console.log("marker-no reste affiché même si les 3 cases de l'arc sont occupées (attendu true) :", declineImgs2.length === 1);

click(dom, declineImgs2[0]);
sel = win.eval("sel");
console.log("Le refus appelle bien declineAirstrikeShoot (commandType airstrike, target null) (attendu true) :", sel.command && sel.command.type === "airstrike" && sel.command.target === null);

section("Test 12 — Relance de Slam : marker-reroll (case du Slam) + marker-no (derrière le décideur)");

function clearHazardsAround(win, board, col, row) {
  win.getSpace(board, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(board, c, r);
    if (cell) cell.hazard = null;
  }
}

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b12 = win.board();
clearHazardsAround(win, b12, 4, 3);
const humanCar12 = win.createCar(HUMAN, CAR_SIZE.LARGE, 3, 3);
const aiCar12 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 4, 3);
G.allCars.push(humanCar12, aiCar12);

sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = false;
sel.car = humanCar12;
sel.dieValue = 1;
sel.turnLabel = "Test — tour humain";
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel.remaining = 1;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = false;
sel.inRoadBonus = false;
sel.step = "move-step";
win.pickMoveStep({ direction: "front", col: 4, row: 3, outcome: "slam", cost: 1 });
win.render();

console.log("Pause de relance bien obtenue (attendu true) :", sel.step === "slam-reroll-choice");
const ctx12 = win.eval("sel.pendingHumanSlam.ctx");
console.log("dé Slam =", ctx12.slamRoll, "| dé Direction =", ctx12.directionRoll);
const delta12 = win.getDirectionDelta(ctx12.directionRoll, ctx12.topCar.col, ctx12.topCar.row);
const destCol = ctx12.topCar.col + delta12.dCol, destRow = ctx12.topCar.row + delta12.dRow;

const boardEl3 = dom.window.document.getElementById("board");
const rerollImgs = [...boardEl3.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes("marker-reroll.webp"));
const slamFaceImgs = [...boardEl3.querySelectorAll("image")].filter((el) => el.getAttribute("href").includes(`die-fx-slam-${ctx12.slamRoll}.webp`));
const dirFaceImgs = [...boardEl3.querySelectorAll("image")].filter((el) => el.getAttribute("href").includes("die-fx-direction-"));
const noImgsSlam = [...boardEl3.querySelectorAll("image.clickable")].filter((el) => el.getAttribute("href").includes("marker-yes.webp"));

console.log("marker-reroll toujours affiché sur la case du Slam (attendu true) :", rerollImgs.length === 1);
console.log("La face du dé Slam est affichée UNE FOIS, sur la case de DESTINATION (attendu true) :", slamFaceImgs.length === 1);
console.log("...et n'est PAS cliquable (retour de Mayrik : marker-reroll suffit) (attendu true) :", slamFaceImgs[0] && slamFaceImgs[0].getAttribute("pointer-events") === "none" && !slamFaceImgs[0].classList.contains("clickable"));
const slamFaceCenter = win.cellCenter(destCol, destRow);
const rerollCenter = win.cellCenter(ctx12.topCar.col, ctx12.topCar.row);
console.log("...et cette case de destination est bien DIFFÉRENTE de la case du Slam (attendu true) :",
  Math.abs(slamFaceCenter.cx - rerollCenter.cx) > 1 || Math.abs(slamFaceCenter.cy - rerollCenter.cy) > 1);
console.log("Le dé Direction n'est PAS affiché (retour de Mayrik) (attendu true) :", dirFaceImgs.length === 0);
console.log("marker-yes (pas marker-no, retour de Mayrik) affiché derrière le véhicule qui décide (attendu true) :", noImgsSlam.length === 1);

click(dom, noImgsSlam[0]);
sel = win.eval("sel");
console.log("Cliquer marker-yes a bien répondu 'j'accepte ce résultat' (pause terminée) (attendu true) :", !sel.pendingHumanSlam);

section("Test 13 — Airstrike : le chopper s'affiche à sa position choisie pendant l'arc de tir");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
const e1b = win.createCar(OPPONENT, CAR_SIZE.SMALL, 6, 2);
G.allCars.push(e1b);
const chopper13 = win.createChopper(HUMAN);
G.allChoppers.push(chopper13);
win.resetSelection();
sel = win.eval("sel");
sel.car = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 2);
sel.airstrikePlacement = { col: 5, row: 2 };
sel.commandDieValue = 4;
sel.step = "airstrike-shoot-arc";
win.render();

const boardEl4 = dom.window.document.getElementById("board");
const chopperImgs = [...boardEl4.querySelectorAll("image")].filter((el) => el.getAttribute("href").includes("chopper-blue.webp"));
console.log("Le chopper est affiché sur le plateau pendant l'arc de tir (attendu true) :", chopperImgs.length >= 1);

section("Test 14 — Diceboard : halo vert derrière les dés cliquables");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
G.allCars.push(win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0), win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2));
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
const dashHtml14 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Un halo vert (#b0d458) est présent sur le diceboard (attendu true) :", dashHtml14.includes('stroke="#b0d458"'));

section("Test 15 — Bug réel trouvé par Mayrik : un dé cliquable ne doit JAMAIS avoir pointer-events=none sur ses images internes");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
G.allCars.push(win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0), win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2));
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
const clickableDieGroup = [...dom.window.document.querySelectorAll("#dashboards g.clickable")][0];
const innerImgsWithPE = [...clickableDieGroup.querySelectorAll("image")].filter((img) => img.getAttribute("pointer-events") === "none");
console.log("Aucune image interne du dé cliquable n'a pointer-events=none (attendu true) :", innerImgsWithPE.length === 0);
console.log("Le halo vert du diceboard fait EXACTEMENT la taille d'un dé, même style que les autres surbrillances (bordure + remplissage) (attendu true) :",
  (() => {
    const halo = [...dom.window.document.querySelectorAll("#dashboards rect")].find((r) => r.getAttribute("stroke") === "#b0d458" && r.getAttribute("fill") === "#b0d458" && parseFloat(r.getAttribute("width")).toFixed(1) === win.eval("DIE_DISPLAY_SIZE").toFixed(1));
    return !!halo;
  })());

section("Test 16 — Airstrike : une case avec un hazard RÉVÉLÉ (face visible, ex. Oil Slick) est exclue du placement");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
const b16 = win.board();
const cell16 = win.getSpace(b16, 5, 2);
cell16.hazard = null;
cell16.revealedHazard = "oil_slick"; // hazard "persist" déjà résolu, face visible
const chopper16 = win.createChopper(HUMAN);
G.allChoppers.push(chopper16);
const placements16 = win.listValidAirstrikePlacements(b16, G.allCars, G.allChoppers, chopper16);
console.log("La case avec un hazard révélé n'est PAS dans les placements valides (attendu true) :",
  !placements16.some((p) => p.col === 5 && p.row === 2));

section("Test 17 — Bouton 'Jouer le tour de l'IA' déplacé sur le command board de l'IA (plus dans le panneau texte)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
win.render();
const panelHtml17 = dom.window.document.getElementById("panel").innerHTML;
const dashHtml17 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le panneau texte ne contient plus le bouton (attendu true) :", !panelHtml17.includes("Play the AI's turn"));
console.log("Le bouton est bien présent sur les dashboards, dans un foreignObject (attendu true) :",
  dashHtml17.includes("Play the AI's turn") && dashHtml17.includes("foreignObject"));

section("Test 18 — Cases de mouvement affichées dès l'étape command-die (retour de Mayrik : pas besoin de reposer un dé)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s18 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 2);
G.allCars.push(s18, win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 0));
G.roundState.dicePool[HUMAN] = [4, 3, 3, 1];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
win.pickDie(4);
win.render();
win.pickCar(s18);
sel = win.eval("sel");
console.log("Étape passée à 'command-die' (attendu true) :", sel.step === "command-die");
win.render();

const boardPolys = [...dom.window.document.getElementById("board").querySelectorAll("polygon.clickable")];
console.log("Des cases de destination sont déjà cliquables SANS reposer de dé (attendu true) :", boardPolys.length > 0);

const before18 = { col: s18.col, row: s18.row };
boardPolys[0].dispatchEvent(new win.Event("click", { bubbles: true }));
sel = win.eval("sel");
console.log("Le clic a bien fait progresser au-delà de 'command-die' (plus de Command en attente) (attendu true) :", sel.step !== "command-die" && sel.step !== "car");
console.log("Le véhicule a bien bougé (attendu true) :", s18.col !== before18.col || s18.row !== before18.row);

section("Test 19 — Dé sur l'emplacement END TURN une fois le tour du véhicule terminé");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s19 = win.createCar(HUMAN, CAR_SIZE.SMALL, 6, 2); // déjà loin -> mouvement finira vite
G.allCars.push(s19, win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 0));
G.roundState.dicePool[HUMAN] = [1, 3, 3, 4];
G.roundState.roundNumber = 1; // tir désactivé -> passage direct à finishHumanTurn après le mouvement
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
sel = win.eval("sel");
sel.mode = "assign";
sel.commandAvailable = false;
sel.car = s19;
sel.dieValue = 1;
sel.turnLabel = "Test";
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel.remaining = 1;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = true; // évite le bonus Road pour ce test ciblé
sel.inRoadBonus = false;
sel.step = "move-step";
const opt19 = win.getMovementStepOptions(win.board(), s19, 1, G.allCars)[0];
win.pickMoveStep(opt19);
win.render();
console.log("Le tour est bien terminé (sel réinitialisé) (attendu true) :", win.eval("sel").car === undefined);
const dashHtml19 = dom.window.document.getElementById("dashboards").innerHTML;
const etSlots = win.eval("endTurnDieState");
console.log("endTurnDieState contient bien une entrée pour ce véhicule (attendu true) :", !!etSlots[s19.id] && etSlots[s19.id].dieValue === 1);
console.log("Un dé est bien rendu sur le dashboard (die-move visible) (attendu true) :", dashHtml19.includes("die-move-"));

section("Test 20 — Airstrike au round 1 : pas de phase de tir, retour direct au mouvement");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.roundNumber = 1;
const s20 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 2);
G.allCars.push(s20);
const chopper20 = win.createChopper(HUMAN);
G.allChoppers.push(chopper20);
win.resetSelection();
sel = win.eval("sel");
sel.car = s20;
sel.commandDieValue = 4;
win.pickAirstrikePlacement(5, 2);
sel = win.eval("sel");
console.log("Round 1 -> pas d'étape airstrike-shoot-arc, commit direct (attendu true) :", sel.step !== "airstrike-shoot-arc");
console.log("sel.command.target est bien null (aucun tir tenté) (attendu true) :", sel.command && sel.command.target === null);

section("Test 21 — Bonus Road : marker-road affiché même en bord de plateau (sortie de tuile)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b21 = win.board();
// Place le véhicule sur la DERNIÈRE colonne existante -> "devant" est
// forcément une sortie de tuile (exits-front), jamais une case réelle.
const lastCol21 = b21.cols - 1;
const car21 = win.createCar(HUMAN, win.eval("CAR_SIZE").MEDIUM, lastCol21, 3);
G.allCars.push(car21);
G.roundState.roadDie = 2;
sel = win.eval("sel");
sel.mode = "assign";
sel.car = car21;
sel.step = "road-bonus-choice";
win.render();

const boardHtml21 = dom.window.document.getElementById("board").innerHTML;
console.log("marker-road-2 est bien affiché même en bord de plateau (attendu true) :", boardHtml21.includes("marker-road-2.webp"));
console.log("marker-no est aussi affiché (refus) (attendu true) :", boardHtml21.includes("marker-no.webp"));

section("Test 22 — Coast : le dé reste affiché sur son emplacement après la fin du mouvement");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s22 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
[s22, win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2)].forEach((c, i) => {
  if (i > 0) G.allCars.push(c);
});
G.allCars.push(s22);
s22.movedThisRound = true;
s22.coastCount = 0;
G.allCars.filter((c) => c.owner === HUMAN && c !== s22).forEach((c) => { c.movedThisRound = true; c.coastCount = 0; });
G.roundState.dicePool[HUMAN] = [4];
G.roundState.roundNumber = 1;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
let clickables22 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables22[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie
win.render();
clickables22 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables22[0].dispatchEvent(new win.Event("click", { bubbles: true })); // coast slot
sel = win.eval("sel");
const opt22 = win.getMovementStepOptions(win.board(), sel.car, sel.remaining, G.allCars)[0];
win.pickMoveStep(opt22);
win.render();
sel = win.eval("sel");
console.log("Le tour est bien terminé (sel réinitialisé) (attendu true) :", sel.car === undefined);
const cdState = win.eval("coastDieState");
console.log("coastDieState contient bien une entrée pour ce véhicule, stockée sur coast2 (prioritaire, retour de Mayrik) (attendu true) :", !!cdState[s22.id] && cdState[s22.id].slots[1] === 4);
const dashHtml22 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Un dé est bien rendu sur le dashboard après la fin du tour (attendu true) :", dashHtml22.includes("die-move-"));

section("Test 23 — Marqueurs dégât/inopérable : 75% de la taille, centrés verticalement, calés contre le bord gauche du véhicule");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
const dmgCar23 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 3);
dmgCar23.damageTokens = ["dent"];
G.allCars.push(dmgCar23);
win.render();
const boardEl23 = [...dom.window.document.getElementById("board").querySelectorAll("image")].find((el) => el.getAttribute("href").includes("marker-damaged.webp"));
const MARKER_ICON_SIZE23 = win.eval("MARKER_ICON_SIZE");
const damageMarkerSize23 = MARKER_ICON_SIZE23 * 0.75;
const cellC23 = win.cellCenter(4, 3);
const vehicleLeftX23 = cellC23.cx + win.eval("CAR_IMG_OFFSET_X") - win.eval("CAR_IMG_W") / 2;
const expectedX23 = vehicleLeftX23; // bord gauche EXACT du marqueur = bord gauche EXACT du véhicule, retour de Mayrik
const expectedY23 = cellC23.cy - damageMarkerSize23 / 2;
console.log("Taille réduite à 75% (attendu true) :", Math.abs(parseFloat(boardEl23.getAttribute("width")) - damageMarkerSize23) < 0.5);
console.log("Centré verticalement sur le véhicule (attendu true) :", Math.abs(parseFloat(boardEl23.getAttribute("y")) - expectedY23) < 0.5);
console.log("Calé horizontalement, bord gauche exact contre bord gauche du véhicule (attendu true) :", Math.abs(parseFloat(boardEl23.getAttribute("x")) - expectedX23) < 0.5);

const parentGroup23 = boardEl23.closest("g");
const childrenOrder23 = [...parentGroup23.children];
const markerIdx23 = childrenOrder23.indexOf(boardEl23);
const vehicleImgIdx23 = childrenOrder23.map((el, i) => (el.tagName === "image" && el.getAttribute("href").includes("images/vehicles/") ? i : -1)).filter((i) => i !== -1).pop();
console.log("Le marqueur est dessiné APRÈS le véhicule dans le SVG (donc AU-DESSUS visuellement, retour de Mayrik) (attendu true) :", markerIdx23 > vehicleImgIdx23);

section("Test 24 — Bandeau de fin de partie centré sur le plateau (SVG), plus de div externe");

dom = makeDom();
win = dom.window;
win.newGame();
win.eval("gameOver = true; gameOverInfo = { winner: 'Vous', reason: 'Finish Line' };");
win.render();
const boardHtml24 = dom.window.document.getElementById("board").innerHTML;
console.log("Le bandeau est bien dessiné DANS le SVG du plateau, nouveau format anglais (attendu true) :", boardHtml24.includes("Game over: Blue wins by Finish Line"));
console.log("L'ancien bandeau HTML externe reste caché (attendu true) :", dom.window.document.getElementById("winnerBanner").style.display === "none");

section("Test 25 — Bug de fond : coastCount s'incrémente réellement, coast1 reste toujours proposé au clic");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s25 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m25 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l25 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
[s25, m25, l25].forEach((c) => { c.movedThisRound = true; });
G.allCars.push(s25, m25, l25);
G.roundState.dicePool[HUMAN] = [4, 3];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

// --- 1er Coast complet sur s25 ---
let clickables25 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables25[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie
win.render();
clickables25 = [...dom.window.document.querySelectorAll("#dashboards rect.clickable")];
const s25Rect = clickables25[0]; // small en 1er dans l'ordre de rendu
s25Rect.dispatchEvent(new win.Event("click", { bubbles: true }));
sel = win.eval("sel");
const opts25 = win.getMovementStepOptions(win.board(), sel.car, sel.remaining, G.allCars);
const opt25 = opts25.find((o) => o.outcome !== "eliminated-edge" && !String(o.outcome || "").startsWith("exits")) || opts25[0];
win.pickMoveStep(opt25);
win.render();

console.log("coastCount vaut bien 1 après le 1er Coast complet (attendu true) — bug de fond corrigé :", s25.coastCount === 1);

// --- 2e Coast sur le MÊME véhicule (seul dé restant, tous les autres déjà actifs) ---
sel = win.eval("sel");
console.log("Bien de retour à l'étape 'die' pour le tour suivant (attendu true) :", sel.step === "die");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN); // on saute le tour de l'IA, hors-sujet ici
win.render();
clickables25 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables25[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie (dernier dé)
win.render();
const ctx25 = win.eval("currentTurnContext()");
console.log("Mode bien 'coast', s25 toujours éligible (coastCount=1 < 2) (attendu true) :",
  ctx25.mode === "coast" && ctx25.coastableCars.includes(s25));

clickables25 = [...dom.window.document.querySelectorAll("#dashboards rect.clickable")];
const s25Rect2 = clickables25.find((r) => true); // s25 est le seul restant possible ici selon le setup
s25Rect2.dispatchEvent(new win.Event("click", { bubbles: true }));
sel = win.eval("sel");
console.log("Le 2e clic cible bien s25 (attendu true) :", sel.car === s25);

// Vérifie que la position cliquée correspond bien à coast1 — TOUJOURS
// le slot proposé au clic désormais, même pour un 2e Coast (retour de
// Mayrik : coast2 ne sert plus qu'au stockage, jamais à la sélection).
const box25 = win.eval('boardBox("small")');
const rowBBox25 = win.eval("ROW_BBOX");
const dimX25 = -rowBBox25.minX + box25.x, dimY25 = -rowBBox25.minY + box25.y;
const frac25 = win.eval("VEHICLE_SLOT_FRACTION.small");
const DIE25 = win.eval("DIE_DISPLAY_SIZE");
const coast1X = dimX25 + frac25.coast1.x * box25.w - DIE25 / 2;
console.log("Le slot proposé est bien TOUJOURS COAST1, même pour le 2e Coast (attendu true) :",
  Math.abs(parseFloat(s25Rect2.getAttribute("x")) - coast1X) < 1);

section("Test 26 — Véhicule inopérable : plus de transparence, rotation 180° conservée");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
const CAR_STATUS26 = win.eval("CAR_STATUS");
const inopCar26 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 3);
inopCar26.damageTokens = ["dent", "shrapnel"];
inopCar26.status = CAR_STATUS26.INOPERABLE;
G.allCars.push(inopCar26);
win.render();
const vehicleImgs26 = [...dom.window.document.getElementById("board").querySelectorAll("image")].filter((el) => el.getAttribute("href").includes("images/vehicles/medium-blue.webp"));
const vehicleImg26 = vehicleImgs26[vehicleImgs26.length - 1]; // la dernière = le véhicule réel (l'ombre partage le même chemin et vient avant)
console.log("Aucun attribut opacity sur le véhicule inopérable (attendu true) :", vehicleImg26.getAttribute("opacity") === null);
console.log("La rotation 180° est bien conservée (attendu true) :", (vehicleImg26.getAttribute("transform") || "").includes("rotate(180"));

section("Test 27 — Slam : marker-yes se décale vers rear-left si le dé Direction pointe pile sur la case arrière");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const largerCar27 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 3);
const smallerCar27 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 5, 3);
G.allCars.push(largerCar27, smallerCar27);
sel = win.eval("sel");
sel.pendingHumanSlam = {
  gen: null,
  onComplete: null,
  ctx: { topCar: smallerCar27, bottomCar: largerCar27, largerCar: largerCar27, smallerCar: smallerCar27, slamRoll: "top", directionRoll: "rear" }
};
sel.step = "slam-reroll-choice";
win.render();

const boardEl27 = dom.window.document.getElementById("board");
const rearArc27 = win.getRearArc(largerCar27);
const rearLeft27 = rearArc27.find((a) => a.name === "rear-left");
const yesImg27 = [...boardEl27.querySelectorAll("image.clickable")].find((el) => el.getAttribute("href").includes("marker-yes.webp"));
const MARKER_SIZE27 = win.eval("MARKER_ICON_SIZE");
const yesCenterX27 = parseFloat(yesImg27.getAttribute("x")) + MARKER_SIZE27 / 2;
const yesCenterY27 = parseFloat(yesImg27.getAttribute("y")) + MARKER_SIZE27 / 2;
const rearLeftCenter27 = win.cellCenter(rearLeft27.col, rearLeft27.row);
console.log("marker-yes s'est bien décalé vers rear-left quand le dé Direction pointe sur 'rear' (attendu true) :",
  Math.abs(yesCenterX27 - rearLeftCenter27.cx) < 1 && Math.abs(yesCenterY27 - rearLeftCenter27.cy) < 1);

section("Test 28 — Bouton IA : au-dessus de tout, coins arrondis partout, pas de transparence pendant l'animation");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
win.eval("G.aiAnimating = true;");
win.render();
const dashSvg28 = dom.window.document.getElementById("dashboards");
const lastChild28 = dashSvg28.lastElementChild;
console.log("Le bouton (foreignObject) est bien le DERNIER élément du SVG (au-dessus de tout) (attendu true) :", lastChild28.tagName.toLowerCase() === "foreignobject");
const btn28 = lastChild28.querySelector("button");
console.log("border-radius appliqué explicitement en inline (4 coins identiques) (attendu true) :", (btn28.getAttribute("style") || "").includes("border-radius:6px"));
console.log("opacity:1 explicite malgré disabled (plus de grisage pendant que l'IA joue) (attendu true) :", (btn28.getAttribute("style") || "").includes("opacity:1"));
console.log("Le bouton est bien désactivé pendant l'animation (attendu true) :", btn28.hasAttribute("disabled"));

section("Test 29 — Nouvelle logique Coast : le dé en cours de tour reste TOUJOURS sur coast1, même avec coastCount=1");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const s29 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
s29.movedThisRound = true;
s29.coastCount = 1; // a déjà coasté une fois -> coast1 doit quand même être proposé/affiché à nouveau
const m29 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
m29.movedThisRound = true;
const l29 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
l29.movedThisRound = true;
G.allCars.push(s29, m29, l29);
G.roundState.dicePool[HUMAN] = [4];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
let clickables29 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables29[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie
win.render();
clickables29 = [...dom.window.document.querySelectorAll("#dashboards rect.clickable")];
clickables29[0].dispatchEvent(new win.Event("click", { bubbles: true })); // slot coast1 de s29 (toujours coast1, retour de Mayrik)
win.render();

const box29 = win.eval('boardBox("small")');
const rowBBox29 = win.eval("ROW_BBOX");
const dimX29 = -rowBBox29.minX + box29.x, dimY29 = -rowBBox29.minY + box29.y;
const frac29 = win.eval("VEHICLE_SLOT_FRACTION.small");
const DIE29 = win.eval("DIE_DISPLAY_SIZE");
const coast1X29 = dimX29 + frac29.coast1.x * box29.w - DIE29 / 2;
const coast1Y29 = dimY29 + frac29.coast1.y * box29.h - DIE29 / 2;

const dashHtml29 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Un dé est bien rendu quelque part sur le dashboard (attendu true) :", dashHtml29.includes("die-move-"));
const postDieEl29 = [...dom.window.document.querySelectorAll("#dashboards g")].find((g) => {
  const img = g.querySelector("image");
  return img && Math.abs(parseFloat(img.getAttribute("x")) - coast1X29) < 1 && Math.abs(parseFloat(img.getAttribute("y")) - coast1Y29) < 1;
});
console.log("...et précisément SUR l'emplacement coast1, malgré coastCount=1 (nouvelle logique, attendu true) :", !!postDieEl29);

section("Test 30 — BUG BLOQUANT trouvé par Mayrik : marker-road doit s'afficher même si la case pile devant est Impassable");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b30 = win.board();
const clearHazardsAround30 = (col, row) => {
  win.getSpace(b30, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b30, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround30(5, 3);
const TERRAIN30 = win.eval("TERRAIN");
win.getSpace(b30, 6, 3).terrain = TERRAIN30.IMPASSABLE; // pile devant = bloqué
const car30 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 3);
G.allCars.push(car30);
G.roundState.roadDie = 3;
sel = win.eval("sel");
sel.mode = "assign";
sel.car = car30;
sel.step = "road-bonus-choice";
win.render();

const boardHtml30 = dom.window.document.getElementById("board").innerHTML;
console.log("marker-road-3 est bien affiché même si 'devant' est Impassable, repli sur front-left/right (attendu true) :", boardHtml30.includes("marker-road-3.webp"));
console.log("marker-no reste affiché comme avant (attendu true) :", boardHtml30.includes("marker-no.webp"));

section("Test 31 — Mise en page épurée : titre/badges/panel/damageRow/legend masqués, plateau calé en haut");

dom = makeDom();
win = dom.window;
win.newGame();
win.render();
console.log("h1 et .sub ont bien été retirés du DOM (attendu true) :", !dom.window.document.querySelector("h1") && !dom.window.document.querySelector(".sub"));
[".badges", "#panel", ".damageList", ".legend"].forEach((sel) => {
  const el = dom.window.document.querySelector(sel);
  const display = dom.window.getComputedStyle(el).display;
  console.log(`${sel} est bien masqué (display:none) (attendu true) :`, display === "none");
});
const bodyStyle = dom.window.getComputedStyle(dom.window.document.body);
console.log("Plus de padding sur body (plateau collé en haut) (attendu true) :", bodyStyle.padding === "0px" || bodyStyle.paddingTop === "0px");
console.log("#log reste bien visible (journal debug conservé) (attendu true) :", dom.window.getComputedStyle(dom.window.document.getElementById("log")).display !== "none");

section("Test 32 — Dé Road actif : rendu intégré aux dashboards, position calibrée, UNIQUEMENT sur la ligne du 1er joueur du round");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.roadDie = 2;
const roundStartPlayer32 = G.roundState.playerOrder[G.roundState.roundStartIndex];
console.log("1er joueur de ce round (pour référence) :", roundStartPlayer32);
win.render();

const dashHtml32 = dom.window.document.getElementById("dashboards").innerHTML;
const roadDieImgs32 = [...dom.window.document.querySelectorAll("#dashboards image")].filter((el) => el.getAttribute("href").includes("die-fx-road-2.webp"));
console.log("Le dé Road (die-fx-road-2) est bien affiché (attendu true) :", roadDieImgs32.length === 1);
console.log("...UNE SEULE FOIS (retour de Mayrik : plus sur les deux lignes) (attendu true) :", roadDieImgs32.length === 1);
console.log("...à la taille normale des autres dés (DIE_DISPLAY_SIZE, pas MARKER_ICON_SIZE) (attendu true) :",
  Math.abs(parseFloat(roadDieImgs32[0].getAttribute("width")) - win.eval("DIE_DISPLAY_SIZE")) < 0.5);

// Retrouve dynamiquement la position réelle du dashboard SMALL du 1er
// joueur du round (plutôt que de supposer qu'il est en ligne 0).
const roundStartColor32 = win.eval(`PLAYER_CAR_COLOR["${roundStartPlayer32}"]`);
const smallImg32 = [...dom.window.document.querySelectorAll("#dashboards image")].find((el) => (el.getAttribute("href") || "").includes(`dashboard-${roundStartColor32}-small`));
const smallX32 = parseFloat(smallImg32.getAttribute("x")), smallY32 = parseFloat(smallImg32.getAttribute("y"));
const smallW32 = parseFloat(smallImg32.getAttribute("width")), smallH32 = parseFloat(smallImg32.getAttribute("height"));
const frac32 = win.eval("ROAD_DIE_FRACTION");
const DIE32 = win.eval("DIE_DISPLAY_SIZE");
const expectedX32 = smallX32 + frac32.x * smallW32 - DIE32 / 2;
const expectedY32 = smallY32 + frac32.y * smallH32 - DIE32 / 2;
console.log("Position conforme à la fraction calibrée par Mayrik (x=0.142, y=-0.126, relative à SMALL) (attendu true) :",
  Math.abs(parseFloat(roadDieImgs32[0].getAttribute("x")) - expectedX32) < 0.5 && Math.abs(parseFloat(roadDieImgs32[0].getAttribute("y")) - expectedY32) < 0.5);

section("Test 33 — Bouton IA : centrage vertical corrigé (plus de margin-top parasite)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
win.render();
const btn33 = [...dom.window.document.querySelectorAll("#dashboards button")][0];
console.log("Le bouton n'a plus de margin-top parasite (centrage vertical correct) (attendu true) :", !(btn33.getAttribute("style") || "").includes("margin-top"));
console.log("La classe .primary n'ajoute plus de margin (vérifié en CSS) (attendu true) :", dom.window.getComputedStyle(btn33).marginTop === "0px");

section("Test 34 — Scénario complet bout-en-bout : 1er Coast -> bascule sur coast2, 2e Coast -> reste sur coast1");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const b34 = win.board();
const clearHazardsAround34 = (col, row) => {
  win.getSpace(b34, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b34, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround34(5, 0);
const s34 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 0);
const m34 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1);
const l34 = win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2);
[s34, m34, l34].forEach((c) => { c.movedThisRound = true; });
G.allCars.push(s34, m34, l34);
G.roundState.dicePool[HUMAN] = [4, 3];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();

// --- 1er Coast complet sur s34 ---
let clickables34 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables34[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie
win.render();
clickables34 = [...dom.window.document.querySelectorAll("#dashboards rect.clickable")];
clickables34[0].dispatchEvent(new win.Event("click", { bubbles: true })); // coast1 (toujours, s34 en 1er)
sel = win.eval("sel");
const opts34a = win.getMovementStepOptions(win.board(), sel.car, sel.remaining, G.allCars);
const opt34a = opts34a.find((o) => o.outcome !== "eliminated-edge" && !String(o.outcome || "").startsWith("exits")) || opts34a[0];
win.pickMoveStep(opt34a);
win.render();

let cdState34 = win.eval("coastDieState");
console.log("Après le 1er Coast : coast1 vide, coast2 contient le dé (bascule, attendu true) :",
  cdState34[s34.id].slots[0] === null && cdState34[s34.id].slots[1] === 4);

// --- 2e Coast, même véhicule (on force le retour à HUMAN, le tour de l'IA n'est pas le sujet ici) ---
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.render();
clickables34 = [...dom.window.document.querySelectorAll("#dashboards .clickable")];
clickables34[0].dispatchEvent(new win.Event("click", { bubbles: true })); // pickDie (dernier dé, 3)
win.render();
clickables34 = [...dom.window.document.querySelectorAll("#dashboards rect.clickable")];
clickables34[0].dispatchEvent(new win.Event("click", { bubbles: true })); // coast1 à nouveau (toujours proposé)
sel = win.eval("sel");
console.log("Le 2e clic cible bien s34 à nouveau (attendu true) :", sel.car === s34);
const opts34b = win.getMovementStepOptions(win.board(), sel.car, sel.remaining, G.allCars);
const opt34b = opts34b.find((o) => o.outcome !== "eliminated-edge" && !String(o.outcome || "").startsWith("exits")) || opts34b[0];
win.pickMoveStep(opt34b);
win.render();

cdState34 = win.eval("coastDieState");
console.log("Après le 2e Coast : coast2 inchangé (1er dé), coast1 contient maintenant le 2e dé, y reste (attendu true) :",
  cdState34[s34.id].slots[0] === 3 && cdState34[s34.id].slots[1] === 4);

section("Test 35 — Symétrie IA : dé END TURN et dés Coast persistants, comme côté joueur (retour de Mayrik)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b35 = win.board();
const clearHazardsAround35 = (col, row) => {
  win.getSpace(b35, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b35, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround35(3, 3);
const aiCar35 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
G.allCars.push(aiCar35);
G.roundState.dicePool[OPPONENT] = [1, 2, 3, 4];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
const decision35 = { car: aiCar35, dieValue: 1, command: null, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const gen35 = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decision35, { isHumanOwner: (o) => o === HUMAN });
win.driveAiTurnGenerator(gen35, "Test — tour IA ASSIGN", decision35);

const etState35 = win.eval("endTurnDieState");
console.log("endTurnDieState contient bien une entrée pour le véhicule IA (ASSIGN) (attendu true) :", !!etState35[aiCar35.id] && etState35[aiCar35.id].dieValue === 1);
win.render();
const dashHtml35a = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Un dé est bien rendu sur le dashboard de l'IA après son tour (attendu true) :", dashHtml35a.includes("die-move-"));

// --- Coast côté IA ---
aiCar35.movedThisRound = true;
G.roundState.dicePool[OPPONENT] = [2];
const decisionCoast35 = { car: aiCar35, dieValue: 2, command: null, isEntry: false, isCoast: true, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const genCoast35 = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decisionCoast35, { isHumanOwner: (o) => o === HUMAN });
win.driveAiTurnGenerator(genCoast35, "Test — tour IA COAST", decisionCoast35);

const cdState35 = win.eval("coastDieState");
console.log("coastDieState contient bien une entrée pour le véhicule IA (COAST), sur coast2 (prioritaire) (attendu true) :",
  !!cdState35[aiCar35.id] && cdState35[aiCar35.id].slots[1] === 2);

section("Test 36 — Bug corrigé : le dé de Command reste affiché jusqu'à la fin du round (côté joueur)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars = G.allCars.filter((c) => c.owner !== HUMAN);
const b36 = win.board();
const clearHazardsAround36 = (col, row) => {
  win.getSpace(b36, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b36, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround36(5, 3);
const s36 = win.createCar(HUMAN, CAR_SIZE.SMALL, 5, 3);
G.allCars.push(s36, win.createCar(HUMAN, CAR_SIZE.MEDIUM, 5, 1), win.createCar(HUMAN, CAR_SIZE.LARGE, 5, 2));
G.roundState.dicePool[HUMAN] = [4, 3];
G.roundState.commandUsedThisRound[HUMAN] = false;
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(HUMAN);
win.resetSelection();
win.render();
win.pickDie(4);
win.pickCar(s36);
win.render();
win.pickCommandDieChoice(3);
win.render();
win.pickCommandChoice("drift"); // pas de sous-étape -> commit direct
win.render();
sel = win.eval("sel");
// Joue le mouvement jusqu'au bout (drift n'était que la Command, il
// faut réellement finir le tour pour atteindre finishHumanTurn).
// Case de départ dégagée -> pas de Slam attendu ; si un bonus Road
// est proposé, on le refuse pour finir le tour simplement.
for (let i = 0; i < 20 && sel.car !== undefined; i++) {
  if (sel.step === "road-bonus-choice") { win.declineRoadBonus(); win.render(); sel = win.eval("sel"); continue; }
  if (sel.step === "slam-reroll-choice") { win.resumeHumanSlamRerollChoice(false); win.render(); sel = win.eval("sel"); continue; }
  const optsD = win.getMovementStepOptions(win.board(), sel.car, sel.remaining, G.allCars);
  const optD = optsD.find((o) => o.outcome !== "eliminated-edge" && !String(o.outcome || "").startsWith("exits")) || optsD[0];
  if (!optD) break;
  win.pickMoveStep(optD);
  win.render();
  sel = win.eval("sel");
}

const cdStateCmd36 = win.eval("commandDieState");
console.log("commandDieState contient bien une entrée pour HUMAN (attendu true) :", !!cdStateCmd36[HUMAN] && cdStateCmd36[HUMAN].commandType === "drift" && cdStateCmd36[HUMAN].dieValue === 3);

// Simule un changement de véhicule actif (autre tour, sel réinitialisé) -> le dé doit rester affiché
win.resetSelection();
win.render();
// Retrouve dynamiquement la VRAIE position du command board de HUMAN
// dans le DOM (plutôt que de supposer qu'il reste en ligne 0 — une
// fois le tour terminé, le joueur actif bascule vers l'IA, qui peut
// désormais occuper la ligne du haut).
const dashSvg36 = dom.window.document.getElementById("dashboards");
const humanCmdImg36 = [...dashSvg36.querySelectorAll("image")].find((img) => (img.getAttribute("href") || "").includes("command-blue"));
const cmdX36 = parseFloat(humanCmdImg36.getAttribute("x")), cmdY36 = parseFloat(humanCmdImg36.getAttribute("y"));
const cmdW36 = parseFloat(humanCmdImg36.getAttribute("width")), cmdH36 = parseFloat(humanCmdImg36.getAttribute("height"));
const fracDrift36 = win.eval("COMMAND_SLOT_FRACTION.drift");
const DIE36 = win.eval("DIE_DISPLAY_SIZE");
const expectedX36 = cmdX36 + fracDrift36.x * cmdW36 - DIE36 / 2, expectedY36 = cmdY36 + fracDrift36.y * cmdH36 - DIE36 / 2;
const driftDieImg36 = [...dashSvg36.querySelectorAll("g")].find((g) => {
  const img = g.querySelector("image");
  return img && Math.abs(parseFloat(img.getAttribute("x")) - expectedX36) < 1 && Math.abs(parseFloat(img.getAttribute("y")) - expectedY36) < 1;
});
console.log("Le dé de Command reste bien affiché sur le slot DRIFT après resetSelection (attendu true) :", !!driftDieImg36);

section("Test 37 — Bug corrigé : le dé de Command s'affiche aussi côté IA (jamais affiché avant ce correctif)");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b37 = win.board();
const clearHazardsAround37 = (col, row) => {
  win.getSpace(b37, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b37, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround37(3, 3);
const aiCar37 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
G.allCars.push(aiCar37);
G.roundState.dicePool[OPPONENT] = [1, 2, 3, 4];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
const decision37 = { car: aiCar37, dieValue: 1, command: { type: "drift", dieValue: 3 }, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
const gen37 = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decision37, { isHumanOwner: (o) => o === HUMAN });
win.driveAiTurnGenerator(gen37, "Test — tour IA avec Command", decision37);

const cdStateCmd37 = win.eval("commandDieState");
console.log("commandDieState contient bien une entrée pour l'IA (attendu true) :", !!cdStateCmd37[OPPONENT] && cdStateCmd37[OPPONENT].commandType === "drift" && cdStateCmd37[OPPONENT].dieValue === 3);
win.render();
const dashHtml37 = dom.window.document.getElementById("dashboards").innerHTML;
console.log("Le dé de Command de l'IA est bien rendu sur son command board (attendu true) :", dashHtml37.includes("die-move-"));

section("Test 38 — BUG CORRIGÉ : le dé de l'IA doit s'effacer à la fin du round même quand SON tour termine le round");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
const b38 = win.board();
const clearHazardsAround38 = (col, row) => {
  win.getSpace(b38, col, row).hazard = null;
  const front = win.getFrontArc({ col, row });
  const rear = win.getRearArc({ col, row });
  for (const { col: c, row: r } of [...front, ...rear]) {
    const cell = win.getSpace(b38, c, r);
    if (cell) cell.hazard = null;
  }
};
clearHazardsAround38(3, 3);
const aiCar38 = win.createCar(OPPONENT, CAR_SIZE.SMALL, 3, 3);
G.allCars.push(aiCar38);
G.roundState.dicePool[OPPONENT] = [1];
G.roundState.currentPlayerIndex = win.eval("PLAYER_NAMES").indexOf(OPPONENT);
// Force ce tour à être le TOUT DERNIER du round : personne d'autre
// n'a de tour restant, et l'IA en est à son 3e (dernier).
G.roundState.turnsThisRound[HUMAN] = 3;
G.roundState.turnsThisRound[OPPONENT] = 2;
const roundBeforeThisTurn38 = G.roundState.roundNumber;

const decision38 = { car: aiCar38, dieValue: 1, command: null, isEntry: false, isCoast: false, destination: { path: ["front"] }, slam: null, roadBonusPath: null };
decision38.roundAtStart = G.roundState.roundNumber; // même chose que playAiTurn() ferait avant d'appeler executeDecisionGen
const gen38 = win.executeDecisionGen(G.progressionState, G.roundState, G.allCars, G.allChoppers, win.eval("PLAYER_NAMES"), OPPONENT, decision38, { isHumanOwner: (o) => o === HUMAN });
win.driveAiTurnGenerator(gen38, "Test — dernier tour du round", decision38);

console.log("Le round a bien avancé PENDANT ce tour (condition du bug) (attendu true) :", G.roundState.roundNumber === roundBeforeThisTurn38 + 1);
const etState38 = win.eval("endTurnDieState");
console.log("Le dé est bien estampillé sur le round PENDANT LEQUEL il a été joué, pas le suivant (bug corrigé, attendu true) :",
  etState38[aiCar38.id] && etState38[aiCar38.id].round === roundBeforeThisTurn38);
win.render();
const smallImg38 = [...dom.window.document.querySelectorAll("#dashboards image")].find((el) => (el.getAttribute("href") || "").includes("dashboard-orange-small") || (el.getAttribute("href") || "").includes(`dashboard-${win.eval('PLAYER_CAR_COLOR[OPPONENT]')}-small`));
const smallX38 = parseFloat(smallImg38.getAttribute("x")), smallY38 = parseFloat(smallImg38.getAttribute("y"));
const smallW38 = parseFloat(smallImg38.getAttribute("width")), smallH38 = parseFloat(smallImg38.getAttribute("height"));
const fracEndTurn38 = win.eval("VEHICLE_SLOT_FRACTION.small.endTurn");
const DIE38 = win.eval("DIE_DISPLAY_SIZE");
const expectedEndTurnX38 = smallX38 + fracEndTurn38.x * smallW38 - DIE38 / 2;
const expectedEndTurnY38 = smallY38 + fracEndTurn38.y * smallH38 - DIE38 / 2;
const staleDie38 = [...dom.window.document.querySelectorAll("#dashboards g")].find((g) => {
  const img = g.querySelector("image");
  return img && Math.abs(parseFloat(img.getAttribute("x")) - expectedEndTurnX38) < 1 && Math.abs(parseFloat(img.getAttribute("y")) - expectedEndTurnY38) < 1;
});
console.log("...et ne s'affiche donc PLUS sur l'emplacement END TURN maintenant que le round suivant est en cours (attendu true) :", !staleDie38);

console.log("\n=== Fin des tests dédiés (Dashboards, tranche 1) ===");

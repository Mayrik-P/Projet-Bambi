/**
 * Test jsdom dédié — correctif Coast/bonus Road (retour de Mayrik,
 * 28/08, capture des règles p.11 : "If your move is a coast [...]
 * You MAY NOT use the road die.") : un tour Coast resté 100% sur
 * route ne doit JAMAIS proposer le bonus Road, contrairement à un
 * mouvement normal. Sur le vrai bundle navigateur, vrai clic.
 * À lancer avec : node test-ui-coast-no-road-bonus.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "tools", "prototype.html"), "utf8");

function section(title) { console.log("\n=== " + title + " ==="); }
function makeDom() { return new JSDOM(html, { runScripts: "dangerously", resources: "usable" }); }
function panelText(dom) { return dom.window.document.getElementById("panel").textContent; }

section("Test 1 — Coast 100% route → PAS de proposition de bonus Road");

let dom = makeDom();
let win = dom.window;
win.newGame();
const HUMAN = win.eval("HUMAN");
const CAR_SIZE = win.eval("CAR_SIZE");
const TERRAIN = win.eval("TERRAIN");
let G = win.eval("G");
G.allCars.length = 0;
G.roundState.roadDie = 3; // dé Road du round, bien présent

const b = win.board();
// Force la case de départ ET la case d'arrivée du Coast à ROUTE, pour
// garantir sel.roadEligible = true après le pas.
const startCell = win.getSpace(b, 4, 3);
startCell.terrain = TERRAIN.ROAD;
startCell.hazard = null;
const destCell = win.getSpace(b, 5, 3);
destCell.terrain = TERRAIN.ROAD;
destCell.hazard = null;

const myCar = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 3);
myCar.movedThisRound = true; // condition Coast : déjà activée ce round
G.allCars.push(myCar);

let sel = win.eval("sel");
sel.mode = "coast";
sel.commandAvailable = false;
sel.car = myCar;
sel.dieValue = 1;
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel.remaining = 1;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = false;
sel.inRoadBonus = false;
sel.step = "move-step";

const option = { direction: "front", col: 5, row: 3, outcome: "normal", cost: 1 };
win.pickMoveStep(option);
sel = win.eval("sel"); // re-fetch : resetSelection()/proceedToShootPhase() peuvent réassigner `sel`
win.render();

console.log("sel.step n'est JAMAIS road-bonus-choice (attendu true) :", sel.step !== "road-bonus-choice");
console.log("Le panneau ne mentionne pas le bonus Road (attendu true) :", !panelText(dom).includes("bonus Road"));
console.log("La voiture a bien avancé d'exactement 1 case, pas plus (attendu col 5) :", myCar.col);

section("Test 2 — Non-régression : un mouvement NORMAL (pas Coast) 100% route propose bien le bonus Road");

dom = makeDom();
win = dom.window;
win.newGame();
G = win.eval("G");
G.allCars.length = 0;
G.roundState.roadDie = 3;
const b2 = win.board();
const startCell2 = win.getSpace(b2, 4, 3);
startCell2.terrain = TERRAIN.ROAD;
startCell2.hazard = null;
const destCell2 = win.getSpace(b2, 5, 3);
destCell2.terrain = TERRAIN.ROAD;
destCell2.hazard = null;
const myCar2 = win.createCar(HUMAN, CAR_SIZE.MEDIUM, 4, 3);
G.allCars.push(myCar2);

sel = win.eval("sel");
sel.mode = "assign"; // mouvement normal, PAS Coast
sel.commandAvailable = false;
sel.car = myCar2;
sel.dieValue = 1;
sel.slamOptions = { decideReroll: win.decideSlamRerollDefault };
sel.remaining = 1;
sel.roadEligible = true;
sel.hadSlam = false;
sel.hadDamage = false;
sel.roadBonusOffered = false;
sel.inRoadBonus = false;
sel.step = "move-step";

const option2 = { direction: "front", col: 5, row: 3, outcome: "normal", cost: 1 };
win.pickMoveStep(option2);
sel = win.eval("sel");
win.render();

console.log("sel.step EST road-bonus-choice pour un mouvement normal (attendu true) :", sel.step === "road-bonus-choice");
console.log("Le panneau propose bien le bonus Road (attendu true) :", panelText(dom).includes("bonus Road"));

console.log("\n=== Fin des tests dédiés (correctif Coast / bonus Road) ===");
